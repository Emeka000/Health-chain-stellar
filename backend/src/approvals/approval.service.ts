import { Injectable, Logger, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';

import { ActivityType } from '../user-activity/enums/activity-type.enum';
import { UserActivityService } from '../user-activity/user-activity.service';

import { ApprovalStatus, ApprovalActionType } from './enums/approval.enum';
import { ApprovalRequestEntity } from './entities/approval-request.entity';
import { ApprovalDecisionEntity } from './entities/approval-decision.entity';

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    @InjectRepository(ApprovalRequestEntity)
    private readonly requestRepository: Repository<ApprovalRequestEntity>,
    @InjectRepository(ApprovalDecisionEntity)
    private readonly decisionRepository: Repository<ApprovalDecisionEntity>,
    private readonly userActivityService: UserActivityService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createRequest(params: {
    targetId: string;
    actionType: ApprovalActionType;
    requesterId: string;
    requiredApprovals: number;
    metadata?: any;
    expiresInHours?: number;
    finalPayload?: any;
  }): Promise<ApprovalRequestEntity> {
    const existing = await this.requestRepository.findOne({
      where: {
        targetId: params.targetId,
        actionType: params.actionType,
        status: ApprovalStatus.PENDING,
      },
    });

    if (existing) {
      throw new ConflictException('A pending approval request already exists for this action');
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (params.expiresInHours ?? 24));

    const request = this.requestRepository.create({
      targetId: params.targetId,
      actionType: params.actionType,
      requesterId: params.requesterId,
      requiredApprovals: params.requiredApprovals,
      metadata: params.metadata,
      expiresAt,
      finalPayload: params.finalPayload ? JSON.stringify(params.finalPayload) : null,
    });

    const saved = await this.requestRepository.save(request);
    
    await this.userActivityService.logActivity({
      userId: params.requesterId,
      activityType: ActivityType.PERMISSION_CHANGED,
      description: `Created approval request for ${params.actionType}`,
      metadata: { requestId: saved.id, ...params.metadata },
    });

    return saved;
  }

  async submitDecision(params: {
    requestId: string;
    userId: string;
    decision: ApprovalStatus;
    comment?: string;
    context?: { ipAddress?: string; userAgent?: string };
  }): Promise<ApprovalRequestEntity> {
    const request = await this.requestRepository.findOne({
      where: { id: params.requestId },
      relations: ['decisions'],
    });

    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== ApprovalStatus.PENDING) throw new ConflictException(`Request is ${request.status}`);
    if (request.requesterId === params.userId) throw new ForbiddenException('Cannot approve own request');

    const decision = this.decisionRepository.create({
      requestId: params.requestId,
      userId: params.userId,
      decision: params.decision,
      comment: params.comment,
      ipAddress: params.context?.ipAddress,
      userAgent: params.context?.userAgent,
    });

    await this.decisionRepository.save(decision);

    if (params.decision === ApprovalStatus.REJECTED) {
      request.status = ApprovalStatus.REJECTED;
    } else {
      request.currentApprovals += 1;
      if (request.currentApprovals >= request.requiredApprovals) {
        request.status = ApprovalStatus.APPROVED;
      }
    }

    const saved = await this.requestRepository.save(request);

    if (saved.status === ApprovalStatus.APPROVED) {
      this.eventEmitter.emit('approval.approved', saved);
    }

    return saved;
  }

  async getPendingRequests(): Promise<ApprovalRequestEntity[]> {
    return this.requestRepository.find({
      where: {
        status: ApprovalStatus.PENDING,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async getRequestById(id: string): Promise<ApprovalRequestEntity> {
    return this.requestRepository.findOneOrFail({
      where: { id },
      relations: ['decisions'],
    });
  }
}
