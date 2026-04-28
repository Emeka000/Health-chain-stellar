import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

import { Repository, DataSource } from 'typeorm';

import { OrderEntity } from '../orders/entities/order.entity';

import { BlockchainEvent } from './entities/blockchain-event.entity';
import { assertSupportedContractEventSchemaVersion } from './event-schema-version';
import { BloodUnitTrail } from './entities/blood-unit-trail.entity';
import { IndexerStateEntity } from './entities/indexer-state.entity';
import {
  ReconciliationLogEntity,
  ReconciliationLogStatus,
} from './entities/reconciliation-log.entity';
import { SorobanService } from './soroban.service';

const PAYMENT_INDEXER_KEY = 'payment-reconciliation';

interface SorobanPaymentEvent {
  type: 'payment.released' | 'payment.refunded';
  onChainPaymentId: string;
  ledgerSequence: number;
  amount?: number;
}

@Injectable()
export class SorobanIndexerService {
  private readonly logger = new Logger(SorobanIndexerService.name);
  private isIndexing = false;
  private isReconciling = false;

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(BloodUnitTrail)
    private readonly trailRepository: Repository<BloodUnitTrail>,
    @InjectRepository(BlockchainEvent)
    private readonly eventRepository: Repository<BlockchainEvent>,
    @InjectRepository(IndexerStateEntity)
    private readonly indexerStateRepo: Repository<IndexerStateEntity>,
    @InjectRepository(ReconciliationLogEntity)
    private readonly reconciliationLogRepo: Repository<ReconciliationLogEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
  ) {}

  // ── Existing trail indexer ────────────────────────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async indexEvents() {
    if (this.isIndexing) {
      this.logger.debug('Indexing already in progress, skipping...');
      return;
    }

    this.isIndexing = true;
    this.logger.log('Starting blockchain event indexing...');

    try {
      const unprocessedEvents = await this.eventRepository.find({
        where: { processed: false },
        order: { blockchainTimestamp: 'ASC' },
        take: 100,
      });

      this.logger.log(`Found ${unprocessedEvents.length} unprocessed events`);

      for (const event of unprocessedEvents) {
        try {
          await this.processEvent(event);
          event.processed = true;
          await this.eventRepository.save(event);
          this.logger.debug(`Processed event: ${event.id}`);
        } catch (error) {
          this.logger.error(`Failed to process event ${event.id}: ${(error as Error).message}`);
        }
      }

      this.logger.log('Blockchain event indexing completed');
    } catch (error) {
      this.logger.error(`Event indexing failed: ${(error as Error).message}`);
    } finally {
      this.isIndexing = false;
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncTrailData() {
    this.logger.log('Starting trail data sync...');

    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

      const trailsToUpdate = await this.trailRepository
        .createQueryBuilder('trail')
        .where('trail.lastSyncedAt IS NULL OR trail.lastSyncedAt < :time', {
          time: tenMinutesAgo,
        })
        .orderBy('trail.lastSyncedAt', 'ASC', 'NULLS FIRST')
        .take(50)
        .getMany();

      this.logger.log(`Syncing ${trailsToUpdate.length} trails`);

      for (const trail of trailsToUpdate) {
        try {
          await this.syncUnitTrail(trail.unitId);
        } catch (error) {
          this.logger.error(`Failed to sync trail for unit ${trail.unitId}: ${(error as Error).message}`);
        }
      }

      this.logger.log('Trail data sync completed');
    } catch (error) {
      this.logger.error(`Trail sync failed: ${(error as Error).message}`);
    }
  }

  // ── Payment reconciliation ────────────────────────────────────────────

  /**
   * Poll Soroban RPC for payment.released / payment.refunded events every 30 s.
   * Resumes from the last processed ledger sequence stored in DB.
   */
  @Cron('*/30 * * * * *')
  async reconcilePayments(): Promise<void> {
    if (this.isReconciling) {
      this.logger.debug('Payment reconciliation already running, skipping...');
      return;
    }

    this.isReconciling = true;

    try {
      const state = await this.getOrCreateIndexerState(PAYMENT_INDEXER_KEY);
      const fromLedger = state.lastLedgerSequence;

      this.logger.debug(`Polling payment events from ledger ${fromLedger}`);

      const events = await this.fetchPaymentEvents(fromLedger);

      if (events.length === 0) {
        return;
      }

      this.logger.log(`Processing ${events.length} payment event(s) from ledger ${fromLedger}`);

      let maxLedger = fromLedger;

      for (const event of events) {
        await this.processPaymentEvent(event);
        if (event.ledgerSequence > maxLedger) {
          maxLedger = event.ledgerSequence;
        }
      }

      // Persist the last processed ledger so we resume correctly on restart
      state.lastLedgerSequence = maxLedger;
      await this.indexerStateRepo.save(state);
    } catch (error) {
      this.logger.error(`Payment reconciliation failed: ${(error as Error).message}`);
    } finally {
      this.isReconciling = false;
    }
  }

  /** Expose unresolved discrepancies for the admin endpoint. */
  async getDiscrepancies(limit = 50): Promise<ReconciliationLogEntity[]> {
    return this.reconciliationLogRepo.find({
      where: { status: ReconciliationLogStatus.DISCREPANCY },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async processPaymentEvent(event: SorobanPaymentEvent): Promise<void> {
    const onChainStatus = event.type === 'payment.released' ? 'RELEASED' : 'REFUNDED';

    const order = await this.orderRepo.findOne({
      where: { onChainPaymentId: event.onChainPaymentId },
    });

    if (!order) {
      // No matching off-chain record — log discrepancy
      await this.persistLog({
        onChainPaymentId: event.onChainPaymentId,
        orderId: null,
        eventType: event.type,
        ledgerSequence: event.ledgerSequence,
        onChainPaymentStatus: onChainStatus,
        offChainPaymentStatus: null,
        status: ReconciliationLogStatus.DISCREPANCY,
        discrepancyDetail: `No off-chain order found for onChainPaymentId=${event.onChainPaymentId}`,
      });
      return;
    }

    const offChainStatus = order.paymentStatus ?? null;

    if (offChainStatus === onChainStatus) {
      // Already in sync — log as resolved
      await this.persistLog({
        onChainPaymentId: event.onChainPaymentId,
        orderId: order.id,
        eventType: event.type,
        ledgerSequence: event.ledgerSequence,
        onChainPaymentStatus: onChainStatus,
        offChainPaymentStatus: offChainStatus,
        status: ReconciliationLogStatus.RESOLVED,
        discrepancyDetail: null,
      });
      return;
    }

    // Update off-chain record in a transaction
    await this.dataSource.transaction(async (manager) => {
      await manager.update(OrderEntity, order.id, { paymentStatus: onChainStatus });

      await manager.save(ReconciliationLogEntity, manager.create(ReconciliationLogEntity, {
        onChainPaymentId: event.onChainPaymentId,
        orderId: order.id,
        eventType: event.type,
        ledgerSequence: event.ledgerSequence,
        onChainPaymentStatus: onChainStatus,
        offChainPaymentStatus: offChainStatus,
        status: offChainStatus !== null ? ReconciliationLogStatus.DISCREPANCY : ReconciliationLogStatus.RESOLVED,
        discrepancyDetail: offChainStatus !== null
          ? `Off-chain status was '${offChainStatus}', updated to '${onChainStatus}'`
          : null,
        resolvedAt: new Date(),
      }));
    });

    this.logger.log(
      `Payment ${event.onChainPaymentId} reconciled: ${offChainStatus ?? 'null'} → ${onChainStatus}`,
    );
  }

  private async persistLog(params: {
    onChainPaymentId: string;
    orderId: string | null;
    eventType: string;
    ledgerSequence: number;
    onChainPaymentStatus: string;
    offChainPaymentStatus: string | null;
    status: ReconciliationLogStatus;
    discrepancyDetail: string | null;
    resolvedAt?: Date;
  }): Promise<void> {
    const log = this.reconciliationLogRepo.create({
      ...params,
      resolvedAt: params.resolvedAt ?? null,
    });
    await this.reconciliationLogRepo.save(log);
  }

  private async getOrCreateIndexerState(key: string): Promise<IndexerStateEntity> {
    let state = await this.indexerStateRepo.findOne({ where: { key } });
    if (!state) {
      state = this.indexerStateRepo.create({ key, lastLedgerSequence: 0 });
      await this.indexerStateRepo.save(state);
    }
    return state;
  }

  /**
   * Fetch payment events from Soroban RPC starting from `fromLedger`.
   * In production this calls the Soroban RPC `getEvents` endpoint filtered
   * by the payments contract and event topics payment.released / payment.refunded.
   */
  private async fetchPaymentEvents(fromLedger: number): Promise<SorobanPaymentEvent[]> {
    try {
      return await this.sorobanService.executeWithRetry(async () => {
        // Real implementation would call:
        //   server.getEvents({ startLedger: fromLedger, filters: [{ type: 'contract', contractIds: [...], topics: [...] }] })
        // Returning empty array until the payments contract address is configured.
        void fromLedger;
        return [] as SorobanPaymentEvent[];
      });
    } catch (err) {
      this.logger.warn(`Could not fetch payment events: ${(err as Error).message}`);
      return [];
    }
  }

  // ── Existing private methods ──────────────────────────────────────────

  private async processEvent(event: BlockchainEvent): Promise<void> {
    const schemaVersion = assertSupportedContractEventSchemaVersion(event);

    switch (event.eventType) {
      case 'blood_registered':
        await this.handleBloodRegistered(event);
        break;
      case 'custody_transferred':
        await this.handleCustodyTransferred(event);
        break;
      case 'temperature_logged':
        await this.handleTemperatureLogged(event);
        break;
      default:
        this.logger.warn(
          `Unknown event type: ${event.eventType} (schema v${schemaVersion})`,
        );
    }
  }

  private async handleBloodRegistered(event: BlockchainEvent): Promise<void> {
    const { unitId } = event.eventData as { unitId: number };
    const trail = this.trailRepository.create({
      unitId,
      custodyTrail: [],
      temperatureLogs: [],
      statusHistory: [],
      lastSyncedAt: new Date(),
    });
    await this.trailRepository.save(trail);
    this.logger.debug(`Created trail for unit ${unitId}`);
  }

  private async handleCustodyTransferred(event: BlockchainEvent): Promise<void> {
    const { unitId } = event.eventData as { unitId: number };
    await this.syncUnitTrail(unitId);
  }

  private async handleTemperatureLogged(event: BlockchainEvent): Promise<void> {
    const { unitId } = event.eventData as { unitId: number };
    await this.syncUnitTrail(unitId);
  }

  async syncUnitTrail(unitId: number): Promise<void> {
    try {
      const trailData = await this.sorobanService.getUnitTrail(unitId);
      let trail = await this.trailRepository.findOne({ where: { unitId } });

      if (!trail) {
        trail = this.trailRepository.create({ unitId });
      }

      trail.custodyTrail = trailData.custodyTrail;
      trail.temperatureLogs = trailData.temperatureLogs;
      trail.statusHistory = trailData.statusHistory;
      trail.lastSyncedAt = new Date();

      await this.trailRepository.save(trail);
      this.logger.debug(`Synced trail for unit ${unitId}`);
    } catch (error) {
      this.logger.error(`Failed to sync trail for unit ${unitId}: ${(error as Error).message}`);
      throw error;
    }
  }
}
