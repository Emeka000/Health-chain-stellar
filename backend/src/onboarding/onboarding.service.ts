import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationVerificationStatus } from '../organizations/enums/organization-verification-status.enum';
import { OrganizationRepository } from '../organizations/organizations.repository';
import { ReadinessEntityType } from '../readiness/enums/readiness.enum';
import { ReadinessService } from '../readiness/readiness.service';
import { SorobanService } from '../soroban/soroban.service';

import {
  ActivateOnboardingDto,
  CreateOnboardingDto,
  ReviewOnboardingDto,
  SaveStepDto,
} from './dto/onboarding.dto';
import { PartnerOnboardingEntity } from './entities/partner-onboarding.entity';
import { OnboardingStatus, OnboardingStep } from './enums/onboarding.enum';

/** Required fields per step for compliance validation */
const REQUIRED_FIELDS: Record<OnboardingStep, string[]> = {
  [OnboardingStep.PROFILE]: ['name', 'legalName', 'email', 'phone'],
  [OnboardingStep.COMPLIANCE]: [
    'licenseNumber',
    'registrationNumber',
    'licenseDocumentUrl',
  ],
  [OnboardingStep.CONTACTS]: ['contactName', 'contactEmail'],
  [OnboardingStep.SERVICE_AREAS]: ['serviceAreas'],
  [OnboardingStep.WALLET]: ['walletAddress'],
};

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(PartnerOnboardingEntity)
    private readonly repo: Repository<PartnerOnboardingEntity>,
    private readonly orgRepo: OrganizationRepository,
    private readonly sorobanService: SorobanService,
    private readonly readinessService: ReadinessService,
  ) {}

  async create(
    userId: string,
    dto: CreateOnboardingDto,
  ): Promise<PartnerOnboardingEntity> {
    const draft = this.repo.create({
      submittedBy: userId,
      orgType: dto.orgType,
      status: OnboardingStatus.DRAFT,
      currentStep: OnboardingStep.PROFILE,
      data: {},
    });
    return this.repo.save(draft);
  }

  async saveStep(
    id: string,
    userId: string,
    dto: SaveStepDto,
  ): Promise<PartnerOnboardingEntity> {
    const onboarding = await this.findOwned(id, userId);
    this.assertEditable(onboarding);

    onboarding.data = { ...onboarding.data, [dto.step]: dto.data };
    onboarding.currentStep = dto.step;
    return this.repo.save(onboarding);
  }

  async submit(id: string, userId: string): Promise<PartnerOnboardingEntity> {
    const onboarding = await this.findOwned(id, userId);
    this.assertEditable(onboarding);
    this.validateAllSteps(onboarding);

    onboarding.status = OnboardingStatus.SUBMITTED;
    return this.repo.save(onboarding);
  }

  async review(
    id: string,
    reviewerId: string,
    dto: ReviewOnboardingDto,
  ): Promise<PartnerOnboardingEntity> {
    const onboarding = await this.repo.findOne({ where: { id } });
    if (!onboarding) throw new NotFoundException('Onboarding not found');
    if (onboarding.status !== OnboardingStatus.SUBMITTED) {
      throw new BadRequestException(
        'Only submitted onboardings can be reviewed',
      );
    }

    onboarding.status =
      dto.decision === 'approved'
        ? OnboardingStatus.APPROVED
        : OnboardingStatus.REJECTED;
    onboarding.reviewedBy = reviewerId;
    onboarding.reviewedAt = new Date();
    onboarding.rejectionReason = dto.rejectionReason ?? null;
    return this.repo.save(onboarding);
  }

  async activate(
    id: string,
    reviewerId: string,
    dto: ActivateOnboardingDto,
  ): Promise<PartnerOnboardingEntity> {
    const onboarding = await this.repo.findOne({ where: { id } });
    if (!onboarding) throw new NotFoundException('Onboarding not found');
    if (onboarding.status !== OnboardingStatus.APPROVED) {
      throw new BadRequestException(
        'Only approved onboardings can be activated',
      );
    }

    // Readiness gate: partner must have a signed-off readiness checklist
    const ready = await this.readinessService.isReady(
      ReadinessEntityType.PARTNER,
      id,
    );
    if (!ready) {
      throw new BadRequestException(
        'Partner readiness checklist is not signed off. Complete all readiness items before activation.',
      );
    }

    this.validateAllSteps(onboarding);

    const profileData = (onboarding.data[OnboardingStep.PROFILE] ??
      {}) as Record<string, string>;

    // Register on-chain via identity contract (non-fatal)
    let contractTxHash: string | null = null;
    try {
      const result = await this.sorobanService.verifyOrganization(
        dto.walletAddress,
      );
      contractTxHash = result.transactionHash;
    } catch {
      // on-chain registration can be retried separately
    }

    // Create the organization record
    const org = this.orgRepo.create({
      name: profileData['name'] ?? '',
      legalName: profileData['legalName'] ?? null,
      email: profileData['email'] ?? null,
      phone: profileData['phone'] ?? null,
      licenseNumber: dto.licenseNumber,
      type: onboarding.orgType,
      blockchainAddress: dto.walletAddress,
      status: OrganizationVerificationStatus.APPROVED,
      licenseDocumentPath: '',
      certificateDocumentPath: '',
      blockchainTxHash: contractTxHash,
      isActive: true,
    } as Partial<OrganizationEntity> as OrganizationEntity);

    const saved = await this.orgRepo.save(org);

    onboarding.status = OnboardingStatus.ACTIVATED;
    onboarding.organizationId = saved.id;
    onboarding.contractTxHash = contractTxHash;
    return this.repo.save(onboarding);
  }

  async getById(id: string): Promise<PartnerOnboardingEntity> {
    const o = await this.repo.findOne({ where: { id } });
    if (!o) throw new NotFoundException('Onboarding not found');
    return o;
  }

  async listPending(): Promise<PartnerOnboardingEntity[]> {
    return this.repo.find({
      where: { status: OnboardingStatus.SUBMITTED },
      order: { createdAt: 'ASC' },
    });
  }

  // ── Private ──────────────────────────────────────────────────────────

  private async findOwned(
    id: string,
    userId: string,
  ): Promise<PartnerOnboardingEntity> {
    const o = await this.repo.findOne({ where: { id, submittedBy: userId } });
    if (!o) throw new NotFoundException('Onboarding not found');
    return o;
  }

  private assertEditable(o: PartnerOnboardingEntity): void {
    if (o.status !== OnboardingStatus.DRAFT) {
      throw new BadRequestException('Only draft onboardings can be edited');
    }
  }

  private validateAllSteps(o: PartnerOnboardingEntity): void {
    const missing: string[] = [];
    for (const [step, fields] of Object.entries(REQUIRED_FIELDS)) {
      const stepData = (o.data[step] ?? {}) as Record<string, unknown>;
      for (const field of fields) {
        if (!stepData[field]) missing.push(`${step}.${field}`);
      }
    }
    if (missing.length) {
      throw new BadRequestException(
        `Missing required fields: ${missing.join(', ')}`,
      );
    }
  }
}
