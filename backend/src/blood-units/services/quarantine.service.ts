import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

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
  QuarantineReasonCode,
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
      reviewState: QuarantineReviewState.PENDING,
      createdBy: user?.id ?? null,
      active: true,
    });

    const saved = await this.quarantineRepository.save(entity);
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
        reasonCode: QuarantineReasonCode.STORAGE_ANOMALY,
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
}
