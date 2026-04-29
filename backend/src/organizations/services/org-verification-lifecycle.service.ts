import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';

import { SorobanService } from '../../soroban/soroban.service';
import { OrderEntity } from '../../orders/entities/order.entity';
import { OrderStatus } from '../../orders/enums/order-status.enum';
import { OrganizationRepository } from '../organizations.repository';
import {
  ReapplyOrganizationDto,
  ReinstateOrganizationDto,
  SuspendOrganizationDto,
  UnverifyOrganizationDto,
} from '../dto/org-lifecycle.dto';
import { OrgGracePeriodEntity, GracePeriodState } from '../entities/org-grace-period.entity';
import { OrgVerificationHistoryEntity } from '../entities/org-verification-history.entity';
import {
  ALLOWED_TRANSITIONS,
  InFlightConflictPolicy,
  OrgLifecycleStatus,
  RestrictionLevel,
  VerificationChangeReason,
} from '../enums/org-lifecycle.enum';
import { OrganizationVerificationStatus } from '../enums/organization-verification-status.enum';
import {
  OrgGracePeriodEscalatedEvent,
  OrgGracePeriodExpiredEvent,
  OrgGracePeriodStartedEvent,
  OrgInFlightOrdersFlaggedEvent,
  OrgVerificationStatusChangedEvent,
} from '../org-lifecycle.events';

/** Default grace period before SUSPENDED → UNVERIFIED (72 h) */
const DEFAULT_GRACE_HOURS = 72;

/** Escalate to FULLY_RESTRICTED when less than this fraction of grace remains */
const ESCALATION_THRESHOLD = 0.25;

/** In-flight order statuses that are considered active */
const IN_FLIGHT_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.DISPATCHED,
  OrderStatus.IN_TRANSIT,
];

@Injectable()
export class OrgVerificationLifecycleService {
  private readonly logger = new Logger(OrgVerificationLifecycleService.name);

  constructor(
    private readonly orgRepo: OrganizationRepository,
    @InjectRepository(OrgVerificationHistoryEntity)
    private readonly historyRepo: Repository<OrgVerificationHistoryEntity>,
    @InjectRepository(OrgGracePeriodEntity)
    private readonly gracePeriodRepo: Repository<OrgGracePeriodEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly sorobanService: SorobanService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Suspend ───────────────────────────────────────────────────────────

  /**
   * Transitions APPROVED → SUSPENDED.
   * Starts a grace period; new orders are blocked immediately.
   * In-flight orders are handled per conflictPolicy.
   */
  async suspend(
    organizationId: string,
    actorId: string,
    dto: SuspendOrganizationDto,
  ): Promise<OrgVerificationHistoryEntity> {
    const org = await this.findOrThrow(organizationId);
    const fromStatus = org.status as unknown as OrgLifecycleStatus;

    this.assertTransitionAllowed(fromStatus, OrgLifecycleStatus.SUSPENDED);

    const conflictPolicy = dto.conflictPolicy ?? InFlightConflictPolicy.DRAIN;
    const inFlightOrderIds = await this.resolveInFlightOrders(
      organizationId,
      conflictPolicy,
    );

    const gracePeriodHours = dto.gracePeriodHours ?? DEFAULT_GRACE_HOURS;
    const expiresAt = new Date(Date.now() + gracePeriodHours * 3_600_000);

    // Persist grace period
    const gracePeriod = await this.gracePeriodRepo.save(
      this.gracePeriodRepo.create({
        organizationId,
        targetStatus: OrgLifecycleStatus.UNVERIFIED,
        state: GracePeriodState.ACTIVE,
        restrictionLevel: RestrictionLevel.NEW_ORDERS_BLOCKED,
        expiresAt,
        actorId,
        note: dto.note,
      }),
    );

    // Update org status
    org.status = OrgLifecycleStatus.SUSPENDED as unknown as OrganizationVerificationStatus;
    org.isActive = true; // still active during grace — existing ops can drain
    await this.orgRepo.save(org);

    const entry = await this.appendHistory({
      organizationId,
      fromStatus,
      toStatus: OrgLifecycleStatus.SUSPENDED,
      actorId,
      reason: dto.reason,
      note: dto.note,
      inFlightOrderIds,
      conflictPolicy,
      restrictionLevel: RestrictionLevel.NEW_ORDERS_BLOCKED,
      blockchainTxHash: null,
    });

    this.eventEmitter.emit(
      'org.verification.status_changed',
      new OrgVerificationStatusChangedEvent(
        organizationId,
        fromStatus,
        OrgLifecycleStatus.SUSPENDED,
        actorId,
        dto.reason,
        conflictPolicy,
        inFlightOrderIds,
      ),
    );

    this.eventEmitter.emit(
      'org.grace_period.started',
      new OrgGracePeriodStartedEvent(
        organizationId,
        expiresAt,
        RestrictionLevel.NEW_ORDERS_BLOCKED,
        actorId,
      ),
    );

    this.logger.log(
      `Org ${organizationId} suspended by ${actorId}. Grace period expires ${expiresAt.toISOString()}`,
    );

    return entry;
  }

  // ── Reinstate ─────────────────────────────────────────────────────────

  /**
   * Transitions SUSPENDED → APPROVED.
   * Cancels any active grace period and lifts all restrictions.
   */
  async reinstate(
    organizationId: string,
    actorId: string,
    dto: ReinstateOrganizationDto,
  ): Promise<OrgVerificationHistoryEntity> {
    const org = await this.findOrThrow(organizationId);
    const fromStatus = org.status as unknown as OrgLifecycleStatus;

    this.assertTransitionAllowed(fromStatus, OrgLifecycleStatus.APPROVED);

    // Cancel active grace period
    await this.cancelActiveGracePeriod(organizationId);

    // Propagate reinstatement to Soroban (non-fatal)
    let blockchainTxHash: string | null = null;
    try {
      const result = await this.sorobanService.verifyOrganization(organizationId);
      blockchainTxHash = result.transactionHash;
    } catch (err) {
      this.logger.warn(
        `On-chain reinstatement failed for org ${organizationId}: ${(err as Error).message}`,
      );
    }

    org.status = OrgLifecycleStatus.APPROVED as unknown as OrganizationVerificationStatus;
    org.isActive = true;
    await this.orgRepo.save(org);

    const entry = await this.appendHistory({
      organizationId,
      fromStatus,
      toStatus: OrgLifecycleStatus.APPROVED,
      actorId,
      reason: dto.reason,
      note: dto.note,
      inFlightOrderIds: null,
      conflictPolicy: null,
      restrictionLevel: RestrictionLevel.NONE,
      blockchainTxHash,
    });

    this.eventEmitter.emit(
      'org.verification.status_changed',
      new OrgVerificationStatusChangedEvent(
        organizationId,
        fromStatus,
        OrgLifecycleStatus.APPROVED,
        actorId,
        dto.reason,
        null,
        [],
      ),
    );

    this.logger.log(`Org ${organizationId} reinstated by ${actorId}`);
    return entry;
  }

  // ── Unverify ──────────────────────────────────────────────────────────

  /**
   * Transitions APPROVED or SUSPENDED → UNVERIFIED.
   * Fully restricts the org, propagates revocation on-chain, handles in-flight ops.
   */
  async unverify(
    organizationId: string,
    actorId: string,
    dto: UnverifyOrganizationDto,
  ): Promise<OrgVerificationHistoryEntity> {
    const org = await this.findOrThrow(organizationId);
    const fromStatus = org.status as unknown as OrgLifecycleStatus;

    this.assertTransitionAllowed(fromStatus, OrgLifecycleStatus.UNVERIFIED);

    const conflictPolicy = dto.conflictPolicy ?? InFlightConflictPolicy.CANCEL_ALL;
    const inFlightOrderIds = await this.resolveInFlightOrders(
      organizationId,
      conflictPolicy,
    );

    // Cancel any active grace period
    await this.cancelActiveGracePeriod(organizationId);

    // Propagate revocation to Soroban (non-fatal)
    let blockchainTxHash: string | null = null;
    try {
      const result = await this.sorobanService.revokeOrganizationVerification(
        organizationId,
        dto.reason,
      );
      blockchainTxHash = result.transactionHash;
    } catch (err) {
      this.logger.warn(
        `On-chain revocation failed for org ${organizationId}: ${(err as Error).message}`,
      );
    }

    org.status = OrgLifecycleStatus.UNVERIFIED as unknown as OrganizationVerificationStatus;
    org.isActive = false;
    await this.orgRepo.save(org);

    const entry = await this.appendHistory({
      organizationId,
      fromStatus,
      toStatus: OrgLifecycleStatus.UNVERIFIED,
      actorId,
      reason: dto.reason,
      note: dto.note,
      inFlightOrderIds,
      conflictPolicy,
      restrictionLevel: RestrictionLevel.FULLY_RESTRICTED,
      blockchainTxHash,
    });

    this.eventEmitter.emit(
      'org.verification.status_changed',
      new OrgVerificationStatusChangedEvent(
        organizationId,
        fromStatus,
        OrgLifecycleStatus.UNVERIFIED,
        actorId,
        dto.reason,
        conflictPolicy,
        inFlightOrderIds,
      ),
    );

    this.logger.log(`Org ${organizationId} unverified by ${actorId}`);
    return entry;
  }

  // ── Re-apply ──────────────────────────────────────────────────────────

  /**
   * Transitions REJECTED or UNVERIFIED → PENDING_VERIFICATION.
   * Allows the org to re-submit for verification.
   */
  async reapply(
    organizationId: string,
    actorId: string,
    dto: ReapplyOrganizationDto,
  ): Promise<OrgVerificationHistoryEntity> {
    const org = await this.findOrThrow(organizationId);
    const fromStatus = org.status as unknown as OrgLifecycleStatus;

    this.assertTransitionAllowed(fromStatus, OrgLifecycleStatus.PENDING_VERIFICATION);

    org.status = OrgLifecycleStatus.PENDING_VERIFICATION as unknown as OrganizationVerificationStatus;
    org.isActive = false;
    await this.orgRepo.save(org);

    const entry = await this.appendHistory({
      organizationId,
      fromStatus,
      toStatus: OrgLifecycleStatus.PENDING_VERIFICATION,
      actorId,
      reason: VerificationChangeReason.REAPPLICATION,
      note: dto.note,
      inFlightOrderIds: null,
      conflictPolicy: null,
      restrictionLevel: null,
      blockchainTxHash: null,
    });

    this.eventEmitter.emit(
      'org.verification.status_changed',
      new OrgVerificationStatusChangedEvent(
        organizationId,
        fromStatus,
        OrgLifecycleStatus.PENDING_VERIFICATION,
        actorId,
        VerificationChangeReason.REAPPLICATION,
        null,
        [],
      ),
    );

    return entry;
  }

  // ── Grace period cron ─────────────────────────────────────────────────

  /**
   * Runs every 15 minutes.
   * 1. Escalates grace periods past the ESCALATION_THRESHOLD to FULLY_RESTRICTED.
   * 2. Expires grace periods that have passed their deadline → UNVERIFIED.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async processGracePeriods(): Promise<void> {
    const now = new Date();

    const active = await this.gracePeriodRepo.find({
      where: { state: GracePeriodState.ACTIVE },
    });

    if (!active.length) return;

    for (const gp of active) {
      // Expired — transition org to targetStatus
      if (gp.expiresAt <= now) {
        await this.expireGracePeriod(gp, now);
        continue;
      }

      // Escalate restriction level when within threshold
      if (
        gp.restrictionLevel === RestrictionLevel.NEW_ORDERS_BLOCKED &&
        this.withinEscalationThreshold(gp, now)
      ) {
        await this.escalateGracePeriod(gp, now);
      }
    }
  }

  // ── Query ─────────────────────────────────────────────────────────────

  async getHistory(organizationId: string): Promise<OrgVerificationHistoryEntity[]> {
    return this.historyRepo.find({
      where: { organizationId },
      order: { transitionedAt: 'ASC' },
    });
  }

  async getActiveGracePeriod(
    organizationId: string,
  ): Promise<OrgGracePeriodEntity | null> {
    return this.gracePeriodRepo.findOne({
      where: { organizationId, state: GracePeriodState.ACTIVE },
    });
  }

  /**
   * Returns the current effective restriction level for an org.
   * Used by dependent modules (orders, blood-requests) to gate new operations.
   */
  async getRestrictionLevel(organizationId: string): Promise<RestrictionLevel> {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) return RestrictionLevel.FULLY_RESTRICTED;

    const status = org.status as unknown as OrgLifecycleStatus;

    if (status === OrgLifecycleStatus.UNVERIFIED || status === OrgLifecycleStatus.REJECTED) {
      return RestrictionLevel.FULLY_RESTRICTED;
    }

    if (status === OrgLifecycleStatus.SUSPENDED) {
      const gp = await this.getActiveGracePeriod(organizationId);
      return gp?.restrictionLevel ?? RestrictionLevel.FULLY_RESTRICTED;
    }

    return RestrictionLevel.NONE;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private assertTransitionAllowed(
    from: OrgLifecycleStatus,
    to: OrgLifecycleStatus,
  ): void {
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Transition from '${from}' to '${to}' is not permitted`,
      );
    }
  }

  /**
   * Finds all in-flight orders for the org and applies the conflict policy.
   * Returns the list of affected order IDs for the audit snapshot.
   */
  private async resolveInFlightOrders(
    organizationId: string,
    policy: InFlightConflictPolicy,
  ): Promise<string[]> {
    const orders = await this.orderRepo.find({
      where: [
        { hospitalId: organizationId, status: In(IN_FLIGHT_STATUSES) },
        { bloodBankId: organizationId, status: In(IN_FLIGHT_STATUSES) },
      ],
      select: ['id', 'status'],
    });

    if (!orders.length) return [];

    const ids = orders.map((o) => o.id);

    if (policy === InFlightConflictPolicy.CANCEL_ALL) {
      await this.orderRepo.update(
        { id: In(ids) },
        { status: OrderStatus.CANCELLED },
      );
      this.logger.log(
        `Cancelled ${ids.length} in-flight orders for org ${organizationId}`,
      );
    } else if (policy === InFlightConflictPolicy.FLAG_FOR_REVIEW) {
      this.eventEmitter.emit(
        'org.in_flight_orders.flagged',
        new OrgInFlightOrdersFlaggedEvent(organizationId, ids, policy),
      );
    }
    // DRAIN: no action — orders complete naturally; new ones are blocked by restriction level

    return ids;
  }

  private async cancelActiveGracePeriod(organizationId: string): Promise<void> {
    const gp = await this.gracePeriodRepo.findOne({
      where: { organizationId, state: GracePeriodState.ACTIVE },
    });
    if (gp) {
      gp.state = GracePeriodState.CANCELLED;
      await this.gracePeriodRepo.save(gp);
    }
  }

  private async expireGracePeriod(
    gp: OrgGracePeriodEntity,
    now: Date,
  ): Promise<void> {
    gp.state = GracePeriodState.EXPIRED;
    await this.gracePeriodRepo.save(gp);

    const org = await this.orgRepo.findOne({ where: { id: gp.organizationId } });
    if (!org) return;

    const fromStatus = org.status as unknown as OrgLifecycleStatus;

    // Propagate revocation on-chain (non-fatal)
    let blockchainTxHash: string | null = null;
    try {
      const result = await this.sorobanService.revokeOrganizationVerification(
        gp.organizationId,
        VerificationChangeReason.GRACE_PERIOD_EXPIRED,
      );
      blockchainTxHash = result.transactionHash;
    } catch {
      // non-fatal
    }

    org.status = gp.targetStatus as unknown as OrganizationVerificationStatus;
    org.isActive = false;
    await this.orgRepo.save(org);

    await this.appendHistory({
      organizationId: gp.organizationId,
      fromStatus,
      toStatus: gp.targetStatus,
      actorId: 'system',
      reason: VerificationChangeReason.GRACE_PERIOD_EXPIRED,
      note: `Grace period ${gp.id} expired`,
      inFlightOrderIds: null,
      conflictPolicy: InFlightConflictPolicy.CANCEL_ALL,
      restrictionLevel: RestrictionLevel.FULLY_RESTRICTED,
      blockchainTxHash,
    });

    // Cancel remaining in-flight orders on expiry
    await this.resolveInFlightOrders(
      gp.organizationId,
      InFlightConflictPolicy.CANCEL_ALL,
    );

    this.eventEmitter.emit(
      'org.grace_period.expired',
      new OrgGracePeriodExpiredEvent(gp.organizationId, gp.id, gp.targetStatus),
    );

    this.logger.log(
      `Grace period ${gp.id} expired for org ${gp.organizationId} → ${gp.targetStatus}`,
    );
  }

  private async escalateGracePeriod(
    gp: OrgGracePeriodEntity,
    now: Date,
  ): Promise<void> {
    gp.restrictionLevel = RestrictionLevel.FULLY_RESTRICTED;
    gp.fullyRestrictedAt = now;
    await this.gracePeriodRepo.save(gp);

    this.eventEmitter.emit(
      'org.grace_period.escalated',
      new OrgGracePeriodEscalatedEvent(
        gp.organizationId,
        gp.id,
        RestrictionLevel.FULLY_RESTRICTED,
      ),
    );

    this.logger.log(
      `Grace period ${gp.id} escalated to FULLY_RESTRICTED for org ${gp.organizationId}`,
    );
  }

  private withinEscalationThreshold(
    gp: OrgGracePeriodEntity,
    now: Date,
  ): boolean {
    const total = gp.expiresAt.getTime() - gp.createdAt.getTime();
    const remaining = gp.expiresAt.getTime() - now.getTime();
    return total > 0 && remaining / total <= ESCALATION_THRESHOLD;
  }

  private async appendHistory(params: {
    organizationId: string;
    fromStatus: OrgLifecycleStatus | null;
    toStatus: OrgLifecycleStatus;
    actorId: string;
    reason: VerificationChangeReason;
    note: string | null;
    inFlightOrderIds: string[] | null;
    conflictPolicy: InFlightConflictPolicy | null;
    restrictionLevel: RestrictionLevel | null;
    blockchainTxHash: string | null;
  }): Promise<OrgVerificationHistoryEntity> {
    const entry = this.historyRepo.create(params);
    return this.historyRepo.save(entry);
  }

  private async findOrThrow(organizationId: string) {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundException(`Organization ${organizationId} not found`);
    return org;
  }
}
