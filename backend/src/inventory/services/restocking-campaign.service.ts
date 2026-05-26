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
      where: { bloodBankId, bloodType: bloodType as any },
    });
    if (!stock) return;

    // Check for existing active campaign to avoid duplicates
    const existing = await this.campaignRepo.findOne({
      where: { bloodBankId, bloodType: bloodType as any, status: CampaignStatus.ACTIVE },
    });
    if (existing) return;

    const LOW_STOCK_THRESHOLD = 10;
    if (stock.availableUnits <= LOW_STOCK_THRESHOLD) {
      const campaign = await this.campaignRepo.save(
        this.campaignRepo.create({
          bloodType,
          bloodBankId,
          region: 'default',
          thresholdUnits: LOW_STOCK_THRESHOLD,
          currentUnits: stock.availableUnits,
          targetUnits: LOW_STOCK_THRESHOLD * 5,
          status: CampaignStatus.ACTIVE,
        }),
      );

      await this.outreachQueue.add('donor-outreach', {
        bloodType,
        region: 'default',
        urgency: stock.availableUnits <= 3 ? 'critical' : 'high',
        projectedDaysOfSupply: stock.availableUnits,
        requiredUnits: campaign.targetUnits - stock.availableUnits,
        campaignId: campaign.id,
      });

      this.logger.log(`Campaign ${campaign.id} triggered for ${bloodType} at ${bloodBankId}`);
    }
  }

  async createCampaign(dto: CreateCampaignDto): Promise<RestockingCampaignEntity> {
    const stock = await this.stockRepo.findOne({
      where: { bloodBankId: dto.bloodBankId, bloodType: dto.bloodType as any },
    });

    const campaign = await this.campaignRepo.save(
      this.campaignRepo.create({
        ...dto,
        currentUnits: stock?.availableUnits ?? 0,
        status: CampaignStatus.ACTIVE,
      }),
    );

    await this.outreachQueue.add('donor-outreach', {
      bloodType: dto.bloodType,
      region: dto.region,
      urgency: 'high',
      projectedDaysOfSupply: stock?.availableUnits ?? 0,
      requiredUnits: dto.targetUnits - (stock?.availableUnits ?? 0),
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
