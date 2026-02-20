import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SorobanService } from './soroban.service';
import { BloodUnitTrail } from './entities/blood-unit-trail.entity';
import { BlockchainEvent } from './entities/blockchain-event.entity';

@Injectable()
export class SorobanIndexerService {
  private readonly logger = new Logger(SorobanIndexerService.name);
  private isIndexing = false;

  constructor(
    private sorobanService: SorobanService,
    @InjectRepository(BloodUnitTrail)
    private trailRepository: Repository<BloodUnitTrail>,
    @InjectRepository(BlockchainEvent)
    private eventRepository: Repository<BlockchainEvent>,
  ) {}

  /**
   * Index blockchain events every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async indexEvents() {
    if (this.isIndexing) {
      this.logger.debug('Indexing already in progress, skipping...');
      return;
    }

    this.isIndexing = true;
    this.logger.log('Starting blockchain event indexing...');

    try {
      // Get unprocessed events
      const unprocessedEvents = await this.eventRepository.find({
        where: { processed: false },
        order: { blockchainTimestamp: 'ASC' },
        take: 100,
      });

      this.logger.log(`Found ${unprocessedEvents.length} unprocessed events`);

      for (const event of unprocessedEvents) {
        try {
          await this.processEvent(event);
          
          // Mark as processed
          event.processed = true;
          await this.eventRepository.save(event);
          
          this.logger.debug(`Processed event: ${event.id}`);
        } catch (error) {
          this.logger.error(
            `Failed to process event ${event.id}: ${error.message}`,
          );
        }
      }

      this.logger.log('Blockchain event indexing completed');
    } catch (error) {
      this.logger.error(`Event indexing failed: ${error.message}`);
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Sync trail data for specific blood units
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncTrailData() {
    this.logger.log('Starting trail data sync...');

    try {
      // Get trails that need updating (older than 10 minutes)
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
          this.logger.error(
            `Failed to sync trail for unit ${trail.unitId}: ${error.message}`,
          );
        }
      }

      this.logger.log('Trail data sync completed');
    } catch (error) {
      this.logger.error(`Trail sync failed: ${error.message}`);
    }
  }

  /**
   * Process a blockchain event
   */
  private async processEvent(event: BlockchainEvent): Promise<void> {
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
        this.logger.warn(`Unknown event type: ${event.eventType}`);
    }
  }

  /**
   * Handle blood registration event
   */
  private async handleBloodRegistered(event: BlockchainEvent): Promise<void> {
    const { unitId } = event.eventData;

    // Create initial trail record
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

  /**
   * Handle custody transfer event
   */
  private async handleCustodyTransferred(
    event: BlockchainEvent,
  ): Promise<void> {
    const { unitId } = event.eventData;
    await this.syncUnitTrail(unitId);
  }

  /**
   * Handle temperature log event
   */
  private async handleTemperatureLogged(event: BlockchainEvent): Promise<void> {
    const { unitId } = event.eventData;
    await this.syncUnitTrail(unitId);
  }

  /**
   * Sync trail data for a specific unit
   */
  async syncUnitTrail(unitId: number): Promise<void> {
    try {
      // Fetch latest trail from blockchain
      const trailData = await this.sorobanService.getUnitTrail(unitId);

      // Find or create trail record
      let trail = await this.trailRepository.findOne({ where: { unitId } });

      if (!trail) {
        trail = this.trailRepository.create({ unitId });
      }

      // Update trail data
      trail.custodyTrail = trailData.custodyTrail;
      trail.temperatureLogs = trailData.temperatureLogs;
      trail.statusHistory = trailData.statusHistory;
      trail.lastSyncedAt = new Date();

      await this.trailRepository.save(trail);
      this.logger.debug(`Synced trail for unit ${unitId}`);
    } catch (error) {
      this.logger.error(
        `Failed to sync trail for unit ${unitId}: ${error.message}`,
      );
      throw error;
    }
  }
}
