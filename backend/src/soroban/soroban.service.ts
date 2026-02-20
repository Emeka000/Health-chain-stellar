import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Keypair,
  Operation,
  Asset,
  xdr,
} from '@stellar/stellar-sdk';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockchainEvent } from './entities/blockchain-event.entity';

interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

@Injectable()
export class SorobanService implements OnModuleInit {
  private readonly logger = new Logger(SorobanService.name);
  private server: SorobanRpc.Server;
  private contract: Contract;
  private sourceKeypair: Keypair;
  private networkPassphrase: string;
  private readonly retryConfig: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  };

  constructor(
    private configService: ConfigService,
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
    const network = this.configService.get<string>('SOROBAN_NETWORK', 'testnet');

    this.server = new SorobanRpc.Server(rpcUrl);
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    if (contractId) {
      this.contract = new Contract(contractId);
    }

    if (secretKey) {
      this.sourceKeypair = Keypair.fromSecret(secretKey);
    }

    this.logger.log(`Soroban service initialized on ${network}`);
  }

  /**
   * Register a blood unit on the blockchain
   */
  async registerBloodUnit(params: {
    unitId: string;
    bloodType: string;
    donorId: string;
    bankId: string;
  }): Promise<{ transactionHash: string; unitId: number }> {
    return this.executeWithRetry(async () => {
      const bloodTypeEnum = this.mapBloodType(params.bloodType);
      
      const account = await this.server.getAccount(this.sourceKeypair.publicKey());
      
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'register_blood_unit',
            xdr.ScVal.scvSymbol(params.unitId),
            bloodTypeEnum,
            xdr.ScVal.scvSymbol(params.donorId),
            xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(
              Keypair.fromPublicKey(params.bankId).xdrPublicKey()
            )),
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
          data: { ...params, unitId },
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
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(this.sourceKeypair.publicKey());
      
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          this.contract.call(
            'transfer_custody',
            xdr.ScVal.scvU64(xdr.Uint64.fromString(params.unitId.toString())),
            xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(
              Keypair.fromPublicKey(params.fromAccount).xdrPublicKey()
            )),
            xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(
              Keypair.fromPublicKey(params.toAccount).xdrPublicKey()
            )),
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
  }): Promise<{ transactionHash: string }> {
    return this.executeWithRetry(async () => {
      const account = await this.server.getAccount(this.sourceKeypair.publicKey());
      
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
            xdr.ScVal.scvU64(xdr.Uint64.fromString(params.timestamp.toString())),
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
      const account = await this.server.getAccount(this.sourceKeypair.publicKey());
      
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

  /**
   * Execute operation with retry logic and exponential backoff
   */
  private async executeWithRetry<T>(
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
        eventData: params.data,
        blockchainTimestamp: new Date(),
      });

      await this.eventRepository.save(event);
      this.logger.log(`Event saved: ${params.eventType} - ${params.transactionHash}`);
    } catch (error) {
      this.logger.error(`Failed to save event: ${error.message}`);
    }
  }

  /**
   * Map blood type string to Soroban enum
   */
  private mapBloodType(bloodType: string): xdr.ScVal {
    const typeMap: Record<string, number> = {
      'A+': 0,
      'A-': 1,
      'B+': 2,
      'B-': 3,
      'AB+': 4,
      'AB-': 5,
      'O+': 6,
      'O-': 7,
    };

    const enumValue = typeMap[bloodType];
    if (enumValue === undefined) {
      throw new Error(`Invalid blood type: ${bloodType}`);
    }

    return xdr.ScVal.scvU32(enumValue);
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
}
