import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { SurgeScenarioEntity, ScenarioStatus } from './entities/surge-scenario.entity';
import { SurgeSimulationRequestDto, CreateScenarioDto } from './dto/surge-simulation.dto';

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
  /** Fulfillment latency estimate (minutes) */
  estimatedFulfillmentLatencyMinutes: number;
  /** Shortage risk score 0-1 */
  shortageRiskScore: number;
  /** Breach probability 0-1 */
  breachProbability: number;
  summary: string;
}

export interface SurgeEvaluationResult {
  activated: BloodType[];
  deactivated: BloodType[];
  activeRules: SurgeRuleEntity[];
}

export interface ScenarioComparisonResult {
  scenarios: Array<{
    id: string;
    name: string;
    outcome: SurgeSimulationResult;
    policyConfig: Record<string, unknown>;
  }>;
  bottleneck: 'stock' | 'riders' | 'none';
  recommendation: string;
}

/** Seeded pseudo-random number generator (LCG) for deterministic replay */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
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
    @InjectRepository(SurgeScenarioEntity)
    private readonly scenarioRepo: Repository<SurgeScenarioEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async simulate(dto: SurgeSimulationRequestDto, seed?: number): Promise<SurgeSimulationResult> {
    const rng = seededRandom(seed ?? Date.now());
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

    // Outcome metrics
    const shortageRiskScore = canAbsorbWithStock ? 0 : Math.min(1, stockGapUnits / dto.surgeDemandUnits);
    const breachProbability = canAbsorbWithRiders ? 0 : Math.min(1, riderGapUnits / dto.surgeDemandUnits);
    // Latency: base 30 min + stochastic jitter from seed
    const estimatedFulfillmentLatencyMinutes = Math.round(
      30 + (shortageRiskScore * 60) + (rng() * 10),
    );

    const summary = [
      canAbsorbWithStock
        ? 'Reported stock can cover the surge.'
        : `Stock short by approximately ${stockGapUnits} units.`,
      canAbsorbWithRiders
        ? 'Modeled rider capacity can cover concurrent delivery needs.'
        : `Rider capacity short by approximately ${riderGapUnits} units (at ${unitsPerRider} units / rider).`,
      `Estimated fulfillment latency: ~${estimatedFulfillmentLatencyMinutes} min.`,
      `Shortage risk: ${(shortageRiskScore * 100).toFixed(0)}%. Breach probability: ${(breachProbability * 100).toFixed(0)}%.`,
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
      estimatedFulfillmentLatencyMinutes,
      shortageRiskScore,
      breachProbability,
      summary,
    };
  }

  // ── Scenario management ──────────────────────────────────────────────────

  async createScenario(dto: CreateScenarioDto, createdBy: string): Promise<SurgeScenarioEntity> {
    const seed = dto.seed ?? Math.floor(Math.random() * 0xffffffff);
    const scenario = this.scenarioRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      seed,
      surgeDemandUnits: dto.surgeDemandUnits,
      overrideStockUnits: dto.overrideStockUnits ?? null,
      overrideRiderCapacityUnits: dto.overrideRiderCapacityUnits ?? null,
      unitsPerRider: dto.unitsPerRider ?? 4,
      policyConfig: dto.policyConfig ?? {},
      createdBy,
    });
    return this.scenarioRepo.save(scenario);
  }

  /** Replay a stored scenario deterministically using its seed */
  async replayScenario(scenarioId: string): Promise<SurgeSimulationResult> {
    const scenario = await this.scenarioRepo.findOne({ where: { id: scenarioId } });
    if (!scenario) throw new NotFoundException(`Scenario ${scenarioId} not found`);

    await this.scenarioRepo.update(scenarioId, { status: ScenarioStatus.RUNNING });

    try {
      const result = await this.simulate(
        {
          surgeDemandUnits: scenario.surgeDemandUnits,
          overrideStockUnits: scenario.overrideStockUnits ?? undefined,
          overrideRiderCapacityUnits: scenario.overrideRiderCapacityUnits ?? undefined,
          unitsPerRider: scenario.unitsPerRider,
        },
        scenario.seed,
      );

      await this.scenarioRepo.update(scenarioId, {
        status: ScenarioStatus.COMPLETED,
        outcome: result as unknown as Record<string, unknown>,
      });

      return result;
    } catch (err) {
      await this.scenarioRepo.update(scenarioId, { status: ScenarioStatus.FAILED });
      throw err;
    }
  }

  async listScenarios(): Promise<SurgeScenarioEntity[]> {
    return this.scenarioRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getScenario(id: string): Promise<SurgeScenarioEntity> {
    const s = await this.scenarioRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException(`Scenario ${id} not found`);
    return s;
  }

  /** Compare multiple scenarios and identify bottlenecks */
  async compareScenarios(scenarioIds: string[]): Promise<ScenarioComparisonResult> {
    const scenarios = await Promise.all(scenarioIds.map((id) => this.getScenario(id)));

    const results = await Promise.all(
      scenarios.map(async (s) => ({
        id: s.id,
        name: s.name,
        outcome: await this.simulate(
          {
            surgeDemandUnits: s.surgeDemandUnits,
            overrideStockUnits: s.overrideStockUnits ?? undefined,
            overrideRiderCapacityUnits: s.overrideRiderCapacityUnits ?? undefined,
            unitsPerRider: s.unitsPerRider,
          },
          s.seed,
        ),
        policyConfig: s.policyConfig,
      })),
    );

    // Identify dominant bottleneck across scenarios
    const avgStockGap = results.reduce((a, r) => a + r.outcome.stockGapUnits, 0) / results.length;
    const avgRiderGap = results.reduce((a, r) => a + r.outcome.riderGapUnits, 0) / results.length;

    let bottleneck: 'stock' | 'riders' | 'none';
    let recommendation: string;

    if (avgStockGap === 0 && avgRiderGap === 0) {
      bottleneck = 'none';
      recommendation = 'All scenarios can be absorbed with current capacity.';
    } else if (avgStockGap >= avgRiderGap) {
      bottleneck = 'stock';
      recommendation = `Stock is the primary bottleneck (avg gap: ${avgStockGap.toFixed(0)} units). Consider pre-positioning inventory.`;
    } else {
      bottleneck = 'riders';
      recommendation = `Rider capacity is the primary bottleneck (avg gap: ${avgRiderGap.toFixed(0)} units). Consider activating standby riders.`;
    }

    return { scenarios: results, bottleneck, recommendation };
  }

  // ── Existing methods ─────────────────────────────────────────────────────

  async evaluateSurge(): Promise<SurgeEvaluationResult> {
    const rules = await this.surgeRuleRepo.find();
    if (rules.length === 0) return { activated: [], deactivated: [], activeRules: [] };

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
