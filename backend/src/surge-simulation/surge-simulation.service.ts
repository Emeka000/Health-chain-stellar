import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { BloodType } from '../blood-units/enums/blood-type.enum';
import {
  PaginationQueryDto,
  PaginatedResponse,
  PaginationUtil,
} from '../common/pagination';
import { HospitalEntity } from '../hospitals/entities/hospital.entity';
import { InventoryStockEntity } from '../inventory/entities/inventory-stock.entity';
import { NotificationChannel } from '../notifications/enums/notification-channel.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { RiderEntity } from '../riders/entities/rider.entity';
import { RiderStatus } from '../riders/enums/rider-status.enum';

import {
  SurgeSimulationRequestDto,
  CreateScenarioDto,
} from './dto/surge-simulation.dto';
import { SurgeRuleEntity } from './entities/surge-rule.entity';
import {
  SurgeScenarioEntity,
  ScenarioStatus,
} from './entities/surge-scenario.entity';

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

/** Default volume of a single blood unit in millilitres (a standard bag). */
const DEFAULT_UNIT_VOLUME_ML = 450;

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

  async simulate(
    dto: SurgeSimulationRequestDto,
    seed?: number,
  ): Promise<SurgeSimulationResult> {
    const rng = seededRandom(seed ?? Date.now());
    const unitsPerRider = dto.unitsPerRider ?? 4;

    let baselineStockUnits = dto.overrideStockUnits;
    if (baselineStockUnits === undefined) {
      // Inventory is stored in millilitres; convert to whole blood units so the
      // baseline is comparable to surgeDemandUnits (which is in units).
      const unitVolumeMl =
        dto.unitVolumeMl && dto.unitVolumeMl > 0
          ? dto.unitVolumeMl
          : DEFAULT_UNIT_VOLUME_ML;

      const stockQuery = this.inventoryRepo
        .createQueryBuilder('s')
        .select('SUM(s.availableUnitsMl)', 'total');

      if (dto.bloodType) {
        stockQuery.andWhere('s.bloodType = :bloodType', {
          bloodType: dto.bloodType,
        });
      }
      if (dto.region) {
        stockQuery.andWhere('s.region = :region', { region: dto.region });
      }

      const _aggResult = await stockQuery.getRawOne<{ total: string }>();
      const totalMl = parseInt(_aggResult?.total ?? '0', 10);
      baselineStockUnits = Math.floor(totalMl / unitVolumeMl);
    }

    let riderCapacityUnits = dto.overrideRiderCapacityUnits;
    let activeRidersConsidered = 0;
    if (riderCapacityUnits === undefined) {
      const activeStatuses = [
        RiderStatus.AVAILABLE,
        RiderStatus.ON_DELIVERY,
        RiderStatus.BUSY,
      ];
      activeRidersConsidered = await this.riderRepo
        .createQueryBuilder('r')
        .where('r.status IN (:...statuses)', { statuses: activeStatuses })
        .getCount();
      riderCapacityUnits = Math.floor(activeRidersConsidered * unitsPerRider);
    } else {
      activeRidersConsidered = Math.ceil(riderCapacityUnits / unitsPerRider);
    }

    const stockGapUnits = Math.max(
      0,
      dto.surgeDemandUnits - baselineStockUnits,
    );
    const riderGapUnits = Math.max(
      0,
      dto.surgeDemandUnits - riderCapacityUnits,
    );
    const canAbsorbWithStock = baselineStockUnits >= dto.surgeDemandUnits;
    const canAbsorbWithRiders = riderCapacityUnits >= dto.surgeDemandUnits;

    // Outcome metrics
    const shortageRiskScore = canAbsorbWithStock
      ? 0
      : Math.min(1, stockGapUnits / dto.surgeDemandUnits);
    const breachProbability = canAbsorbWithRiders
      ? 0
      : Math.min(1, riderGapUnits / dto.surgeDemandUnits);
    // Latency: base 30 min + stochastic jitter from seed
    const estimatedFulfillmentLatencyMinutes = Math.round(
      30 + shortageRiskScore * 60 + rng() * 10,
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

  async createScenario(
    dto: CreateScenarioDto,
    createdBy: string,
  ): Promise<SurgeScenarioEntity> {
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
    const scenario = await this.scenarioRepo.findOne({
      where: { id: scenarioId },
    });
    if (!scenario)
      throw new NotFoundException(`Scenario ${scenarioId} not found`);

    await this.scenarioRepo.update(scenarioId, {
      status: ScenarioStatus.RUNNING,
    });

    try {
      const result = await this.simulate(
        {
          surgeDemandUnits: scenario.surgeDemandUnits,
          overrideStockUnits: scenario.overrideStockUnits ?? undefined,
          overrideRiderCapacityUnits:
            scenario.overrideRiderCapacityUnits ?? undefined,
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
      await this.scenarioRepo.update(scenarioId, {
        status: ScenarioStatus.FAILED,
      });
      throw err;
    }
  }

  async listScenarios(
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<
