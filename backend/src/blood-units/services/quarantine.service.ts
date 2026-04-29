import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { PolicyCenterService } from '../../policy-center/policy-center.service';
import { ApprovalService } from '../../approvals/approval.service';
import { ApprovalActionType } from '../../approvals/enums/approval.enum';
import { FileMetadataService } from '../../file-metadata/file-metadata.service';
import { BloodStatusService } from '../blood-status.service';
import {
  CreateQuarantineCaseDto,
  FinalizeQuarantineDto,
  QueryQuarantineCasesDto,
  UpdateQuarantineReviewDto,
} from '../dto/quarantine.dto';
import { BloodUnit } from '../entities/blood-unit.entity';
import { QuarantineCase } from '../entities/quarantine-case.entity';
import { BloodStatus } from '../enums/blood-status.enum';
import {
  QuarantineDisposition,
  QuarantineReviewState,
  QuarantineTriggerSource,
} from '../enums/quarantine.enums';

interface AuthenticatedUserContext {
  id: string;
  role: string;
}

@Injectable()
export class QuarantineService {
  constructor(
    @InjectRepository(QuarantineCase)
    private readonly quarantineRepository: Repository<QuarantineCase>,
    @InjectRepository(BloodUnit)
    private readonly bloodUnitRepository: Repository<BloodUnit>,
    private readonly bloodStatusService: BloodStatusService,
    private readonly policyCenterService: PolicyCenterService,
    private readonly approvalService: ApprovalService,
    private readonly fileMetadataService: FileMetadataService,
  ) {}

  async createCase(
    dto: CreateQuarantineCaseDto,
    user?: AuthenticatedUserContext,
  ) {
    const unit = await this.bloodUnitRepository.findOne({
      where: { id: dto.bloodUnitId },
    });
    if (!unit) {
      throw new NotFoundException(`Blood unit ${dto.bloodUnitId} not found`);
    }

    const existingActive = await this.quarantineRepository.findOne({
      where: {
        bloodUnitId: dto.bloodUnitId,
        active: true,
      },
      order: { createdAt: 'DESC' },
    });
    if (existingActive) {
      throw new ConflictException(
        `Blood unit ${dto.bloodUnitId} already has an active quarantine case`,
      );
    }

    // Validate evidence requirements based on policy
    await this.validateEvidenceRequirements(dto);

    // Check if trigger is enabled in policy
    const policy = this.policyCenterService.getDefaultRules();
    const triggerConfig = policy.quarantine.triggerMatrix[dto.triggerSource.toLowerCase() as keyof typeof policy.quarantine.triggerMatrix];

    if (!triggerConfig?.enabled) {
      throw new BadRequestException(`Quarantine trigger ${dto.triggerSource} is not enabled in policy`);
    }

    if (unit.status !== BloodStatus.QUARANTINED) {
      await this.bloodStatusService.updateStatus(
        dto.bloodUnitId,
        {
          status: BloodStatus.QUARANTINED,
          reason: dto.reason ?? dto.reasonCode,
        },
        user,
      );
    }

    const entity = this.quarantineRepository.create({
      bloodUnitId: dto.bloodUnitId,
      triggerSource: dto.triggerSource,
      reasonCode: dto.reasonCode,
      reason: dto.reason ?? null,
      notes: dto.notes ?? null,
      policyReference: dto.policyReference ?? null,
      metadata: dto.metadata ?? null,
      evidence: dto.evidence,
      reviewState: this.determineInitialReviewState(dto, policy),
      createdBy: user?.id ?? null,
      active: true,
    });

    const saved = await this.quarantineRepository.save(entity);

    // Create approval request if required
    if (this.requiresApproval(dto, policy)) {
      await this.createDispositionApprovalRequest(saved, user);
    }

    return { success: true, case: saved };
  }

  async createFromTemperatureBreach(
    bloodUnitId: string,
    temperature: number,
    minAllowed: number,
    maxAllowed: number,
    user?: AuthenticatedUserContext,
  ) {
    return this.createCase(
      {
        bloodUnitId,
        triggerSource: QuarantineTriggerSource.TEMPERATURE_BREACH,
        reasonCode: temperature < minAllowed ? 'STORAGE_ANOMALY' : 'STORAGE_ANOMALY',
        reason: `Temperature ${temperature}C breached threshold [${minAllowed}, ${maxAllowed}]`,
        metadata: {
          observedTemperature: temperature,
          minAllowed,
          maxAllowed,
        },
      },
      user,
    );
  }

  async assignReviewer(caseId: string, reviewerAssignedTo: string) {
    const existing = await this.quarantineRepository.findOne({
      where: { id: caseId },
    });
    if (!existing) {
      throw new NotFoundException(`Quarantine case ${caseId} not found`);
    }
    if (!existing.active) {
      throw new ConflictException(`Quarantine case ${caseId} is already closed`);
    }

    existing.reviewerAssignedTo = reviewerAssignedTo;
    if (existing.reviewState === QuarantineReviewState.PENDING) {
      existing.reviewState = QuarantineReviewState.UNDER_REVIEW;
    }

    const saved = await this.quarantineRepository.save(existing);
    return { success: true, case: saved };
  }

  async updateReview(
    caseId: string,
    dto: UpdateQuarantineReviewDto,
    user?: AuthenticatedUserContext,
  ) {
    const existing = await this.quarantineRepository.findOne({
      where: { id: caseId },
    });
    if (!existing) {
      throw new NotFoundException(`Quarantine case ${caseId} not found`);
    }
    if (!existing.active) {
      throw new ConflictException(`Quarantine case ${caseId} is already closed`);
    }

    existing.reviewState = dto.reviewState;
    existing.notes = dto.notes ?? existing.notes;
    existing.reviewedBy = user?.id ?? null;
    existing.reviewedAt = new Date();

    const saved = await this.quarantineRepository.save(existing);
    return { success: true, case: saved };
  }

  async finalizeCase(
    caseId: string,
    dto: FinalizeQuarantineDto,
    user?: AuthenticatedUserContext,
  ) {
    const existing = await this.quarantineRepository.findOne({
      where: { id: caseId },
    });
    if (!existing) {
      throw new NotFoundException(`Quarantine case ${caseId} not found`);
    }
    if (!existing.active) {
      throw new ConflictException(`Quarantine case ${caseId} is already closed`);
    }

    // Check if approval is required and obtained
    const policy = this.policyCenterService.getDefaultRules();
    const triggerConfig = policy.quarantine.triggerMatrix[existing.triggerSource.toLowerCase() as keyof typeof policy.quarantine.triggerMatrix];

    if (triggerConfig?.approvalRequired) {
      const isApproved = await this.approvalService.isApproved(existing.id, ApprovalActionType.ESCROW_RELEASE);
      if (!isApproved) {
        throw new ForbiddenException(`Approval required for quarantine disposition`);
      }
    }

    const nextStatus =
      dto.disposition === QuarantineDisposition.RELEASE
        ? BloodStatus.AVAILABLE
        : BloodStatus.DISCARDED;

    await this.bloodStatusService.updateStatus(
      existing.bloodUnitId,
      {
        status: nextStatus,
        reason: dto.notes ?? `Quarantine final disposition: ${dto.disposition}`,
      },
      user,
    );

    existing.finalDisposition = dto.disposition;
    existing.dispositionNotes = dto.notes ?? null;
    existing.policyReference = dto.policyReference ?? existing.policyReference;
    existing.dispositionAt = new Date();
    existing.reviewedBy = user?.id ?? existing.reviewedBy;
    existing.reviewedAt = new Date();
    existing.active = false;
    existing.reviewState =
      dto.disposition === QuarantineDisposition.RELEASE
        ? QuarantineReviewState.APPROVED_RELEASE
        : QuarantineReviewState.APPROVED_DISCARD;

    const saved = await this.quarantineRepository.save(existing);
    return { success: true, case: saved };
  }

  async listCases(query: QueryQuarantineCasesDto) {
    const qb = this.quarantineRepository
      .createQueryBuilder('q')
      .orderBy('q.created_at', 'DESC');

    if (query.reviewState) {
      qb.andWhere('q.review_state = :reviewState', {
        reviewState: query.reviewState,
      });
    }

    if (query.triggerSource) {
      qb.andWhere('q.trigger_source = :triggerSource', {
        triggerSource: query.triggerSource,
      });
    }

    if (query.reasonCode) {
      qb.andWhere('q.reason_code = :reasonCode', {
        reasonCode: query.reasonCode,
      });
    }

    if (query.reviewerAssignedTo) {
      qb.andWhere('q.reviewer_assigned_to = :reviewerAssignedTo', {
        reviewerAssignedTo: query.reviewerAssignedTo,
      });
    }

    if (query.bloodUnitId) {
      qb.andWhere('q.blood_unit_id = :bloodUnitId', {
        bloodUnitId: query.bloodUnitId,
      });
    }

    if (query.active !== undefined) {
      qb.andWhere('q.active = :active', {
        active: query.active === 'true',
      });
    }

    const cases = await qb.getMany();
    return { data: cases };
  }

  async getCase(caseId: string) {
    const existing = await this.quarantineRepository.findOne({
      where: { id: caseId },
    });
    if (!existing) {
      throw new NotFoundException(`Quarantine case ${caseId} not found`);
    }
    return existing;
  }

  private async validateEvidenceRequirements(dto: CreateQuarantineCaseDto) {
    const policy = this.policyCenterService.getDefaultRules();
    const evidenceReqs = policy.quarantine.evidenceRequirements;

    if (dto.evidence.length < evidenceReqs.minimumEvidenceCount) {
      throw new BadRequestException(
        `Minimum ${evidenceReqs.minimumEvidenceCount} evidence items required, got ${dto.evidence.length}`,
      );
    }

    // Validate each evidence item
    for (const evidence of dto.evidence) {
      if (!evidenceReqs.allowedEvidenceTypes.includes(evidence.type)) {
        throw new BadRequestException(
          `Evidence type '${evidence.type}' not allowed. Allowed types: ${evidenceReqs.allowedEvidenceTypes.join(', ')}`,
        );
      }

      // Check if file exists
      try {
        await this.fileMetadataService.register({
          ownerType: 'quarantine_evidence',
          ownerId: dto.bloodUnitId,
          storagePath: evidence.fileId, // Assuming fileId is the storage path
          originalFilename: evidence.description || 'evidence',
        });
      } catch (error) {
        throw new BadRequestException(`Evidence file ${evidence.fileId} not found or invalid`);
      }
    }
  }

  private determineInitialReviewState(
    dto: CreateQuarantineCaseDto,
    policy: any,
  ): QuarantineReviewState {
    const triggerConfig = policy.quarantine.triggerMatrix[dto.triggerSource.toLowerCase()];

    if (triggerConfig?.autoQuarantine) {
      return QuarantineReviewState.UNDER_REVIEW;
    }

    return QuarantineReviewState.PENDING;
  }

  private requiresApproval(dto: CreateQuarantineCaseDto, policy: any): boolean {
    const triggerConfig = policy.quarantine.triggerMatrix[dto.triggerSource.toLowerCase()];
    return triggerConfig?.approvalRequired ?? false;
  }

  private async createDispositionApprovalRequest(
    quarantineCase: QuarantineCase,
    user?: AuthenticatedUserContext,
  ) {
    const policy = this.policyCenterService.getDefaultRules();
    const dispositionRules = policy.quarantine.dispositionRules[quarantineCase.triggerSource.toLowerCase() as keyof typeof policy.quarantine.dispositionRules];

    await this.approvalService.createRequest({
      targetId: quarantineCase.id,
      actionType: ApprovalActionType.ESCROW_RELEASE, // Using existing approval type, could add specific quarantine type
      requesterId: user?.id ?? 'system',
      requiredApprovals: dispositionRules?.requiredApprovals ?? 1,
      metadata: {
        quarantineCaseId: quarantineCase.id,
        bloodUnitId: quarantineCase.bloodUnitId,
        triggerSource: quarantineCase.triggerSource,
        reasonCode: quarantineCase.reasonCode,
        recommendedDisposition: dispositionRules?.defaultDisposition ?? 'RELEASE',
      },
      expiresInHours: 72, // 3 days
      finalPayload: {
        action: 'finalize_quarantine',
        caseId: quarantineCase.id,
        disposition: dispositionRules?.defaultDisposition ?? 'RELEASE',
      },
    });
  }

  async getRecommendedDisposition(caseId: string): Promise<{
    recommendedDisposition: QuarantineDisposition;
    confidence: number;
    reasoning: string[];
  }> {
    const quarantineCase = await this.getCase(caseId);
    const policy = this.policyCenterService.getDefaultRules();
    const dispositionRules = policy.quarantine.dispositionRules[quarantineCase.triggerSource.toLowerCase() as keyof typeof policy.quarantine.dispositionRules];

    const recommended = dispositionRules?.defaultDisposition ?? 'RELEASE';
    const reasoning = [
      `Policy default for ${quarantineCase.triggerSource}: ${recommended}`,
      `Evidence provided: ${quarantineCase.evidence?.length ?? 0} items`,
    ];

    // Add time-based logic
    const hoursSinceCreation = (Date.now() - quarantineCase.createdAt.getTime()) / (1000 * 60 * 60);
    if (dispositionRules?.autoApproveThresholdHours && hoursSinceCreation >= dispositionRules.autoApproveThresholdHours) {
      reasoning.push(`Auto-approval threshold reached (${hoursSinceCreation.toFixed(1)} hours >= ${dispositionRules.autoApproveThresholdHours} hours)`);
    }

    return {
      recommendedDisposition: recommended as QuarantineDisposition,
      confidence: 0.8, // Could be improved with ML models
      reasoning,
    };
  }
}
