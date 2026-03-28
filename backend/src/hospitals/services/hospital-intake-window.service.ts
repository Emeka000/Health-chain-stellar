import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { HospitalCapacityConfigEntity } from '../entities/hospital-capacity-config.entity';
import { HospitalOverrideAuditEntity } from '../entities/hospital-override-audit.entity';
import { OverrideReason } from '../enums/override-reason.enum';
import {
  ConstraintViolation,
  IntakeWindowCheckResult,
} from '../dto/intake-window-check.dto';

@Injectable()
export class HospitalIntakeWindowService {
  private readonly logger = new Logger(HospitalIntakeWindowService.name);

  constructor(
    @InjectRepository(HospitalCapacityConfigEntity)
    private readonly configRepo: Repository<HospitalCapacityConfigEntity>,
    @InjectRepository(HospitalOverrideAuditEntity)
    private readonly overrideAuditRepo: Repository<HospitalOverrideAuditEntity>,
  ) {}

  /**
   * Core check: can a hospital receive blood at the projected delivery time?
   * Returns a structured result with individual constraint violations so callers
   * can decide whether to block, warn, or request an override.
   */
  async checkIntakeWindow(
    hospitalId: string,
    projectedDeliveryAt: Date,
    unitsRequested = 1,
  ): Promise<IntakeWindowCheckResult> {
    const config = await this.configRepo.findOne({ where: { hospitalId } });

    // No config means no constraints — always receivable
    if (!config || !config.isEnforced) {
      return this.buildOpenResult(hospitalId, projectedDeliveryAt);
    }

    const violations: ConstraintViolation[] = [];

    // 1. Storage capacity check
    const availableStorage =
      config.coldStorageCapacityUnits - config.currentStorageUnits;
    const storageAvailable = availableStorage >= unitsRequested;
    if (!storageAvailable) {
      violations.push({
        type: 'storage_capacity',
        message: `Cold storage at capacity. Available: ${availableStorage} units, requested: ${unitsRequested}`,
        detail: {
          capacity: config.coldStorageCapacityUnits,
          current: config.currentStorageUnits,
          requested: unitsRequested,
          available: availableStorage,
        },
      });
    }

    // 2. Blackout period check
    const inBlackout = this.isInBlackoutPeriod(config, projectedDeliveryAt);
    if (inBlackout) {
      const period = this.getActiveBlackout(config, projectedDeliveryAt);
      violations.push({
        type: 'blackout_period',
        message: `Hospital is in a blackout period: ${period?.label ?? 'unknown'}`,
        detail: { period },
      });
    }

    // 3. Receiving window check (only if not in blackout and windows are defined)
    const hasWindows =
      config.receivingWindows && config.receivingWindows.length > 0;
    const withinWindow = hasWindows
      ? this.isWithinReceivingWindow(config, projectedDeliveryAt)
      : true; // null windows = 24/7

    if (hasWindows && !withinWindow) {
      violations.push({
        type: 'receiving_window',
        message: `Projected delivery time falls outside hospital receiving hours`,
        detail: {
          projectedDeliveryAt: projectedDeliveryAt.toISOString(),
          receivingWindows: config.receivingWindows,
        },
      });
    }

    const canReceive = violations.length === 0;

    return {
      hospitalId,
      projectedDeliveryAt,
      canReceive,
      constraintViolations: violations,
      storageAvailable,
      availableStorageUnits: Math.max(0, availableStorage),
      withinReceivingWindow: withinWindow,
      withinBlackoutPeriod: inBlackout,
      requiresOverride: !canReceive && config.allowEmergencyOverride,
    };
  }

  /**
   * Record an emergency override approval with full audit trail.
   */
  async recordOverride(params: {
    hospitalId: string;
    approvedByUserId: string;
    reason: OverrideReason;
    reasonNotes?: string;
    orderId?: string;
    bloodRequestId?: string;
    projectedDeliveryAt?: Date;
    bypassedConstraint: Record<string, unknown>;
    isEmergency: boolean;
  }): Promise<HospitalOverrideAuditEntity> {
    const audit = this.overrideAuditRepo.create({
      hospitalId: params.hospitalId,
      approvedByUserId: params.approvedByUserId,
      reason: params.reason,
      reasonNotes: params.reasonNotes ?? null,
      orderId: params.orderId ?? null,
      bloodRequestId: params.bloodRequestId ?? null,
      projectedDeliveryAt: params.projectedDeliveryAt ?? null,
      bypassedConstraint: params.bypassedConstraint,
      isEmergency: params.isEmergency,
    });

    const saved = await this.overrideAuditRepo.save(audit);
    this.logger.warn(
      `Emergency override recorded for hospital ${params.hospitalId} by user ${params.approvedByUserId} — reason: ${params.reason}`,
    );
    return saved;
  }

  async getOverrideAuditLog(
    hospitalId: string,
    limit = 50,
  ): Promise<HospitalOverrideAuditEntity[]> {
    return this.overrideAuditRepo.find({
      where: { hospitalId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async incrementStorageUsage(
    hospitalId: string,
    units: number,
  ): Promise<void> {
    const config = await this.configRepo.findOne({ where: { hospitalId } });
    if (!config) return;
    config.currentStorageUnits = Math.min(
      config.coldStorageCapacityUnits,
      config.currentStorageUnits + units,
    );
    await this.configRepo.save(config);
  }

  async decrementStorageUsage(
    hospitalId: string,
    units: number,
  ): Promise<void> {
    const config = await this.configRepo.findOne({ where: { hospitalId } });
    if (!config) return;
    config.currentStorageUnits = Math.max(
      0,
      config.currentStorageUnits - units,
    );
    await this.configRepo.save(config);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildOpenResult(
    hospitalId: string,
    projectedDeliveryAt: Date,
  ): IntakeWindowCheckResult {
    return {
      hospitalId,
      projectedDeliveryAt,
      canReceive: true,
      constraintViolations: [],
      storageAvailable: true,
      availableStorageUnits: Infinity,
      withinReceivingWindow: true,
      withinBlackoutPeriod: false,
      requiresOverride: false,
    };
  }

  private isInBlackoutPeriod(
    config: HospitalCapacityConfigEntity,
    at: Date,
  ): boolean {
    if (!config.blackoutPeriods?.length) return false;
    return config.blackoutPeriods.some(
      (bp) => at >= new Date(bp.startIso) && at <= new Date(bp.endIso),
    );
  }

  private getActiveBlackout(config: HospitalCapacityConfigEntity, at: Date) {
    return (
      config.blackoutPeriods?.find(
        (bp) => at >= new Date(bp.startIso) && at <= new Date(bp.endIso),
      ) ?? null
    );
  }

  private isWithinReceivingWindow(
    config: HospitalCapacityConfigEntity,
    at: Date,
  ): boolean {
    if (!config.receivingWindows?.length) return true;

    const bufferMs = (config.intakeBufferMinutes ?? 0) * 60_000;
    // Apply buffer: delivery must arrive at least `buffer` minutes before window closes
    const effectiveAt = new Date(at.getTime() + bufferMs);

    const dayOfWeek = effectiveAt.getUTCDay();
    const hhmm = `${String(effectiveAt.getUTCHours()).padStart(2, '0')}:${String(
      effectiveAt.getUTCMinutes(),
    ).padStart(2, '0')}`;

    return config.receivingWindows.some(
      (w) =>
        w.dayOfWeek === dayOfWeek && hhmm >= w.openTime && hhmm <= w.closeTime,
    );
  }
}
