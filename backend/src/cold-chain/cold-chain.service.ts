import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';

import { TemperatureSampleEntity } from './entities/temperature-sample.entity';
import { DeliveryComplianceEntity } from './entities/delivery-compliance.entity';
import { IngestTelemetryDto } from './dto/ingest-telemetry.dto';

const SAFE_MIN_C = 2;
const SAFE_MAX_C = 8;

export interface ColdChainBreachEvent {
  deliveryId: string;
  orderId: string | null;
  breachDurationMinutes: number;
  minTempCelsius: number;
  maxTempCelsius: number;
  breachStartedAt: Date;
}

export class ColdChainBreachPayload implements ColdChainBreachEvent {
  constructor(
    public readonly deliveryId: string,
    public readonly orderId: string | null,
    public readonly breachDurationMinutes: number,
    public readonly minTempCelsius: number,
    public readonly maxTempCelsius: number,
    public readonly breachStartedAt: Date,
  ) {}
}

@Injectable()
export class ColdChainService {
  private readonly suspensionThresholdMinutes: number;

  constructor(
    @InjectRepository(TemperatureSampleEntity)
    private readonly sampleRepo: Repository<TemperatureSampleEntity>,
    @InjectRepository(DeliveryComplianceEntity)
    private readonly complianceRepo: Repository<DeliveryComplianceEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {
    this.suspensionThresholdMinutes = this.configService.get<number>(
      'COLD_CHAIN_SUSPENSION_THRESHOLD_MINUTES',
      15,
    );
  }

  async ingest(dto: IngestTelemetryDto): Promise<TemperatureSampleEntity> {
    const temp = dto.temperatureCelsius;
    const isExcursion = temp < SAFE_MIN_C || temp > SAFE_MAX_C;

    const sample = this.sampleRepo.create({
      deliveryId: dto.deliveryId,
      orderId: dto.orderId ?? null,
      temperatureCelsius: temp,
      recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      source: dto.source ?? 'manual',
      isExcursion,
    });

    const saved = await this.sampleRepo.save(sample);
    await this.recalcCompliance(dto.deliveryId, dto.orderId ?? null);
    return saved;
  }

  async getTimeline(deliveryId: string): Promise<TemperatureSampleEntity[]> {
    return this.sampleRepo.find({
      where: { deliveryId },
      order: { recordedAt: 'ASC' },
    });
  }

  async getCompliance(deliveryId: string): Promise<DeliveryComplianceEntity> {
    const c = await this.complianceRepo.findOne({ where: { deliveryId } });
    if (!c) throw new NotFoundException(`No compliance record for delivery '${deliveryId}'`);
    return c;
  }

  private async recalcCompliance(deliveryId: string, orderId: string | null): Promise<void> {
    const samples = await this.sampleRepo.find({
      where: { deliveryId },
      order: { recordedAt: 'ASC' },
    });
    if (!samples.length) return;

    const temps = samples.map((s) => s.temperatureCelsius);
    const excursions = samples.filter((s) => s.isExcursion);
    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);
    const isCompliant = excursions.length === 0;

    // Compute cumulative breach duration from consecutive excursion windows
    const breachDurationMinutes = this.computeBreachDuration(samples);
    const breachStartedAt = excursions.length > 0 ? excursions[0].recordedAt : null;

    const hash = createHash('sha256')
      .update(`${deliveryId}:${minTemp}:${maxTemp}:${excursions.length}:${isCompliant}`)
      .digest('hex');

    let record = await this.complianceRepo.findOne({ where: { deliveryId } });
    if (!record) {
      record = this.complianceRepo.create({ deliveryId, orderId });
    }

    record.isCompliant = isCompliant;
    record.excursionCount = excursions.length;
    record.minTempCelsius = minTemp;
    record.maxTempCelsius = maxTemp;
    record.complianceHash = hash;
    record.evaluatedAt = new Date();
    record.breachDurationMinutes = breachDurationMinutes;
    record.breachStartedAt = breachStartedAt;

    await this.complianceRepo.save(record);

    // Fire suspension event if threshold crossed and not already triggered
    if (
      !record.suspensionTriggered &&
      breachDurationMinutes >= this.suspensionThresholdMinutes &&
      excursions.length > 0
    ) {
      record.suspensionTriggered = true;
      await this.complianceRepo.save(record);

      const breachEvent: ColdChainBreachEvent = {
        deliveryId,
        orderId,
        breachDurationMinutes,
        minTempCelsius: minTemp,
        maxTempCelsius: maxTemp,
        breachStartedAt: breachStartedAt!,
      };

      this.eventEmitter.emit('cold-chain.breach', breachEvent);
    }
  }

  /**
   * Computes cumulative minutes spent outside 2–8 °C by summing gaps
   * between consecutive excursion samples.
   */
  private computeBreachDuration(samples: TemperatureSampleEntity[]): number {
    let totalMinutes = 0;
    let breachWindowStart: Date | null = null;

    for (const sample of samples) {
      if (sample.isExcursion) {
        if (!breachWindowStart) {
          breachWindowStart = sample.recordedAt;
        }
        // Extend window to this sample's timestamp
        const windowEnd = sample.recordedAt;
        totalMinutes =
          (windowEnd.getTime() - breachWindowStart.getTime()) / 60_000;
      } else {
        // Safe sample — close any open breach window
        breachWindowStart = null;
      }
    }

    return totalMinutes;
  }
}
