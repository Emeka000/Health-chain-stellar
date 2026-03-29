import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';

import { InventoryStockEntity } from '../inventory/entities/inventory-stock.entity';
import { RiderEntity } from '../riders/entities/rider.entity';
import { RiderStatus } from '../riders/enums/rider-status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { HospitalEntity } from '../hospitals/entities/hospital.entity';
import { NotificationChannel } from '../notifications/enums/notification-channel.enum';
import { BloodType } from '../blood-units/enums/blood-type.enum';

import { SurgeRuleEntity } from './entities/surge-rule.entity';
import { SurgeSimulationRequestDto } from './dto/surge-simulation.dto';

export interface SurgeSimulationResult {
  surgeDemandUnits: number;
  baselineStockUnits: number;
  riderCapacityUnits: number;
  unitsPerRiderAssumption: number;
  activeRidersConsidered: number;
  stockGapUnits: number;
  riderGapUnits: number;
  canAbsorbWithStock: boolean;
  canAbsorbWithRiders: boolean;
  summary: string;
}

export interface SurgeEvaluationResult {
  activated: BloodType[];
  deactivated: BloodType[];
  activeRules: SurgeRuleEntity[];
}

@Injectable()
export class SurgeSimulationService {
  private readonly logger = new Logger(SurgeSimulationService.name);

  constructor(
    @InjectRepository(InventoryStockEntity)
    private readonly inventoryRepo: Repository<InventoryStockEntity>,
    @InjectRepository(RiderEntity)
    private readonly riderRepo: Repository<RiderEntity>,
    @InjectRepository(SurgeRuleEntity)
    private readonly surgeRuleRepo: Repository<SurgeRuleEntity>,
    @InjectRepository(HospitalEntity)
    private readonly hospitalRepo: Repository<HospitalEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async simulate(dto: SurgeSimulationRequestDto): Promise<SurgeSimulationResult> {
    const unitsPerRider = dto.unitsPerRider ?? 4;

    let baselineStockUnits = dto.overrideStockUnits;
    if (baselineStockUnits === undefined) {
      const rows = await this.inventoryRepo.find();
      baselineStockUnits = rows.reduce(
        (sum, r) => sum + (Number(r.availableUnitsMl) || 0),
        0,
      );
    }

    let riderCapacityUnits = dto.overrideRiderCapacityUnits;
    let activeRidersConsidered = 0;
    if (riderCapacityUnits === undefined) {
      const activeStatuses = [RiderStatus.AVAILABLE, RiderStatus.ON_DELIVERY, RiderStatus.BUSY];
      activeRidersConsidered = await this.riderRepo
        .createQueryBuilder('r')
        .where('r.status IN (:...statuses)', { statuses: activeStatuses })
        .getCount();
      riderCapacityUnits = Math.floor(activeRidersConsidered * unitsPerRider);
    } else {
      activeRidersConsidered = Math.ceil(riderCapacityUnits / unitsPerRider);
    }

    const stockGapUnits = Math.max(0, dto.surgeDemandUnits - baselineStockUnits);
    const riderGapUnits = Math.max(0, dto.surgeDemandUnits - riderCapacityUnits);
    const canAbsorbWithStock = baselineStockUnits >= dto.surgeDemandUnits;
    const canAbsorbWithRiders = riderCapacityUnits >= dto.surgeDemandUnits;

    const summary = [
      canAbsorbWithStock
        ? 'Reported stock can cover the surge.'
        : `Stock short by approximately ${stockGapUnits} units.`,
      canAbsorbWithRiders
        ? 'Modeled rider capacity can cover concurrent delivery needs.'
        : `Rider capacity short by approximately ${riderGapUnits} units (at ${unitsPerRider} units / rider).`,
    ].join(' ');

    return {
      surgeDemandUnits: dto.surgeDemandUnits,
      baselineStockUnits,
      riderCapacityUnits,
      unitsPerRiderAssumption: unitsPerRider,
      activeRidersConsidered,
      stockGapUnits,
      riderGapUnits,
      canAbsorbWithStock,
      canAbsorbWithRiders,
      summary,
    };
  }

  /**
   * Evaluate all surge rules against current inventory.
   * Activates rules where stock < threshold, deactivates where stock has recovered.
   * Emits surge.activated / surge.deactivated events and notifies hospitals.
   */
  async evaluateSurge(): Promise<SurgeEvaluationResult> {
    const rules = await this.surgeRuleRepo.find();
    if (rules.length === 0) return { activated: [], deactivated: [], activeRules: [] };

    // Aggregate available stock per blood type across all banks
    const stockRows = await this.inventoryRepo
      .createQueryBuilder('s')
      .select('s.blood_type', 'bloodType')
      .addSelect('SUM(s.available_units_ml)', 'total')
      .groupBy('s.blood_type')
      .getRawMany<{ bloodType: BloodType; total: string }>();

    const stockMap = new Map<BloodType, number>(
      stockRows.map((r) => [r.bloodType, Number(r.total)]),
    );

    const activated: BloodType[] = [];
    const deactivated: BloodType[] = [];
    const toSave: SurgeRuleEntity[] = [];

    for (const rule of rules) {
      const stock = stockMap.get(rule.bloodType) ?? 0;
      const shouldBeActive = stock < rule.threshold;

      if (shouldBeActive && !rule.active) {
        rule.active = true;
        activated.push(rule.bloodType);
        toSave.push(rule);
        this.eventEmitter.emit('surge.activated', { bloodType: rule.bloodType, stock, threshold: rule.threshold, multiplier: rule.multiplier });
      } else if (!shouldBeActive && rule.active) {
        rule.active = false;
        deactivated.push(rule.bloodType);
        toSave.push(rule);
        this.eventEmitter.emit('surge.deactivated', { bloodType: rule.bloodType, stock, threshold: rule.threshold });
      }
    }

    if (toSave.length > 0) {
      await this.surgeRuleRepo.save(toSave);
    }

    if (activated.length > 0) {
      await this.notifyHospitals(activated);
    }

    const activeRules = rules.filter((r) => r.active);
    return { activated, deactivated, activeRules };
  }

  async findAllRules(): Promise<SurgeRuleEntity[]> {
    return this.surgeRuleRepo.find();
  }

  async upsertRule(dto: Partial<SurgeRuleEntity> & { bloodType: BloodType }): Promise<SurgeRuleEntity> {
    const existing = await this.surgeRuleRepo.findOne({ where: { bloodType: dto.bloodType } });
    const rule = existing ?? this.surgeRuleRepo.create({ active: false });
    Object.assign(rule, dto);
    return this.surgeRuleRepo.save(rule);
  }

  async deleteRule(id: string): Promise<void> {
    await this.surgeRuleRepo.delete(id);
  }

  private async notifyHospitals(bloodTypes: BloodType[]): Promise<void> {
    const hospitals = await this.hospitalRepo.find({ select: ['id'] });
    const bloodTypeList = bloodTypes.join(', ');

    await Promise.allSettled(
      hospitals.map((h) =>
        this.notificationsService.send({
          recipientId: h.id,
          channels: [NotificationChannel.IN_APP],
          templateKey: 'surge.activated',
          variables: { bloodTypes: bloodTypeList },
        }).catch((err) => this.logger.warn(`Surge notification failed for hospital ${h.id}: ${err.message}`)),
      ),
    );
  }
}
