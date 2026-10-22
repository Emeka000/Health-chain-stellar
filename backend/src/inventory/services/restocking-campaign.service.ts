import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { InventoryStockEntity } from '../entities/inventory-stock.entity';
import {
  CampaignStatus,
  RestockingCampaignEntity,
} from '../entities/restocking-campaign.entity';
import { CreateCampaignDto } from '../dto/create-campaign.dto';

@Injectable()
export class RestockingCampaignService {
  private readonly logger = new Logger(RestockingCampaignService.name);

  constructor(
    @InjectRepository(RestockingCampaignEntity)
    private readonly campaignRepo: Repository<RestockingCampaignEntity>,
    @InjectRepository(InventoryStockEntity)
    private readonly stockRepo: Repository<InventoryStockEntity>,
    @InjectQueue('donor-outreach')
    private readonly outreachQueue: Queue,
  ) {}

  async triggerCampaignIfLow(bloodBankId: string, bloodType: string): Promise<void> {
    const stock = await this.stockRepo.findOne({
      where: { bloodBankId, bloodType },
    });
    if (!stock) return;

    // Check for existing active campaign to avoid duplicates
    const existing = await this.campaignRepo.findOne({
      where: { bloodBankId, bloodType, status: CampaignStatus.ACTIVE },
    });
    if (existing) return;

    const LOW_STOCK_THRESHOLD = 10;
    // Convert ml stock to unit count before comparing against unit thresholds.
    const availableUnits = stock.availableUnitsCount;
    if (availableUnits <= LOW_STOCK_THRESHOLD) {
      const targetUnits = LOW_STOCK_THRESHOLD * 5;
      const campaign = await this.campaignRepo.save(
        this.campaignRepo.create({
          bloodType,
          bloodBankId,
          region: 'default',
          thresholdUnits: LOW_STOCK_THRESHOLD,
          currentUnits: availableUnits,
          targetUnits: targetUnits,
          status: CampaignStatus.ACTIVE,
        }),
      );

      await this.outreachQueue.add('donor-outreach', {
        bloodType,
        region: 'default',
        urgency: availableUnits <= 3 ? 'critical' : 'high',
        projectedDaysOfSupply: availableUnits,
        requiredUnits: Math.max(0, targetUnits - availableUnits),
        campaignId: campaign.id,
      });

      this.logger.log(`Campaign ${campaign.id} triggered for ${bloodType} at ${bloodBankId}`);
    }
  }

  async createCampaign(dto: CreateCampaignDto): Promise<RestockingCampaignEntity> {
    const stock = await this.stockRepo.findOne({
      where: { bloodBankId: dto.bloodBankId, bloodType: dto.bloodType },
    });

    const availableUnits = stock?.availableUnitsCount ?? 0;

    const campaign = await this.campaignRepo.save(
      this.campaignRepo.create({
        ...dto,
        currentUnits: availableUnits,
        status: CampaignStatus.ACTIVE,
      }),
    );

    await this.outreachQueue.add('donor-outreach', {
      bloodType: dto.bloodType,
      region: dto.region,
      urgency: 'high',
      projectedDaysOfSupply: availableUnits,
      requiredUnits: Math.max(0, dto.targetUnits - availableUnits),
      campaignId: campaign.id,
    });

    return campaign;
  }

  async listCampaigns(bloodBankId?: string): Promise<RestockingCampaignEntity[]> {
    return this.campaignRepo.find({
      where: bloodBankId ? { bloodBankId } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async recordConversion(campaignId: string): Promise<void> {
    await this.campaignRepo.increment({ id: campaignId }, 'conversions', 1);

    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    if (campaign && campaign.conversions >= campaign.targetUnits) {
      await this.campaignRepo.update(campaignId, { status: CampaignStatus.COMPLETED });
    }
  }
}
