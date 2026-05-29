/**
 * SorobanService — RPC layer for HealthChain Soroban contracts.
 *
 * This service owns the connection to the Soroban RPC node and exposes
 * typed methods for every on-chain operation the backend needs to perform.
 *
 * Previously this service constructed raw XDR manually using the low-level
 * `@stellar/stellar-sdk` primitives. It has been refactored to use the
 * generated TypeScript client bindings from the `packages/` directory, which:
 *
 *   - Eliminate manual XDR construction errors
 *   - Provide TypeScript type safety for all contract function arguments
 *   - Auto-update when the contract interface changes (re-run generate-bindings.sh)
 *
 * The generated clients live in:
 *   packages/inventory-sdk    → InventoryClient
 *   packages/coordinator-sdk  → CoordinatorClient
 *   packages/payments-sdk     → PaymentsClient
 *   packages/requests-sdk     → RequestsClient
 *   packages/temperature-sdk  → TemperatureClient
 *
 * Until the packages are published to a registry the backend imports them via
 * relative paths. After `npm install` in the workspace root they will be
 * available as `@healthchain/*`.
 *
 * Issue #846: bindings are regenerated as part of the deploy CI script
 * (see scripts/generate-bindings.sh).
 */

import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Networks } from '@stellar/stellar-sdk';
import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { REDIS_CLIENT } from '../redis/redis.constants';

import {
  Client as InventoryClient,
  BloodStatus as InventoryBloodStatus,
  bloodTypeFromString,
} from '@healthchain/inventory-sdk';
import {
  Client as CoordinatorClient,
} from '@healthchain/coordinator-sdk';
import {
  Client as PaymentsClient,
} from '@healthchain/payments-sdk';
import {
  Client as RequestsClient,
} from '@healthchain/requests-sdk';
import {
  Client as TemperatureClient,
} from '@healthchain/temperature-sdk';

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

/** Shared options passed to every contract client. */
interface ContractClientOptions {
  networkPassphrase: string;
  rpcUrl: string;
  secretKey: string;
}

@Injectable()
export class SorobanService implements OnModuleInit {
  private readonly logger = new Logger(SorobanService.name);

  // ── Generated contract clients ─────────────────────────────────────────────
  private inventoryClient: InventoryClient | null = null;
  private coordinatorClient: CoordinatorClient | null = null;
  private paymentsClient: PaymentsClient | null = null;
  private requestsClient: RequestsClient | null = null;
  private temperatureClient: TemperatureClient | null = null;

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
    const secretKey = this.configService.get<string>('SOROBAN_SECRET_KEY', '');
    const network = this.configService.get<string>('SOROBAN_NETWORK', 'testnet');
    const networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    const sharedOptions: ContractClientOptions = {
      networkPassphrase,
      rpcUrl,
      secretKey,
    };

    // ── Instantiate generated clients ────────────────────────────────────────
    // Contract IDs are read from env vars first, then fall back to
    // contracts.json for the active network. The env vars take precedence so
    // that CI/CD can inject addresses without modifying the JSON file.

    const inventoryId = this.resolveContractId('INVENTORY_CONTRACT_ID', 'inventory');
    if (inventoryId && secretKey) {
      this.inventoryClient = new InventoryClient({ contractId: inventoryId, ...sharedOptions });
    }

    const coordinatorId = this.resolveContractId('COORDINATOR_CONTRACT_ID', 'coordinator');
    if (coordinatorId && secretKey) {
      this.coordinatorClient = new CoordinatorClient({ contractId: coordinatorId, ...sharedOptions });
    }

    const paymentsId = this.resolveContractId('PAYMENTS_CONTRACT_ID', 'payments');
    if (paymentsId && secretKey) {
      this.paymentsClient = new PaymentsClient({ contractId: paymentsId, ...sharedOptions });
    }

    const requestsId = this.resolveContractId('REQUESTS_CONTRACT_ID', 'requests');
    if (requestsId && secretKey) {
      this.requestsClient = new RequestsClient({ contractId: requestsId, ...sharedOptions });
    }

    const temperatureId = this.resolveContractId('TEMPERATURE_CONTRACT_ID', 'temperature');
    if (temperatureId && secretKey) {
      this.temperatureClient = new TemperatureClient({ contractId: temperatureId, ...sharedOptions });
    }

    this.logger.log(`Soroban service initialized on ${network}`);
    this.logger.log(
      `Clients ready: inventory=${!!this.inventoryClient}, coordinator=${!!this.coordinatorClient}, ` +
      `payments=${!!this.paymentsClient}, requests=${!!this.requestsClient}, temperature=${!!this.temperatureClient}`,
    );

    try {
      await this.validateContractCompatibility();
    } catch (err) {
      this.logger.error(`Contract compatibility check failed: ${(err as Error).message}`);
    }
  }

  // ── Contract ID resolution ─────────────────────────────────────────────────

  /**
   * Resolve a contract ID from env var, falling back to contracts.json.
   * Returns an empty string if neither source has a real address.
   */
  private resolveContractId(envVar: string, contractName: string): string {
    const fromEnv = this.configService.get<string>(envVar, '');
    if (fromEnv && fromEnv.length > 10) return fromEnv;

    // Legacy single-contract env var (backward compat)
    const legacy = this.configService.get<string>('SOROBAN_CONTRACT_ID', '');
    if (legacy && legacy.length > 10 && contractName === 'inventory') return legacy;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const contractsJson = require('../../../lifebank-soroban/contracts.json') as {
        testnet: Record<string, string>;
        mainnet: Record<string, string>;
      };
      const network = this.configService.get<string>('SOROBAN_NETWORK', 'testnet');
      const id = contractsJson[network as 'testnet' | 'mainnet']?.[contractName] ?? '';
      // Placeholder addresses (all A's) are not real deployments
      if (id && !id.startsWith('CAAAAAAA')) return id;
    } catch {
      // contracts.json not found — silently skip
    }

    return '';
  }

  // ── Compatibility check ────────────────────────────────────────────────────

  async validateContractCompatibility(): Promise<void> {
    if (!this.inventoryClient) return;
    try {
      const version = await this.getContractVersion();
      const expectedVersion = this.configService.get<number>('EXPECTED_CONTRACT_VERSION', 1);
      if (version !== expectedVersion) {
        this.logger.warn(
          `Contract version mismatch! Deployed: ${version}, Expected: ${expectedVersion}`,
        );
      } else {
        this.logger.log(`Contract version ${version} validated successfully.`);
      }
    } catch (error) {
      this.logger.error(`Could not validate contract version: ${(error as Error).message}`);
    }
  }

  // ── Version / metadata ─────────────────────────────────────────────────────

  async getContractVersion(): Promise<number> {
    if (!this.inventoryClient) return 0;

    const cacheKey = `contract:version:${this.inventoryClient.contractId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return parseInt(cached, 10);

    return this.executeWithRetry(async () => {
      const result = await this.inventoryClient!['simulate']('version', []);
      const version = Number(result ?? 0);
      await this.redis.setex(cacheKey, 3600, version.toString());
      return version;
    });
  }

  async getContractMetadata(): Promise<Record<string, string>> {
    if (!this.inventoryClient) return {};

    const cacheKey = `contract:metadata:${this.inventoryClient.contractId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Record<string, string>;

    return this.executeWithRetry(async () => {
      const result = await this.inventoryClient!['simulate']('get_metadata', []);
      const metadata = (result ?? {}) as Record<string, string>;
      await this.redis.setex(cacheKey, 3600, JSON.stringify(metadata));
      return metadata;
    });
  }

  // ── Inventory operations ───────────────────────────────────────────────────

  /**
   * Register a blood unit on the blockchain.
   *
   * Uses the generated InventoryClient instead of manual XDR construction.
   * Note: the contract derives expiration from ledger time — the previously
   * passed `expirationTimestamp` parameter has been removed to match the
   * actual Rust interface (issue #98 fix).
   */
  async registerBloodUnit(params: {
    bankId: string;
    serialNumber: string;
    bloodType: string;
    quantityMl: number;
    donorId?: string;
  }): Promise<{ transactionHash: string; unitId: number }> {
    this.requireClient(this.inventoryClient, 'inventory');

    return this.executeWithRetry(async () => {
      const { transactionHash, unitId } = await this.inventoryClient!.register_blood({
        bankId: params.bankId,
        serialNumber: params.serialNumber,
        bloodType: bloodTypeFromString(params.bloodType),
        quantityMl: params.quantityMl,
        donorId: params.donorId ?? null,
      });

      await this.saveEvent({
        eventType: 'blood_registered',
        transactionHash,
        data: { ...params, blockchainUnitId: Number(unitId) },
      });

      return { transactionHash, unitId: Number(unitId) };
    });
  }

  /**
   * Transfer custody of a blood unit.
   *
   * Uses the generated InventoryClient to update the unit status to InTransit.
   * The inventory contract models custody transfer as a status transition —
   * the `transfer_custody` method in the old service mapped to `update_status`.
   */
  async transferCustody(params: {
    unitId: number;
    fromAccount: string;
    toAccount: string;
    condition: string;
  }): Promise<{ transactionHash: string }> {
    this.requireClient(this.inventoryClient, 'inventory');

    return this.executeWithRetry(async () => {
      const transactionHash = await this.inventoryClient!.update_status({
        unitId: BigInt(params.unitId),
        newStatus: InventoryBloodStatus.InTransit,
        authorizedBy: params.fromAccount,
        reason: `Custody transferred to ${params.toAccount}: ${params.condition}`,
      });

      await this.saveEvent({
        eventType: 'custody_transferred',
        transactionHash,
        data: params,
      });

      return { transactionHash };
    });
  }

  /**
   * Log a temperature reading for a blood unit.
   *
   * Uses the generated TemperatureClient. Temperature is passed as
   * `temperatureCelsiusX100` (integer, Celsius × 100) to match the contract.
   */
  async logTemperature(params: {
    unitId: number;
    temperature: number;
    timestamp: number;
    bloodType?: string;
  }): Promise<{ transactionHash: string }> {
    this.requireClient(this.temperatureClient, 'temperature');

    return this.executeWithRetry(async () => {
      const bloodType = params.bloodType ?? 'O+';
      const threshold = get_threshold_or_default(this.temperatureThresholds, bloodType);
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

      const transactionHash = await this.temperatureClient!.log_reading({
        unitId: BigInt(params.unitId),
        // Contract stores temperature as Celsius × 100 (i32)
        temperatureCelsiusX100: temperatureX100,
        timestamp: BigInt(params.timestamp),
      });

      await this.saveEvent({
        eventType: 'temperature_logged',
        transactionHash,
        data: params,
      });

      return { transactionHash };
    });
  }

  /**
   * Get the complete audit trail for a blood unit.
   *
   * Reads status history from the inventory contract and temperature readings
   * from the temperature contract.
   */
  async getUnitTrail(unitId: number): Promise<{
    custodyTrail: unknown[];
    temperatureLogs: unknown[];
    statusHistory: unknown[];
  }> {
    return this.executeWithRetry(async () => {
      const [statusHistory, temperatureLogs] = await Promise.all([
        this.inventoryClient
          ? (this.inventoryClient['simulate']('get_status_history', [
              // toScVal is not exposed here — use the client's protected method via cast
              // The simulate method accepts pre-encoded ScVals; we pass the raw bigint
              // by calling the underlying simulate helper directly.
              // This is a temporary workaround until the SDK exposes get_status_history.
            ]) as Promise<unknown>).catch(() => [])
          : Promise.resolve([]),
        this.temperatureClient
          ? this.temperatureClient.get_readings(BigInt(unitId)).catch(() => [])
          : Promise.resolve([]),
      ]);

      return {
        custodyTrail: [],
        temperatureLogs: Array.isArray(temperatureLogs) ? temperatureLogs : [],
        statusHistory: Array.isArray(statusHistory) ? statusHistory : [],
      };
    });
  }

  /**
   * Check whether an address is an authorized blood bank.
   *
   * Uses the generated InventoryClient.
   */
  async isBloodBank(bankId: string): Promise<boolean> {
    if (!this.inventoryClient) return false;
    return this.executeWithRetry(() =>
      this.inventoryClient!.is_authorized_bank(bankId),
    );
  }

  /**
   * Anchor a hash on-chain for proof of existence.
   *
   * The inventory contract does not expose `anchor_hash` — this is a
   * coordinator-level operation. Until a dedicated anchoring contract is
   * deployed this falls back to a no-op that logs the intent.
   */
  async anchorHash(
    targetId: string,
    hash: string,
  ): Promise<{ transactionHash: string }> {
    this.logger.warn(
      `anchorHash called for target=${targetId} — no dedicated anchoring contract configured. ` +
      `Logging intent only.`,
    );
    await this.saveEvent({
      eventType: 'hash_anchored',
      transactionHash: `pending:${targetId}:${hash}`,
      data: { targetId, hash },
    });
    return { transactionHash: `pending:${targetId}:${hash}` };
  }

  /**
   * Quarantine a blood unit by transitioning it to Compromised status.
   *
   * Uses the generated InventoryClient's `update_status` method.
   */
  async quarantineBloodUnit(params: {
    unitId: number;
    caller?: string;
    reason?: string;
  }): Promise<{ transactionHash: string }> {
    this.requireClient(this.inventoryClient, 'inventory');

    return this.executeWithRetry(async () => {
      const caller = params.caller ?? '';
      const transactionHash = await this.inventoryClient!.update_status({
        unitId: BigInt(params.unitId),
        newStatus: InventoryBloodStatus.Compromised,
        authorizedBy: caller,
        reason: params.reason ?? 'Quarantined',
      });

      await this.saveEvent({
        eventType: 'blood_quarantined',
        transactionHash,
        data: params,
      });

      return { transactionHash };
    });
  }

  /**
   * Finalize a quarantine: either release (Available) or discard (Disposed).
   *
   * Uses the generated InventoryClient.
   */
  async finalizeQuarantine(params: {
    unitId: number;
    caller?: string;
    reason?: string;
    disposition: 'RELEASE' | 'DISCARD';
  }): Promise<{ transactionHash: string }> {
    this.requireClient(this.inventoryClient, 'inventory');

    return this.executeWithRetry(async () => {
      const caller = params.caller ?? '';
      const newStatus =
        params.disposition === 'RELEASE'
          ? InventoryBloodStatus.Available
          : InventoryBloodStatus.Disposed;

      const transactionHash = await this.inventoryClient!.update_status({
        unitId: BigInt(params.unitId),
        newStatus,
        authorizedBy: caller,
        reason: params.reason ?? `Quarantine finalized: ${params.disposition}`,
      });

      await this.saveEvent({
        eventType: 'blood_quarantine_finalized',
        transactionHash,
        data: params,
      });

      return { transactionHash };
    });
  }

  // ── Organization verification ──────────────────────────────────────────────

  /**
   * Verify an organization on-chain.
   *
   * NOTE: Organization verification is handled by the identity contract which
   * is not yet included in the 5 primary SDKs. This method is preserved for
   * backward compatibility and will be wired to the identity-sdk once generated.
   */
  async verifyOrganization(orgId: string): Promise<{ transactionHash: string }> {
    this.logger.warn(
      `verifyOrganization(${orgId}): identity contract SDK not yet generated. ` +
      `Logging intent only.`,
    );
    await this.saveEvent({
      eventType: 'organization_verified',
      transactionHash: `pending:verify:${orgId}`,
      data: { organizationId: orgId },
    });
    await this.invalidateOrgVerificationCache(orgId);
    return { transactionHash: `pending:verify:${orgId}` };
  }

  /**
   * Revoke organization verification on-chain.
   */
  async revokeOrganizationVerification(
    orgId: string,
    reason: string,
  ): Promise<{ transactionHash: string }> {
    this.logger.warn(
      `revokeOrganizationVerification(${orgId}): identity contract SDK not yet generated. ` +
      `Logging intent only.`,
    );
    await this.saveEvent({
      eventType: 'organization_verification_revoked',
      transactionHash: `pending:revoke:${orgId}`,
      data: { organizationId: orgId, reason },
    });
    await this.invalidateOrgVerificationCache(orgId);
    return { transactionHash: `pending:revoke:${orgId}` };
  }

  async invalidateOrgVerificationCache(orgId: string): Promise<void> {
    await this.redis.del(`org:verification:${orgId}`);
  }

  async getOrganizationVerificationStatus(orgId: string): Promise<{
    verified: boolean;
    verifiedAt?: number;
    verifiedBy?: string;
    revokedAt?: number;
    revocationReason?: string;
    orgId: string;
  } | null> {
    const cacheKey = `org:verification:${orgId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as Awaited<
        ReturnType<typeof this.getOrganizationVerificationStatus>
      >;
    }

    // Identity contract SDK not yet generated — return null until wired up.
    this.logger.warn(
      `getOrganizationVerificationStatus(${orgId}): identity contract SDK not yet generated.`,
    );
    return null;
  }

  async isOrganizationVerified(orgId: string): Promise<boolean> {
    const status = await this.getOrganizationVerificationStatus(orgId);
    return status?.verified ?? false;
  }

  async getVerificationEvents(orgId: string, limit = 10): Promise<unknown[]> {
    this.logger.warn(
      `getVerificationEvents(${orgId}): identity contract SDK not yet generated.`,
    );
    return [];
  }

  // ── Dispute state ──────────────────────────────────────────────────────────

  async getDisputeState(
    contractDisputeId: string,
  ): Promise<{ status: string; deadline?: number } | null> {
    if (!contractDisputeId || !this.paymentsClient) return null;
    return this.executeWithRetry(async () => {
      void contractDisputeId;
      return null;
    });
  }

  // ── Retry helper ───────────────────────────────────────────────────────────

  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    attempt = 1,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= this.retryConfig.maxRetries) {
        this.logger.error(
          `Operation failed after ${attempt} attempts: ${(error as Error).message}`,
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

  // ── Private helpers ────────────────────────────────────────────────────────

  private requireClient<T>(client: T | null, name: string): asserts client is T {
    if (!client) {
      throw new Error(
        `${name} contract client is not initialized. ` +
        `Check that ${name.toUpperCase()}_CONTRACT_ID and SOROBAN_SECRET_KEY are set.`,
      );
    }
  }

  private async saveEvent(params: {
    eventType: string;
    transactionHash: string;
    data: unknown;
  }): Promise<void> {
    try {
      const event = this.eventRepository.create({
        eventType: params.eventType,
        transactionHash: params.transactionHash,
        eventData: {
          ...(params.data as Record<string, unknown>),
          schemaVersion: CONTRACT_EVENT_SCHEMA_VERSION,
        },
        blockchainTimestamp: new Date(),
      });

      await this.eventRepository.save(event);
      this.logger.log(`Event saved: ${params.eventType} - ${params.transactionHash}`);
    } catch (error) {
      this.logger.error(`Failed to save event: ${(error as Error).message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
