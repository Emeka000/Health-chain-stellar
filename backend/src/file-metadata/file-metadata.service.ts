import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import * as fs from 'fs';
import {
  FileLifecycleStatus,
  FileMetadataEntity,
  FileOwnerType,
} from './entities/file-metadata.entity';

export interface RegisterFileDto {
  ownerType: FileOwnerType;
  ownerId: string;
  storagePath: string;
  originalFilename?: string;
  contentType?: string;
  sizeBytes?: number;
  sha256Hash?: string;
}

@Injectable()
export class FileMetadataService {
  private readonly logger = new Logger(FileMetadataService.name);

  constructor(
    @InjectRepository(FileMetadataEntity)
    private readonly repo: Repository<FileMetadataEntity>,
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

  /** Mark a file as ORPHANED (owner entity was rolled back / never committed). */
  async markOrphaned(storagePath: string): Promise<void> {
    await this.repo.update({ storagePath }, { status: FileLifecycleStatus.ORPHANED });
  }

  /** Soft-delete a file record and remove it from disk. */
  async delete(id: string): Promise<void> {
    const record = await this.repo.findOne({ where: { id } });
    if (!record || record.status === FileLifecycleStatus.DELETED) return;

    try {
      if (fs.existsSync(record.storagePath)) fs.unlinkSync(record.storagePath);
    } catch (err) {
      this.logger.warn(`Could not delete file ${record.storagePath}: ${err.message}`);
    }

    await this.repo.update(id, {
      status: FileLifecycleStatus.DELETED,
      deletedAt: new Date(),
    });
  }

  /** Return all ORPHANED or SUPERSEDED records older than retentionMs milliseconds. */
  async findGcCandidates(retentionMs = 24 * 60 * 60 * 1000): Promise<FileMetadataEntity[]> {
    const cutoff = new Date(Date.now() - retentionMs);
    return this.repo.find({
      where: [
        { status: FileLifecycleStatus.ORPHANED, createdAt: LessThan(cutoff) },
        { status: FileLifecycleStatus.SUPERSEDED, updatedAt: LessThan(cutoff) },
      ],
    });
  }
}
