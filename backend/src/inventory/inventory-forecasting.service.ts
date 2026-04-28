import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { Repository, MoreThanOrEqual } from 'typeorm';

import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';
import { DonationEntity } from '../donations/entities/donation.entity';
import { InventoryLowEvent } from '../events/inventory-low.event';
import { OrderEntity } from '../orders/entities/order.entity';

import { InventoryEntity } from './entities/inventory.entity';
import {
  DemandForecast,
  ForecastSeasonality,
  ForecastThreshold,
} from './interfaces/forecast.interface';
import { forecastHoltWinters } from './services/holt-winters';

@Injectable()
export class InventoryForecastingService {
  private readonly logger = new Logger(InventoryForecastingService.name);
  private readonly defaultThreshold: number;
  private readonly historyDays: number;
  private readonly defaultSeasonLength: number;
  private thresholds: Map<string, number> = new Map();
  private seasonality: Map<string, ForecastSeasonality> = new Map();

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @InjectRepository(BloodRequestEntity)
    private readonly requestRepo: Repository<BloodRequestEntity>,
    @InjectRepository(DonationEntity)
    private readonly donationRepo: Repository<DonationEntity>,
    @InjectRepository(InventoryEntity)
    private readonly inventoryRepo: Repository<InventoryEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    @InjectQueue('donor-outreach') private readonly outreachQueue: Queue,
  ) {
    this.defaultThreshold = Number(
      this.configService.get<number>('INVENTORY_FORECAST_THRESHOLD_DAYS', 3),
    );
    this.historyDays = Number(
      this.configService.get<number>('INVENTORY_FORECAST_HISTORY_DAYS', 30),
    );
    this.defaultSeasonLength = Number(
      this.configService.get<number>(
        'INVENTORY_FORECAST_DEFAULT_SEASON_LENGTH',
        7,
      ),
    );
    this.loadThresholds();
    this.loadSeasonality();
  }

  private loadThresholds() {
    this.thresholds.clear();
    const thresholdsConfig = this.configService.get<string>(
      'INVENTORY_FORECAST_THRESHOLDS',
    );
    if (thresholdsConfig) {
      try {
        const parsed: ForecastThreshold[] =
          typeof thresholdsConfig === 'string'
            ? JSON.parse(thresholdsConfig)
            : thresholdsConfig;
        parsed.forEach((t) => {
          this.thresholds.set(`${t.bloodType}:${t.region}`, t.daysThreshold);
        });
      } catch (err) {
        this.logger.warn(
          'Failed to parse INVENTORY_FORECAST_THRESHOLDS, using defaults',
        );
      }
    }
  }

  private getThreshold(bloodType: string, region: string): number {
    return (
      this.thresholds.get(`${bloodType}:${region}`) || this.defaultThreshold
    );
  }

  private loadSeasonality() {
    this.seasonality.clear();
    const seasonalityConfig = this.configService.get<string>(
      'INVENTORY_FORECAST_SEASONALITY',
    );

    if (!seasonalityConfig) {
      return;
    }

    try {
      const parsed: ForecastSeasonality[] =
        typeof seasonalityConfig === 'string'
          ? JSON.parse(seasonalityConfig)
          : seasonalityConfig;

      parsed.forEach((entry) => {
        this.seasonality.set(`${entry.bloodType}:${entry.region}`, entry);
      });
    } catch {
      this.logger.warn(
        'Failed to parse INVENTORY_FORECAST_SEASONALITY, using defaults',
      );
    }
  }

  private getSeasonalityConfig(
    bloodType: string,
    region: string,
  ): ForecastSeasonality {
    return (
      this.seasonality.get(`${bloodType}:${region}`) ||
      this.seasonality.get(`${bloodType}:*`) ||
      this.seasonality.get(`*:${region}`) || {
        bloodType,
        region,
        seasonLength: this.defaultSeasonLength,
      }
    );
  }

  async recalibrate(primeForecast = true) {
    this.loadThresholds();
    this.loadSeasonality();

    const forecasts = primeForecast ? await this.calculateDemandForecasts() : [];

    return {
      recalibratedAt: new Date().toISOString(),
      thresholdCount: this.thresholds.size,
      seasonalityCount: this.seasonality.size,
      forecastCount: forecasts.length,
    };
  }

  @Cron(process.env.INVENTORY_FORECAST_CRON || CronExpression.EVERY_6_HOURS)
  async runForecast() {
    this.logger.log('Running inventory forecast');

    try {
      const forecasts = await this.calculateDemandForecasts();

      for (const forecast of forecasts) {
        const threshold = this.getThreshold(
          forecast.bloodType,
          forecast.region,
        );

        if (forecast.projectedDaysOfSupply < threshold) {
          this.logger.warn(
            `Low inventory alert: ${forecast.bloodType} in ${forecast.region} - ` +
              `${forecast.projectedDaysOfSupply.toFixed(1)} days remaining (threshold: ${threshold})`,
          );

          await this.handleLowInventory(forecast, threshold);
        }
      }

      this.logger.log(
        `Forecast complete. Processed ${forecasts.length} blood type/region combinations`,
      );
    } catch (error) {
      this.logger.error('Forecast failed', error);
    }
  }

  async calculateDemandForecasts(): Promise<DemandForecast[]> {
    const cutoffDate = new Date();
    cutoffDate.setHours(0, 0, 0, 0);
    cutoffDate.setDate(cutoffDate.getDate() - this.historyDays + 1);

    const [orders, requests, donations, inventories] = await Promise.all([
      this.orderRepo.find({
        where: {
          createdAt: MoreThanOrEqual(cutoffDate),
        },
        select: ['bloodType', 'quantity', 'deliveryAddress', 'createdAt'],
      }),
      this.requestRepo.find({
        where: {
          createdAt: MoreThanOrEqual(cutoffDate),
        },
      }),
      this.donationRepo.find({
        where: {
          createdAt: MoreThanOrEqual(cutoffDate),
        },
        select: ['metadata', 'createdAt'],
      }),
      this.inventoryRepo.find({
        select: ['bloodType', 'region', 'quantity'],
      }),
    ]);

    const demandSeries = new Map<string, number[]>();
    const warmupSeries = new Map<string, number[]>();
    const currentStockMap = new Map<string, number>();
    const dayInMs = 24 * 60 * 60 * 1000;
    const cutoffTime = cutoffDate.getTime();

    const ensureSeries = (key: string): number[] => {
      const existing = demandSeries.get(key);
      if (existing) {
        return existing;
      }

      const created = Array.from({ length: this.historyDays }, () => 0);
      demandSeries.set(key, created);
      return created;
    };

    const addObservation = (key: string, date: Date, quantity: number) => {
      if (!Number.isFinite(quantity)) {
        return;
      }

      const normalizedQuantity = Math.max(0, quantity);
      const index = Math.floor((date.getTime() - cutoffTime) / dayInMs);

      if (index < 0 || index >= this.historyDays) {
        return;
      }

      ensureSeries(key)[index] += normalizedQuantity;
    };

    orders.forEach((order) => {
      const key = `${order.bloodType}:${this.extractRegion(order.deliveryAddress)}`;
      addObservation(key, order.createdAt, Number(order.quantity));
    });

    requests.forEach((request) => {
      const region = this.extractRegion(request.deliveryAddress);

      request.items?.forEach((item) => {
        const key = `${item.bloodType}:${region}`;
        addObservation(key, request.createdAt, item.quantityMl / 450);
      });
    });

    donations.forEach((donation) => {
      const signal = this.extractDonationWarmupSignal(donation);
      if (!signal) {
        return;
      }

      const key = `${signal.bloodType}:${signal.region}`;
      ensureSeries(key);

      if (signal.quantity > 0) {
        const existing = warmupSeries.get(key) || [];
        existing.push(signal.quantity);
        warmupSeries.set(key, existing);
      }
    });

    inventories.forEach((inventory) => {
      const key = `${inventory.bloodType}:${inventory.region}`;
      ensureSeries(key);
      currentStockMap.set(key, (currentStockMap.get(key) || 0) + inventory.quantity);
    });

    const forecasts: DemandForecast[] = [];

    for (const [key, series] of demandSeries.entries()) {
      const [bloodType, region] = key.split(':');
      const seasonality = this.getSeasonalityConfig(bloodType, region);
      const result = forecastHoltWinters(series, {
        seasonLength: seasonality.seasonLength,
        alpha: seasonality.alpha,
        beta: seasonality.beta,
        gamma: seasonality.gamma,
        forecastPoints: 1,
        warmupValues: warmupSeries.get(key),
      });
      const forecastedDemand = result.forecast[0] ?? 0;
      const currentStock = currentStockMap.get(key) || 0;

      const projectedDaysOfSupply =
        forecastedDemand > 0 ? currentStock / forecastedDemand : Infinity;

      forecasts.push({
        bloodType,
        region,
        currentStock,
        averageDailyDemand: forecastedDemand,
        projectedDaysOfSupply,
        forecastedDemand,
        seasonLength: seasonality.seasonLength,
        sampleSize: series.length + (warmupSeries.get(key)?.length || 0),
      });
    }

    return forecasts.sort(
      (left, right) => left.projectedDaysOfSupply - right.projectedDaysOfSupply,
    );
  }

  private async handleLowInventory(
    forecast: DemandForecast,
    threshold: number,
  ) {
    const event = new InventoryLowEvent(
      forecast.bloodType,
      forecast.region,
      forecast.currentStock,
      forecast.projectedDaysOfSupply,
      forecast.averageDailyDemand,
      threshold,
    );

    this.eventEmitter.emit('inventory.low', event);

    await this.outreachQueue.add('recommend-donor-outreach', {
      bloodType: forecast.bloodType,
      region: forecast.region,
      urgency: forecast.projectedDaysOfSupply < 1 ? 'critical' : 'high',
      projectedDaysOfSupply: forecast.projectedDaysOfSupply,
      requiredUnits: Math.ceil(
        forecast.averageDailyDemand * threshold - forecast.currentStock,
      ),
    });
  }

  private extractRegion(address?: string | null): string {
    if (!address) {
      return 'Unknown';
    }

    const parts = address.split(',').map((part) => part.trim());
    return parts[parts.length - 1] || 'Unknown';
  }

  private extractDonationWarmupSignal(
    donation: Pick<DonationEntity, 'metadata'>,
  ): { bloodType: string; region: string; quantity: number } | null {
    const metadata = donation.metadata as
      | {
          bloodType?: string;
          region?: string;
          quantity?: number;
          units?: number;
          quantityMl?: number;
          inventory?: {
            bloodType?: string;
            region?: string;
            quantity?: number;
            units?: number;
            quantityMl?: number;
          };
        }
      | null
      | undefined;

    const bloodType = metadata?.bloodType || metadata?.inventory?.bloodType;
    const region = metadata?.region || metadata?.inventory?.region;
    const quantity =
      metadata?.quantity ??
      metadata?.units ??
      metadata?.inventory?.quantity ??
      metadata?.inventory?.units ??
      (metadata?.quantityMl ?? metadata?.inventory?.quantityMl ?? 0) / 450;

    if (!bloodType || !region) {
      return null;
    }

    return {
      bloodType,
      region,
      quantity: Number(quantity) || 0,
    };
  }
}
