import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SorobanService } from '../blockchain/services/soroban.service';
import { EmailProvider } from '../notifications/providers/email.provider';

import { RegisterOrganizationDto } from './dto/register-organization.dto';
import { RejectOrganizationDto } from './dto/reject-organization.dto';
import { OrganizationEntity } from './entities/organization.entity';
import { OrganizationVerificationStatus } from './enums/organization-verification-status.enum';
import { OrganizationRepository } from './organizations.repository';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly orgRepo: OrganizationRepository,
    private readonly emailProvider: EmailProvider,
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
  ) {}

  private uploadRoot(): string {
    return this.configService.get<string>(
      'ORG_UPLOAD_BASE_DIR',
      'uploads/organizations',
    );
  }

  private assertFile(
    file: Express.Multer.File | undefined,
    field: string,
  ): Express.Multer.File {
    if (!file) {
      throw new BadRequestException(`Missing file: ${field}`);
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        `${field} must be PDF, JPEG, or PNG (got ${file.mimetype})`,
      );
    }
    const max = 5 * 1024 * 1024;
    if (file.size > max) {
      throw new BadRequestException(`${field} must be at most 5 MB`);
    }
    return file;
  }

  private extFrom(file: Express.Multer.File): string {
    const name = file.originalname || '';
    const dot = name.lastIndexOf('.');
    if (dot > 0) return name.slice(dot).toLowerCase().slice(0, 8);
    if (file.mimetype === 'application/pdf') return '.pdf';
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
      return '.jpg';
    }
    if (file.mimetype === 'image/png') return '.png';
    return '.bin';
  }

  private async persistDocuments(
    orgId: string,
    license: Express.Multer.File,
    certificate: Express.Multer.File,
  ): Promise<{ licensePath: string; certificatePath: string }> {
    const base = join(process.cwd(), this.uploadRoot(), orgId);
    await mkdir(base, { recursive: true });
    const licenseName = `license${this.extFrom(license)}`;
    const certName = `certificate${this.extFrom(certificate)}`;
    const licensePathFs = join(base, licenseName);
    const certificatePathFs = join(base, certName);
    await writeFile(licensePathFs, license.buffer);
    await writeFile(certificatePathFs, certificate.buffer);
    const rel = (fname: string) =>
      join(this.uploadRoot(), orgId, fname).replace(/\\/g, '/');
    return {
      licensePath: rel(licenseName),
      certificatePath: rel(certName),
    };
  }

  async register(
    dto: RegisterOrganizationDto,
    files: {
      licenseDocument?: Express.Multer.File[];
      certificateDocument?: Express.Multer.File[];
    },
  ): Promise<{ message: string; data: OrganizationEntity }> {
    const license = this.assertFile(
      files.licenseDocument?.[0],
      'licenseDocument',
    );
    const certificate = this.assertFile(
      files.certificateDocument?.[0],
      'certificateDocument',
    );

    const existing = await this.orgRepo.findOne({
      where: { licenseNumber: dto.licenseNumber },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException({
        message:
          'An organization with this license number is already registered',
        field: 'licenseNumber',
      });
    }

    const entity = this.orgRepo.create({
      name: dto.name.trim(),
      legalName: dto.legalName.trim(),
      email: dto.email.trim().toLowerCase(),
      phone: dto.phone.replace(/\s/g, ''),
      address: dto.address?.trim() ?? null,
      licenseNumber: dto.licenseNumber.trim(),
      status: OrganizationVerificationStatus.PENDING_VERIFICATION,
      licenseDocumentPath: '',
      certificateDocumentPath: '',
    });

    const saved = await this.orgRepo.save(entity);
    const paths = await this.persistDocuments(saved.id, license, certificate);
    saved.licenseDocumentPath = paths.licensePath;
    saved.certificateDocumentPath = paths.certificatePath;
    await this.orgRepo.save(saved);

    await this.sendRegistrationReceivedEmail(saved);

    return {
      message: 'Organization registration submitted for verification',
      data: saved,
    };
  }

  async listPending(): Promise<OrganizationEntity[]> {
    return this.orgRepo
      .createActiveQueryBuilder('org')
      .where('org.status = :status', {
        status: OrganizationVerificationStatus.PENDING_VERIFICATION,
      })
      .orderBy('org.createdAt', 'ASC')
      .getMany();
  }

  async approve(
    organizationId: string,
    adminUserId: string,
  ): Promise<{ message: string; data: OrganizationEntity }> {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    if (org.status !== OrganizationVerificationStatus.PENDING_VERIFICATION) {
      throw new ConflictException(
        'Only organizations pending verification can be approved',
      );
    }

    const registryAddress =
      this.configService.get<string>('SOROBAN_ORG_REGISTRY_CONTRACT_ID') ??
      this.configService.get<string>('SOROBAN_CONTRACT_ID') ??
      null;

    let txHash: string;
    try {
      const result = await this.sorobanService.submitTransactionAndWait({
        contractMethod: 'register_verified_organization',
        args: [org.id, org.licenseNumber, org.name],
        idempotencyKey: `org-verified:${org.id}`,
        metadata: { organizationId: org.id },
      });
      txHash = result.transactionHash;
    } catch (err) {
      this.logger.error(
        `Blockchain registration failed for org ${org.id}`,
        err,
      );
      throw new UnprocessableEntityException(
        'Could not complete on-chain verification. Please retry or contact platform ops.',
      );
    }

    org.status = OrganizationVerificationStatus.APPROVED;
    org.verifiedAt = new Date();
    org.verifiedByUserId = adminUserId;
    org.rejectionReason = null;
    org.blockchainTxHash = txHash;
    org.blockchainAddress = registryAddress;
    await this.orgRepo.save(org);

    await this.sendApprovedEmail(org);

    return {
      message: 'Organization approved and recorded on-chain',
      data: org,
    };
  }

  async reject(
    organizationId: string,
    dto: RejectOrganizationDto,
    adminUserId: string,
  ): Promise<{ message: string; data: OrganizationEntity }> {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    if (org.status !== OrganizationVerificationStatus.PENDING_VERIFICATION) {
      throw new ConflictException(
        'Only organizations pending verification can be rejected',
      );
    }

    org.status = OrganizationVerificationStatus.REJECTED;
    org.rejectionReason = dto.reason.trim();
    org.verifiedAt = new Date();
    org.verifiedByUserId = adminUserId;
    await this.orgRepo.save(org);

    await this.sendRejectedEmail(org);

    return {
      message: 'Organization registration rejected',
      data: org,
    };
  }

  private async sendRegistrationReceivedEmail(org: OrganizationEntity) {
    if (!org.email) {
      return;
    }
    const subject = 'We received your organization registration';
    const html = `
      <p>Hello ${org.name},</p>
      <p>Your registration request for <strong>${org.legalName}</strong> (license <code>${org.licenseNumber}</code>) was received and is <strong>pending verification</strong>.</p>
      <p>You will receive another email when an administrator approves or rejects your application.</p>
    `;
    await this.emailProvider.send(org.email, subject, html);
  }

  private async sendApprovedEmail(org: OrganizationEntity) {
    if (!org.email) {
      return;
    }
    const subject = 'Your organization registration was approved';
    const txLine = org.blockchainTxHash
      ? `<p>On-chain reference: <code>${org.blockchainTxHash}</code></p>`
      : '';
    const regLine = org.blockchainAddress
      ? `<p>Registry contract: <code>${org.blockchainAddress}</code></p>`
      : '';
    const html = `
      <p>Hello ${org.name},</p>
      <p>Your organization <strong>${org.legalName}</strong> has been <strong>approved</strong>.</p>
      ${txLine}
      ${regLine}
    `;
    await this.emailProvider.send(org.email, subject, html);
  }

  private async sendRejectedEmail(org: OrganizationEntity) {
    if (!org.email) {
      return;
    }
    const subject = 'Update on your organization registration';
    const html = `
      <p>Hello ${org.name},</p>
      <p>Your organization registration for <strong>${org.legalName}</strong> was <strong>not approved</strong>.</p>
      <p><strong>Reason:</strong></p>
      <blockquote>${org.rejectionReason ?? ''}</blockquote>
    `;
    await this.emailProvider.send(org.email, subject, html);
  }
}
