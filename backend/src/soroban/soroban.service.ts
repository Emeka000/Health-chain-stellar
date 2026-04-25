import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import {
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Keypair,
  Operation,
  Asset,
  xdr,
} from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';
import * as SorobanRpc from '@stellar/stellar-sdk/rpc';
import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { REDIS_CLIENT } from '../redis/redis.constants';

import {
  assertRegisterBloodUnitIds,
  assertTransferCustodyIds,
  assertLogTemperatureIds,
} from '../common/guards/on-chain-id.guard';
import {
  LIFEBANK_INVENTORY_METHODS,
  mapBloodTypeToLifebankIndex,
} from '../blockchain/contracts/lifebank-contracts';

import { BlockchainEvent } from './entities/blockchain-event.entity';
import { CONTRACT_EVENT_SCHEMA_VERSION } from './event-schema-version';
import {
  ContractError,
  TemperatureThreshold,
  get_threshold_or_default,
  validate_threshold,
} from './temperature-threshold.guard';

interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

@Injectable()
export class SorobanService implements OnModuleInit {
  private readonly logger = new Logger(SorobanService.name);
  private server: Server;
  private contract: Contract;
  private sourceKeypair: Keypair;
  private networkPassphrase: string;
  private readonly retryConfig: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  };
  private readonly temperatureThresholds = new Map<
    string,
    TemperatureThreshold
  >();

  constructor(
    private configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(BlockchainEvent)
    private eventRepository: Repository<BlockchainEvent>,
  ) {}

  async onModuleInit() {
    const rpcUrl = this.configService.get<string>(
      'SOROBAN_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    const contractId = this.configService.get<string>('SOROBAN_CONTRACT_ID');
    const secretKey = this.configService.get<string>('SOROBAN_SECRET_KEY');
    const network = this.configService.get<string>(
      'SOROBAN_NETWORK',
      'testnet',
    );

    this.server = new Server(rpcUrl);
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    if (contractId) {
      this.contract = new Contract(contractId);
    }

    if (secretKey) {
      this.sourceKeypair = Keypair.fromSecret(secretKey);
    }

    this.logger.log(`Soroban service initialized on ${network}`);

    // Validate contract compatibility
    try {
      await this.validateContractCompatibility();
    } catch (err) {
      this.logger.error(`Contract compatibility check failed: ${err.message}`);
    }
  }

  /**
   * Validate that the deployed contract version matches backend expectations
   */
  async validateContractCompatibility(): Promise<void> {
    if (!this.contract) return;

    try {
      const version = await this.getContractVersion();
      const expectedVersion = this.configService.get<number>(
        'EXPECTED_CONTRACT_VERSION',
        1,
      );

      if (version !== expectedVersion) {
        this.logger.warn(
          `Contract version mismatch! Deployed: ${version}, Expected: ${expectedVersion}`,
        );
      } else {
        this.logger.log(`Contract version ${version} validated successfully.`);
      }
    } catch (error) {
      this.logger.error(`Could not validate contract version: ${error.message}`);
    }
  }

  /**
   * Get contract version from the blockchain
   */
  async getContractVersion(): Promise<number> {
    const cacheKey = `contract:version:${this.contract.contractId()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return parseInt(cached);

    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(this.contract.call('version'))
        .setTimeout(30)
        .build();

      const simulated = await this.server.simulateTransaction(transaction);
      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        const version = this.parseScVal(result);
        await this.redis.setex(cacheKey, 3600, version.toString()); // cache for 1 hour
        return version;
      }
      throw new Error('Failed to fetch contract version');
    });
  }

  /**
   * Get contract metadata
   */
  async getContractMetadata(): Promise<Record<string, string>> {
    const cacheKey = `contract:metadata:${this.contract.contractId()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(this.contract.call('get_metadata'))
        .setTimeout(30)
        .build();

      const simulated = await this.server.simulateTransaction(transaction);
      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        const metadata = this.parseScVal(result);
        await this.redis.setex(cacheKey, 3600, JSON.stringify(metadata));
        return metadata;
      }
      throw new Error('Failed to fetch contract metadata');
    });
  }

  /**
   * Register a blood unit on the blockchain
   */
  async registerBloodUnit(params: {
    bankId: string;
    bloodType: string;
    quantityMl: number;
    expirationTimestamp: number;
    donorId?: string;
  }): Promise<{ transactionHash: string; unitId: number }> {
    assertRegisterBloodUnitIds(params);
    return this.executeWithRetry(async () => {
      const bloodTypeEnum = this.mapBloodType(params.bloodType);

      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            LIFEBANK_INVENTORY_METHODS.registerBlood,
            this.createAddressScVal(params.bankId),
            bloodTypeEnum,
            xdr.ScVal.scvU32(params.quantityMl),
            xdr.ScVal.scvU64(
              xdr.Uint64.fromString(params.expirationTimestamp.toString()),
            ),
            params.donorId
              ? xdr.ScVal.scvSymbol(params.donorId)
              : xdr.ScVal.scvVoid(),
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(this.sourceKeypair);

      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        const result = await this.pollTransactionStatus(response.hash);
        const unitId = this.extractUnitIdFromResult(result);

        await this.saveEvent({
          eventType: 'blood_registered',
          transactionHash: response.hash,
          data: { ...params, blockchainUnitId: unitId },
        });

        return { transactionHash: response.hash, unitId };
      }

      throw new Error(`Transaction failed: ${response.status}`);
    });
  }

  /**
   * Transfer custody of a blood unit
   */
  async transferCustody(params: {
    unitId: number;
    fromAccount: string;
    toAccount: string;
    condition: string;
  }): Promise<{ transactionHash: string }> {
    assertTransferCustodyIds(params);
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'transfer_custody',
            xdr.ScVal.scvU64(xdr.Uint64.fromString(params.unitId.toString())),
            xdr.ScVal.scvAddress(
              xdr.ScAddress.scAddressTypeAccount(
                Keypair.fromPublicKey(params.fromAccount).xdrPublicKey(),
              ),
            ),
            xdr.ScVal.scvAddress(
              xdr.ScAddress.scAddressTypeAccount(
                Keypair.fromPublicKey(params.toAccount).xdrPublicKey(),
              ),
            ),
            xdr.ScVal.scvString(params.condition),
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(this.sourceKeypair);

      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        await this.pollTransactionStatus(response.hash);

        await this.saveEvent({
          eventType: 'custody_transferred',
          transactionHash: response.hash,
          data: params,
        });

        return { transactionHash: response.hash };
      }

      throw new Error(`Transaction failed: ${response.status}`);
    });
  }

  /**
   * Log temperature reading for a blood unit
   */
  async logTemperature(params: {
    unitId: number;
    temperature: number;
    timestamp: number;
    bloodType?: string;
  }): Promise<{ transactionHash: string }> {
    assertLogTemperatureIds(params);
    return this.executeWithRetry(async () => {
      const bloodType = params.bloodType ?? 'O+';
      const threshold = get_threshold_or_default(
        this.temperatureThresholds,
        bloodType,
      );
      const thresholdValidation = validate_threshold(threshold);

      if (!thresholdValidation.ok) {
        throw new Error(ContractError.InvalidThreshold);
      }

      const temperatureX100 = Math.round(params.temperature * 100);
      if (
        temperatureX100 < threshold.min_celsius_x100 ||
        temperatureX100 > threshold.max_celsius_x100
      ) {
        throw new Error(ContractError.InvalidThreshold);
      }

      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );

      // Temperature in Celsius * 10 (e.g., 2.5°C = 25)
      const tempValue = Math.round(params.temperature * 10);

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'log_temperature',
            xdr.ScVal.scvU64(xdr.Uint64.fromString(params.unitId.toString())),
            xdr.ScVal.scvI32(tempValue),
            xdr.ScVal.scvU64(
              xdr.Uint64.fromString(params.timestamp.toString()),
            ),
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(this.sourceKeypair);

      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        await this.pollTransactionStatus(response.hash);

        await this.saveEvent({
          eventType: 'temperature_logged',
          transactionHash: response.hash,
          data: params,
        });

        return { transactionHash: response.hash };
      }

      throw new Error(`Transaction failed: ${response.status}`);
    });
  }

  /**
   * Get complete audit trail for a blood unit
   */
  async getUnitTrail(unitId: number): Promise<{
    custodyTrail: any[];
    temperatureLogs: any[];
    statusHistory: any[];
  }> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'get_unit_trail',
            xdr.ScVal.scvU64(xdr.Uint64.fromString(unitId.toString())),
          ),
        )
        .setTimeout(30)
        .build();

      const simulated = await this.server.simulateTransaction(transaction);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        return this.parseTrailResult(result);
      }

      throw new Error('Failed to get unit trail');
    });
  }

  async isBloodBank(bankId: string): Promise<boolean> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call('is_blood_bank', this.createAddressScVal(bankId)),
        )
        .setTimeout(30)
        .build();

      const simulated = await this.server.simulateTransaction(transaction);
      if (!SorobanRpc.Api.isSimulationSuccess(simulated)) {
        return false;
      }

      const result = simulated.result?.retval;
      const parsed = this.parseScVal(result);
      return Boolean(parsed);
    });
  }

  /**
   * Anchor a hash on-chain for proof of existence (e.g. delivery proof)
   * Closes #464
   */
  async anchorHash(
    targetId: string,
    hash: string,
  ): Promise<{ transactionHash: string }> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'anchor_hash',
            xdr.ScVal.scvString(targetId),
            xdr.ScVal.scvString(hash),
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(this.sourceKeypair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        await this.pollTransactionStatus(response.hash);
        await this.saveEvent({
          eventType: 'hash_anchored',
          transactionHash: response.hash,
          data: { targetId, hash },
        });
        return { transactionHash: response.hash };
      }

      throw new Error(`Transaction failed: ${response.status}`);
    });
  }


  async quarantineBloodUnit(params: {
    unitId: number;
    caller?: string;
    reason?:
      | 'SCREENING_FAILURE'
      | 'TEMPERATURE_BREACH'
      | 'CONTAMINATION_SUSPECTED'
      | 'DONOR_LEVEL_EVENT'
      | 'MANUAL_OPERATOR_ACTION'
      | 'ANOMALY_DETECTION'
      | 'OTHER';
  }): Promise<{ transactionHash: string }> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );
      const caller = params.caller ?? this.sourceKeypair.publicKey();

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'quarantine_blood',
            this.createAddressScVal(caller),
            xdr.ScVal.scvU64(xdr.Uint64.fromString(params.unitId.toString())),
            this.mapQuarantineReason(params.reason ?? 'OTHER'),
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(this.sourceKeypair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        await this.pollTransactionStatus(response.hash);
        await this.saveEvent({
          eventType: 'blood_quarantined',
          transactionHash: response.hash,
          data: params,
        });
        return { transactionHash: response.hash };
      }

      throw new Error(`Transaction failed: ${response.status}`);
    });
  }

  async finalizeQuarantine(params: {
    unitId: number;
    caller?: string;
    reason?:
      | 'SCREENING_FAILURE'
      | 'TEMPERATURE_BREACH'
      | 'CONTAMINATION_SUSPECTED'
      | 'DONOR_LEVEL_EVENT'
      | 'MANUAL_OPERATOR_ACTION'
      | 'ANOMALY_DETECTION'
      | 'OTHER';
    disposition: 'RELEASE' | 'DISCARD';
  }): Promise<{ transactionHash: string }> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );
      const caller = params.caller ?? this.sourceKeypair.publicKey();

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'finalize_quarantine',
            this.createAddressScVal(caller),
            xdr.ScVal.scvU64(xdr.Uint64.fromString(params.unitId.toString())),
            this.mapQuarantineReason(params.reason ?? 'OTHER'),
            this.mapQuarantineDisposition(params.disposition),
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(this.sourceKeypair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        await this.pollTransactionStatus(response.hash);
        await this.saveEvent({
          eventType: 'blood_quarantine_finalized',
          transactionHash: response.hash,
          data: params,
        });
        return { transactionHash: response.hash };
      }

      throw new Error(`Transaction failed: ${response.status}`);
    });
  }

  /**
   * Execute operation with retry logic and exponential backoff
   */
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    attempt = 1,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= this.retryConfig.maxRetries) {
        this.logger.error(
          `Operation failed after ${attempt} attempts: ${error.message}`,
        );
        throw error;
      }

      const delay = Math.min(
        this.retryConfig.initialDelay *
          Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
        this.retryConfig.maxDelay,
      );

      this.logger.warn(
        `Operation failed (attempt ${attempt}/${this.retryConfig.maxRetries}), retrying in ${delay}ms...`,
      );

      await this.sleep(delay);
      return this.executeWithRetry(operation, attempt + 1);
    }
  }

  /**
   * Poll transaction status until completion
   */
  private async pollTransactionStatus(
    hash: string,
    maxAttempts = 30,
  ): Promise<SorobanRpc.Api.GetTransactionResponse> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await this.server.getTransaction(hash);

      if (response.status === 'SUCCESS') {
        return response;
      }

      if (response.status === 'FAILED') {
        throw new Error(`Transaction failed: ${hash}`);
      }

      await this.sleep(1000);
    }

    throw new Error(`Transaction polling timeout: ${hash}`);
  }

  /**
   * Save blockchain event to database
   */
  private async saveEvent(params: {
    eventType: string;
    transactionHash: string;
    data: any;
  }): Promise<void> {
    try {
      const event = this.eventRepository.create({
        eventType: params.eventType,
        transactionHash: params.transactionHash,
        eventData: {
          ...params.data,
          schemaVersion: CONTRACT_EVENT_SCHEMA_VERSION,
        },
        blockchainTimestamp: new Date(),
      });

      await this.eventRepository.save(event);
      this.logger.log(
        `Event saved: ${params.eventType} - ${params.transactionHash}`,
      );
    } catch (error) {
      this.logger.error(`Failed to save event: ${error.message}`);
    }
  }

  /**
   * Map blood type string to Soroban enum
   */
  private mapBloodType(bloodType: string): xdr.ScVal {
    return xdr.ScVal.scvU32(mapBloodTypeToLifebankIndex(bloodType));
  }

  private mapQuarantineReason(
    reason:
      | 'SCREENING_FAILURE'
      | 'TEMPERATURE_BREACH'
      | 'CONTAMINATION_SUSPECTED'
      | 'DONOR_LEVEL_EVENT'
      | 'MANUAL_OPERATOR_ACTION'
      | 'ANOMALY_DETECTION'
      | 'OTHER',
  ): xdr.ScVal {
    const map: Record<string, number> = {
      SCREENING_FAILURE: 0,
      TEMPERATURE_BREACH: 1,
      CONTAMINATION_SUSPECTED: 2,
      DONOR_LEVEL_EVENT: 3,
      MANUAL_OPERATOR_ACTION: 4,
      ANOMALY_DETECTION: 5,
      OTHER: 6,
    };
    return xdr.ScVal.scvU32(map[reason]);
  }

  private mapQuarantineDisposition(
    disposition: 'RELEASE' | 'DISCARD',
  ): xdr.ScVal {
    return xdr.ScVal.scvU32(disposition === 'RELEASE' ? 0 : 1);
  }

  private createAddressScVal(publicKey: string): xdr.ScVal {
    return xdr.ScVal.scvAddress(
      xdr.ScAddress.scAddressTypeAccount(
        Keypair.fromPublicKey(publicKey).xdrPublicKey(),
      ),
    );
  }

  /**
   * Extract unit ID from transaction result
   */
  private extractUnitIdFromResult(result: any): number {
    try {
      // Parse the result to extract the unit ID
      // This depends on the actual return structure from the contract
      const retval = result.returnValue;
      if (retval && retval._switch.name === 'scvU64') {
        return parseInt(retval._value.toString());
      }
      throw new Error('Invalid result format');
    } catch (error) {
      this.logger.error(`Failed to extract unit ID: ${error.message}`);
      return 0;
    }
  }

  /**
   * Parse trail result from contract
   */
  private parseTrailResult(result: any): {
    custodyTrail: any[];
    temperatureLogs: any[];
    statusHistory: any[];
  } {
    try {
      // Parse the tuple result (custody_trail, temp_logs, status_history)
      const custodyTrail = this.parseVec(result?._value?.[0]) || [];
      const temperatureLogs = this.parseVec(result?._value?.[1]) || [];
      const statusHistory = this.parseVec(result?._value?.[2]) || [];

      return {
        custodyTrail,
        temperatureLogs,
        statusHistory,
      };
    } catch (error) {
      this.logger.error(`Failed to parse trail result: ${error.message}`);
      return {
        custodyTrail: [],
        temperatureLogs: [],
        statusHistory: [],
      };
    }
  }

  /**
   * Parse Soroban Vec type
   */
  private parseVec(vec: any): any[] {
    if (!vec || vec._switch.name !== 'scvVec') {
      return [];
    }

    return vec._value.map((item: any) => this.parseScVal(item));
  }

  /**
   * Parse Soroban ScVal to JavaScript object
   */
  private parseScVal(val: any): any {
    if (!val || !val._switch) {
      return null;
    }

    switch (val._switch.name) {
      case 'scvU64':
        return parseInt(val._value.toString());
      case 'scvI32':
        return val._value;
      case 'scvString':
        return val._value.toString();
      case 'scvSymbol':
        return val._value.toString();
      case 'scvMap':
        return this.parseMap(val._value);
      case 'scvBool':
        return Boolean(val._value);
      default:
        return val._value;
    }
  }

  /**
   * Parse Soroban Map type
   */
  private parseMap(map: any[]): Record<string, any> {
    const result: Record<string, any> = {};

    for (const entry of map) {
      const key = this.parseScVal(entry.key);
      const value = this.parseScVal(entry.val);
      result[key] = value;
    }

    return result;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Verify an organization on-chain
   */
  async verifyOrganization(orgId: string): Promise<{ transactionHash: string }> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'verify_organization',
            this.createAddressScVal(this.sourceKeypair.publicKey()),
            this.createAddressScVal(orgId),
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(this.sourceKeypair);

      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        await this.pollTransactionStatus(response.hash);

        await this.saveEvent({
          eventType: 'organization_verified',
          transactionHash: response.hash,
          data: { organizationId: orgId },
        });

        return { transactionHash: response.hash };
      }

      throw new Error(`Transaction failed: ${response.status}`);
    });
  }

  /**
   * Revoke organization verification on-chain
   */
  async revokeOrganizationVerification(
    orgId: string,
    reason: string,
  ): Promise<{ transactionHash: string }> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'unverify_organization',
            this.createAddressScVal(this.sourceKeypair.publicKey()),
            this.createAddressScVal(orgId),
            xdr.ScVal.scvString(reason),
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(this.sourceKeypair);

      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING') {
        await this.pollTransactionStatus(response.hash);

        await this.saveEvent({
          eventType: 'organization_verification_revoked',
          transactionHash: response.hash,
          data: { organizationId: orgId, reason },
        });

        return { transactionHash: response.hash };
      }

      throw new Error(`Transaction failed: ${response.status}`);
    });
  }

  /**
   * Get organization verification metadata from on-chain
   */
  async getOrganizationVerificationStatus(orgId: string): Promise<{
    verified: boolean;
    verifiedAt?: number;
    verifiedBy?: string;
    revokedAt?: number;
    revocationReason?: string;
  } | null> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'get_verification_metadata',
            this.createAddressScVal(orgId),
          ),
        )
        .setTimeout(30)
        .build();

      const simulated = await this.server.simulateTransaction(transaction);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        return this.parseVerificationMetadata(result);
      }

      return null;
    });
  }

  /**
   * Check if organization is verified on-chain
   */
  async isOrganizationVerified(orgId: string): Promise<boolean> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'is_organization_verified',
            this.createAddressScVal(orgId),
          ),
        )
        .setTimeout(30)
        .build();

      const simulated = await this.server.simulateTransaction(transaction);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        return this.parseScVal(result);
      }

      return false;
    });
  }

  /**
   * Get verification events for an organization
   */
  async getVerificationEvents(
    orgId: string,
    limit: number = 10,
  ): Promise<any[]> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(
        this.sourceKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'get_verification_events',
            this.createAddressScVal(orgId),
            xdr.ScVal.scvU32(limit),
          ),
        )
        .setTimeout(30)
        .build();

      const simulated = await this.server.simulateTransaction(transaction);

      if (SorobanRpc.Api.isSimulationSuccess(simulated)) {
        const result = simulated.result?.retval;
        return this.parseVec(result) || [];
      }

      return [];
    });
  }

  /**
   * Parse verification metadata from contract result
   */
  private parseVerificationMetadata(result: any): {
    verified: boolean;
    verifiedAt?: number;
    verifiedBy?: string;
    revokedAt?: number;
    revocationReason?: string;
  } | null {
    try {
      if (!result || !result._value) {
        return null;
      }

      const fields = result._value;
      return {
        verified: this.parseScVal(fields[1]),
        verifiedAt: fields[2] ? this.parseScVal(fields[2]) : undefined,
        verifiedBy: fields[3] ? this.parseScVal(fields[3]) : undefined,
        revokedAt: fields[4] ? this.parseScVal(fields[4]) : undefined,
        revocationReason: fields[5] ? this.parseScVal(fields[5]) : undefined,
      };
    } catch (error) {
      this.logger.error(
        `Failed to parse verification metadata: ${error.message}`,
      );
      return null;
    }
  }
}
