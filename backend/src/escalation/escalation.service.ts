import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { EscalationEntity } from './entities/escalation.entity';
import {
  EscalationInput,
  EscalationPolicyLevel,
  EscalationPolicyService,
} from './escalation-policy.service';
import { EscalationTier } from './enums/escalation-tier.enum';
import { EscalationTriggeredEvent } from '../events/escalation-triggered.event';
import { EscalationAcknowledgedEvent } from '../events/escalation-acknowledged.event';
import { EscalationTimelineEventEntity } from './entities/escalation-timeline.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { IncidentReviewEntity } from '../incident-reviews/entities/incident-review.entity';
import { SecurityEventLoggerService, SecurityEventType } from '../user-activity/security-event-logger.service';
import { TenantActorContext, assertTenantAccess } from '../common/tenant/tenant-scope.util';

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);
  private static readonly MAX_NOTIFICATION_RETRIES = 2;

  constructor(
    @InjectRepository(EscalationEntity)
    private readonly repo: Repository<EscalationEntity>,
    @InjectRepository(EscalationTimelineEventEntity)
    private readonly timelineRepo: Repository<EscalationTimelineEventEntity>,
    @InjectRepository(IncidentReviewEntity)
    private readonly incidentReviewRepo: Repository<IncidentReviewEntity>,
    private readonly policy: EscalationPolicyService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationsService: NotificationsService,
    private readonly securityEventLogger: SecurityEventLoggerService,
  ) {}

  async evaluate(
    requestId: string,
    orderId: string | null,
    hospitalId: string,
    riderId: string | null,
    input: EscalationInput,
  ): Promise<EscalationEntity | null> {
    const tier = this.policy.evaluate(input);

    if (tier === EscalationTier.NONE) return null;
    const suppressionWindowMs = this.policy.suppressionWindowMs(input.urgency);
    const now = Date.now();
    const mostRecent = await this.repo.findOne({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });
    if (
      mostRecent &&
      now - mostRecent.createdAt.getTime() <= suppressionWindowMs &&
      mostRecent.status === 'OPEN'
    ) {
      await this.logTimeline({
        escalationId: mostRecent.id,
        requestId,
        eventType: 'SUPPRESSED_DUPLICATE',
        level: mostRecent.currentLevel,
        metadata: { suppressionWindowMs, previousEscalationId: mostRecent.id, tier },
      });
      return null;
    }

    const slaDeadlineMs = this.policy.slaDeadlineMs(tier);
    const policyChain = this.policy.buildPolicyChain(input.urgency, tier);
    const firstLevel = policyChain[0];
    const linkedIncidentReviewId = await this.findLinkedIncidentReviewId(orderId);

    const escalation = this.repo.create({
      requestId,
      orderId,
      hospitalId,
      tier,
      slaDeadlineMs,
      riderId,
      acknowledgedAt: null,
      acknowledgedBy: null,
      policyChain,
      currentLevel: firstLevel.level,
      nextEscalationAt: new Date(Date.now() + firstLevel.timeoutSeconds * 1000),
      status: 'OPEN',
      incidentReviewId: linkedIncidentReviewId,
      remediationTaskId: null,
    });

    await this.repo.save(escalation);
    await this.logTimeline({
      escalationId: escalation.id,
      requestId,
      eventType: 'ESCALATION_TRIGGERED',
      level: escalation.currentLevel,
      metadata: { tier, policyChainLength: policyChain.length },
    });
    if (linkedIncidentReviewId) {
      await this.logTimeline({
        escalationId: escalation.id,
        requestId,
        eventType: 'LINKED_INCIDENT_REVIEW',
        level: escalation.currentLevel,
        metadata: { incidentReviewId: linkedIncidentReviewId },
      });
    }

    this.eventEmitter.emit(
      'escalation.triggered',
      new EscalationTriggeredEvent(requestId, orderId, tier, hospitalId, slaDeadlineMs, riderId),
    );
    await this.executeLevelActions(escalation, firstLevel, tier, 'trigger');

    this.logger.log(`Escalation tier=${tier} created for request=${requestId}`);
    return escalation;
  }

  async acknowledge(
    escalationId: string,
    actor: TenantActorContext,
  ): Promise<EscalationEntity> {
    const escalation = await this.repo.findOne({ where: { id: escalationId } });
    if (!escalation) throw new NotFoundException('Escalation not found');
    await this.assertEscalationAccess(actor, escalation, 'acknowledge');

    if (escalation.acknowledgedAt) return escalation; // already acked

    escalation.acknowledgedAt = new Date();
    escalation.acknowledgedBy = actor.userId;
    escalation.status = 'ACKNOWLEDGED';
    escalation.nextEscalationAt = null;
    await this.repo.save(escalation);
    await this.logTimeline({
      escalationId,
      requestId: escalation.requestId,
      eventType: 'ACKNOWLEDGED',
      level: escalation.currentLevel,
      metadata: { acknowledgedBy: actor.userId },
    });

    this.eventEmitter.emit(
      'escalation.acknowledged',
      new EscalationAcknowledgedEvent(escalationId, actor.userId),
    );

    return escalation;
  }

  async findOpen(actor: TenantActorContext): Promise<EscalationEntity[]> {
    const rows = await this.repo.find({
      where: { acknowledgedAt: null as any },
      order: { createdAt: 'DESC' },
    });
    return rows.filter((row) => this.hasAccess(actor, row));
  }

  async findByRequest(
    requestId: string,
    actor: TenantActorContext,
  ): Promise<EscalationEntity[]> {
    const rows = await this.repo.find({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });
    return rows.filter((row) => this.hasAccess(actor, row));
  }

  async processTimeoutEscalations(): Promise<void> {
    const now = new Date();
    const openEscalations = await this.repo.find({
      where: {
        status: 'OPEN',
        acknowledgedAt: null as any,
        nextEscalationAt: LessThanOrEqual(now),
      },
      order: { createdAt: 'ASC' },
    });

    for (const escalation of openEscalations) {
      const chain = escalation.policyChain ?? [];
      if (chain.length === 0 || escalation.currentLevel >= chain.length) {
        escalation.status = 'EXHAUSTED';
        escalation.nextEscalationAt = null;
        await this.repo.save(escalation);
        await this.logTimeline({
          escalationId: escalation.id,
          requestId: escalation.requestId,
          eventType: 'POLICY_EXHAUSTED',
          level: escalation.currentLevel,
        });
        continue;
      }

      const nextLevel = chain[escalation.currentLevel];
      escalation.currentLevel = nextLevel.level;
      escalation.nextEscalationAt = new Date(
        Date.now() + nextLevel.timeoutSeconds * 1000,
      );
      await this.repo.save(escalation);

      await this.logTimeline({
        escalationId: escalation.id,
        requestId: escalation.requestId,
        eventType: 'TIMEOUT_ESCALATED',
        level: nextLevel.level,
        metadata: { targetRole: nextLevel.targetRole },
      });

      await this.executeLevelActions(
        escalation,
        nextLevel,
        escalation.tier,
        'timeout-escalation',
      );
    }
  }

  async addLinks(
    escalationId: string,
    actor: TenantActorContext,
    link: { incidentReviewId?: string; remediationTaskId?: string },
  ): Promise<EscalationEntity> {
    const escalation = await this.repo.findOne({ where: { id: escalationId } });
    if (!escalation) throw new NotFoundException('Escalation not found');
    await this.assertEscalationAccess(actor, escalation, 'add-links');

    if (link.incidentReviewId) {
      escalation.incidentReviewId = link.incidentReviewId;
      await this.logTimeline({
        escalationId: escalation.id,
        requestId: escalation.requestId,
        eventType: 'LINKED_INCIDENT_REVIEW',
        level: escalation.currentLevel,
        metadata: { incidentReviewId: link.incidentReviewId },
      });
    }
    if (link.remediationTaskId) {
      escalation.remediationTaskId = link.remediationTaskId;
      await this.logTimeline({
        escalationId: escalation.id,
        requestId: escalation.requestId,
        eventType: 'LINKED_REMEDIATION_TASK',
        level: escalation.currentLevel,
        metadata: { remediationTaskId: link.remediationTaskId },
      });
    }

    return this.repo.save(escalation);
  }

  async getTimeline(query: {
    requestId?: string;
    escalationId?: string;
    actor: TenantActorContext;
  }): Promise<EscalationTimelineEventEntity[]> {
    if (query.escalationId) {
      const escalation = await this.repo.findOne({
        where: { id: query.escalationId },
      });
      if (escalation) await this.assertEscalationAccess(query.actor, escalation, 'timeline');
      return this.timelineRepo.find({
        where: { escalationId: query.escalationId },
        order: { createdAt: 'ASC' },
      });
    }
    if (query.requestId) {
      const rows = await this.repo.find({ where: { requestId: query.requestId } });
      for (const row of rows) {
        await this.assertEscalationAccess(query.actor, row, 'timeline');
      }
      return this.timelineRepo.find({
        where: { requestId: query.requestId },
        order: { createdAt: 'ASC' },
      });
    }
    return this.timelineRepo.find({ order: { createdAt: 'DESC' }, take: 200 });
  }

  private resolveRecipient(
    escalation: EscalationEntity,
    targetRole: EscalationPolicyLevel['targetRole'],
  ): string {
    if (targetRole === 'HOSPITAL_COORDINATOR') return escalation.hospitalId;
    if (targetRole === 'REGIONAL_OPS_MANAGER') return 'ops-regional';
    return 'ops-team';
  }

  private async executeLevelActions(
    escalation: EscalationEntity,
    level: EscalationPolicyLevel,
    tier: EscalationTier,
    reason: 'trigger' | 'timeout-escalation',
  ): Promise<void> {
    const recipientId = this.resolveRecipient(escalation, level.targetRole);
    for (const action of level.actions) {
      let sent = false;
      let attempt = 0;
      while (!sent && attempt <= EscalationService.MAX_NOTIFICATION_RETRIES) {
        attempt += 1;
        try {
          await this.notificationsService.send({
            recipientId,
            channels: [action],
            templateKey: 'escalation.triggered',
            variables: {
              requestId: escalation.requestId,
              tier,
              level: level.level,
              reason,
              escalationId: escalation.id,
            },
          });
          await this.logTimeline({
            escalationId: escalation.id,
            requestId: escalation.requestId,
            eventType: 'NOTIFICATION_SENT',
            level: level.level,
            targetRole: level.targetRole,
            action,
            outcome: 'SUCCESS',
            metadata: { attempt },
          });
          sent = true;
        } catch (error) {
          await this.logTimeline({
            escalationId: escalation.id,
            requestId: escalation.requestId,
            eventType: 'NOTIFICATION_FAILED',
            level: level.level,
            targetRole: level.targetRole,
            action,
            outcome: 'FAILED',
            metadata: { attempt, message: (error as Error).message },
          });
          if (attempt > EscalationService.MAX_NOTIFICATION_RETRIES) {
            this.logger.error(
              `Notification failed escalation=${escalation.id} level=${level.level} action=${action}`,
            );
          }
        }
      }
    }
  }

  private async findLinkedIncidentReviewId(orderId: string | null): Promise<string | null> {
    if (!orderId) return null;
    const review = await this.incidentReviewRepo.findOne({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
    return review?.id ?? null;
  }

  private async logTimeline(input: {
    escalationId: string | null;
    requestId: string;
    eventType: string;
    level: number | null;
    targetRole?: string;
    action?: string;
    outcome?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const timeline = this.timelineRepo.create({
      escalationId: input.escalationId,
      requestId: input.requestId,
      eventType: input.eventType,
      level: input.level,
      targetRole: input.targetRole ?? null,
      action: input.action ?? null,
      outcome: input.outcome ?? null,
      metadata: input.metadata ?? null,
    });
    await this.timelineRepo.save(timeline);
  }

  private hasAccess(actor: TenantActorContext, escalation: EscalationEntity): boolean {
    try {
      assertTenantAccess(actor, {
        resourceType: 'Escalation',
        resourceId: escalation.id,
        ownerIds: [escalation.hospitalId],
      });
      return true;
    } catch {
      return false;
    }
  }

  private async assertEscalationAccess(
    actor: TenantActorContext,
    escalation: EscalationEntity,
    action: string,
  ): Promise<void> {
    try {
      assertTenantAccess(actor, {
        resourceType: 'Escalation',
        resourceId: escalation.id,
        ownerIds: [escalation.hospitalId],
      });
    } catch {
      await this.securityEventLogger
        .logEvent({
          eventType: SecurityEventType.TENANT_ACCESS_DENIED,
          userId: actor.userId,
          description: 'Cross-tenant escalation access denied',
          metadata: { action, escalationId: escalation.id, hospitalId: escalation.hospitalId },
        })
        .catch(() => undefined);
      throw new ForbiddenException('Cross-tenant escalation access denied');
    }
  }
}
