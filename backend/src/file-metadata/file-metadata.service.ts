import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as fs from 'fs';
import {
  FileLifecycleStatus,
  FileMetadataEntity,
  FileOwnerType,
} from './entities/file-metadata.entity';
import { FileMetadataAuditLogEntity } from './entities/file-metadata-audit-log.entity';

export interface RegisterFileDto {
  ownerType: FileOwnerType;
  ownerId: string;
  storagePath: string;
  originalFilename?: string;
  contentType?: string;
  sizeBytes?: number;
  sha256Hash?: string;
  retentionExpiresAt?: Date;
}

export interface UpdatePolicyDto {
  retentionExpiresAt?: Date;
  status?: FileLifecycleStatus;
}

@Injectable()
export class FileMetadataService {
  private readonly logger = new Logger(FileMetadataService.name);

  constructor(
    @InjectRepository(FileMetadataEntity)
    private readonly repo: Repository<FileMetadataEntity>,
    @InjectRepository(FileMetadataAuditLogEntity)
    private readonly auditRepo: Repository<FileMetadataAuditLogEntity>,
  ) {}

  async register(dto: RegisterFileDto): Promise<FileMetadataEntity> {
    const record = this.repo.create({
      ownerType: dto.ownerType,
      ownerId: dto.ownerId,
      storagePath: dto.storagePath,
      originalFilename: dto.originalFilename ?? null,
      contentType: dto.contentType ?? null,
      sizeBytes: dto.sizeBytes ?? null,
      sha256Hash: dto.sha256Hash ?? null,
      status: FileLifecycleStatus.ACTIVE,
      metadataVersion: 1,
      retentionExpiresAt: dto.retentionExpiresAt ?? null,
      legalHold: false,
    });
    return this.repo.save(record);
  }

  /** Mark all previous ACTIVE files for an owner as SUPERSEDED, then register the new one. */
  async replace(dto: RegisterFileDto): Promise<FileMetadataEntity> {
    await this.repo.update(
      { ownerType: dto.ownerType, ownerId: dto.ownerId, status: FileLifecycleStatus.ACTIVE },
      { status: FileLifecycleStatus.SUPERSEDED },
    );
    return this.register(dto);
  }

  /**
   * Update mutable policy-controlled fields.
   * Immutable fields (ownerType, ownerId, storagePath, sha256Hash, etc.) cannot be changed.
   * Every update is versioned and recorded in the audit log.
   */
  async updatePolicy(
    id: string,
    dto: UpdatePolicyDto,
    actorId: string,
    reason: string,
  ): Promise<FileMetadataEntity> {
    const record = await this.findOrFail(id);

    const previousValues: Record<string, unknown> = {
      status: record.status,
      retentionExpiresAt: record.retentionExpiresAt,
      metadataVersion: record.metadataVersion,
    };

    if (dto.status !== undefined) record.status = dto.status;
    if (dto.retentionExpiresAt !== undefined) record.retentionExpiresAt = dto.retentionExpiresAt;
    record.metadataVersion += 1;

    const saved = await this.repo.save(record);

    await this.auditRepo.save(
      this.auditRepo.create({
        fileId: id,
        version: saved.metadataVersion,
        actorId,
        reason,
        previousValues,
        newValues: { status: saved.status, retentionExpiresAt: saved.retentionExpiresAt },
      }),
    );

    return saved;
  }

  /** Place a legal hold — prevents deletion regardless of retention policy. */
  async placeLegalHold(id: string, actorId: string, reason: string): Promise<FileMetadataEntity> {
    const record = await this.findOrFail(id);
    if (record.legalHold) return record; // idempotent

    const prev = { legalHold: record.legalHold, metadataVersion: record.metadataVersion };
    record.legalHold = true;
    record.legalHoldBy = actorId;
    record.legalHoldReason = reason;
    record.metadataVersion += 1;
    const saved = await this.repo.save(record);

    await this.auditRepo.save(
      this.auditRepo.create({
        fileId: id,
        version: saved.metadataVersion,
        actorId,
        reason: `Legal hold placed: ${reason}`,
        previousValues: prev,
        newValues: { legalHold: true, legalHoldBy: actorId },
      }),
    );

    return saved;
  }

  /** Release a legal hold. Only the actor who placed it (or an admin) should call this. */
  async releaseLegalHold(id: string, actorId: string, reason: string): Promise<FileMetadataEntity> {
    const record = await this.findOrFail(id);
    if (!record.legalHold) return record;

    const prev = { legalHold: record.legalHold, metadataVersion: record.metadataVersion };
    record.legalHold = false;
    record.legalHoldBy = null;
    record.legalHoldReason = null;
    record.metadataVersion += 1;
    const saved = await this.repo.save(record);

    await this.auditRepo.save(
      this.auditRepo.create({
        fileId: id,
        version: saved.metadataVersion,
        actorId,
        reason: `Legal hold released: ${reason}`,
        previousValues: prev,
        newValues: { legalHold: false },
      }),
    );

    return saved;
  }

  /**
   * Re-validate the stored sha256Hash against the file on disk.
   * Returns true if the digest matches (file is intact).
   */
  async validateDigest(id: string): Promise<{ intact: boolean; storedHash: string | null; computedHash: string | null }> {
    const record = await this.findOrFail(id);

    if (!record.sha256Hash) {
      return { intact: false, storedHash: null, computedHash: null };
    }

    if (!fs.existsSync(record.storagePath)) {
      return { intact: false, storedHash: record.sha256Hash, computedHash: null };
    }

    const content = fs.readFileSync(record.storagePath);
    const computedHash = crypto.createHash('sha256').update(content).digest('hex');
    return {
      intact: computedHash === record.sha256Hash,
      storedHash: record.sha256Hash,
      computedHash,
    };
  }

  /** Mark a file as ORPHANED (owner entity was rolled back / never committed). */
  async markOrphaned(storagePath: string): Promise<void> {
    await this.repo.update({ storagePath }, { status: FileLifecycleStatus.ORPHANED });
  }

  /**
   * Soft-delete a file record and remove it from disk.
   * Blocked if the file is under legal hold.
   */
  async delete(id: string, actorId = 'system'): Promise<void> {
    const record = await this.repo.findOne({ where: { id } });
    if (!record || record.status === FileLifecycleStatus.DELETED) return;

    if (record.legalHold) {
      throw new ForbiddenException(
        `File '${id}' is under legal hold and cannot be deleted`,
      );
    }

    try {
      if (fs.existsSync(record.storagePath)) fs.unlinkSync(record.storagePath);
    } catch (err) {
      this.logger.warn(`Could not delete file ${record.storagePath}: ${(err as Error).message}`);
    }

    const prev = { status: record.status, metadataVersion: record.metadataVersion };
    record.status = FileLifecycleStatus.DELETED;
    record.deletedAt = new Date();
    record.metadataVersion += 1;
    await this.repo.save(record);

    await this.auditRepo.save(
      this.auditRepo.create({
        fileId: id,
        version: record.metadataVersion,
        actorId,
        reason: 'File deleted',
        previousValues: prev,
        newValues: { status: FileLifecycleStatus.DELETED },
      }),
    );
  }

  /** Return all ORPHANED or SUPERSEDED records older than retentionMs milliseconds. */
  async findGcCandidates(retentionMs = 24 * 60 * 60 * 1000): Promise<FileMetadataEntity[]> {
    const cutoff = new Date(Date.now() - retentionMs);
    const candidates = await this.repo.find({
      where: [
        { status: FileLifecycleStatus.ORPHANED, createdAt: LessThan(cutoff) },
        { status: FileLifecycleStatus.SUPERSEDED, updatedAt: LessThan(cutoff) },
      ],
    });
    // Exclude files under legal hold
    return candidates.filter((c) => !c.legalHold);
  }

  /** Return audit log for a file, ordered by version ascending. */
  async getAuditLog(id: string): Promise<FileMetadataAuditLogEntity[]> {
    await this.findOrFail(id);
    return this.auditRepo.find({ where: { fileId: id }, order: { version: 'ASC' } });
  }

  private async findOrFail(id: string): Promise<FileMetadataEntity> {
    const record = await this.repo.findOne({ where: { id } });
    if (!record) throw new NotFoundException(`File metadata '${id}' not found`);
    return record;
  }
}

