import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { REQUEST } from '@nestjs/core';

import { Repository } from 'typeorm';
import { Request } from 'express';

import { AuditChainService } from './audit-chain.service';
import { AuditLogEntity } from './audit-log.entity';
import {
  getAuditEventDefinition,
  isValidAuditAction,
} from './audit-event-catalog';

export interface AuditLogParams {
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  previousValue?: Record<string, unknown> | null;
  nextValue?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
    @Optional() @Inject(REQUEST) private readonly request?: Request,
    @Optional() private readonly auditChain?: AuditChainService,
  ) {}

  /**
   * Insert-only — no update or delete is ever called on this repository.
   * Enhanced with automatic correlation ID extraction and event catalog validation.
   */
  async insert(params: AuditLogParams): Promise<void> {
    try {
      // Validate action against catalog and log warning if not found
      if (!isValidAuditAction(params.action)) {
        this.logger.warn(
          `Audit action "${params.action}" not found in catalog. Consider adding it for proper categorization.`,
        );
      }

      // Get event definition for category and severity
      const eventDef = getAuditEventDefinition(params.action);

      // Extract correlation ID from request if not provided
      const correlationId =
        params.correlationId ?? (this.request as any)?.correlationId ?? null;

      // Extract user agent if not provided
      const userAgent =
        params.userAgent ?? this.request?.headers?.['user-agent'] ?? null;

      // Extract IP address if not provided
      const ipAddress =
        params.ipAddress ??
        (this.request?.headers?.['x-forwarded-for'] as string)
          ?.split(',')[0]
          ?.trim() ??
        this.request?.ip ??
        null;

      const result = await this.repo.insert({
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: params.action,
        category: eventDef?.category ?? null,
        severity: eventDef?.severity ?? null,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        previousValue: params.previousValue ?? null,
        nextValue: params.nextValue ?? null,
        ipAddress,
        userAgent,
        correlationId,
        metadata: params.metadata ?? null,
      });

      // Append to cryptographic chain (non-blocking — errors are swallowed inside append())
      const insertedId = result.identifiers[0]?.id as string | undefined;
      if (insertedId && this.auditChain) {
        void this.auditChain.append(insertedId);
      }

      // Log critical events for immediate alerting
      if (eventDef?.severity === 'critical') {
        this.logger.warn(
          `CRITICAL AUDIT EVENT: ${params.action} by ${params.actorId} (${params.actorRole}) on ${params.resourceType}/${params.resourceId}`,
          { correlationId, ipAddress },
        );
      }
    } catch (err) {
      // Audit failures must never break the primary operation
      this.logger.error(
        `Failed to write audit log [${params.action}] for ${params.resourceType}/${params.resourceId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Find audit logs by resource
   */
  async findByResource(
    resourceType: string,
    resourceId: string,
    limit = 100,
    offset = 0,
  ): Promise<{ data: AuditLogEntity[]; total: number }> {
    const [data, total] = await this.repo.findAndCount({
      where: { resourceType, resourceId },
      order: { timestamp: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, total };
  }

  /**
   * Find audit logs by actor
   */
  async findByActor(
    actorId: string,
    limit = 100,
    offset = 0,
  ): Promise<{ data: AuditLogEntity[]; total: number }> {
    const [data, total] = await this.repo.findAndCount({
      where: { actorId },
      order: { timestamp: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, total };
  }

  /**
   * Find audit logs by correlation ID (trace related operations)
   */
  async findByCorrelationId(
    correlationId: string,
    limit = 100,
    offset = 0,
  ): Promise<{ data: AuditLogEntity[]; total: number }> {
    const [data, total] = await this.repo.findAndCount({
      where: { correlationId },
      order: { timestamp: 'ASC' }, // Chronological order for tracing
      take: limit,
      skip: offset,
    });
    return { data, total };
  }

  /**
   * Find audit logs by category
   */
  async findByCategory(
    category: string,
    limit = 100,
    offset = 0,
  ): Promise<{ data: AuditLogEntity[]; total: number }> {
    const [data, total] = await this.repo.findAndCount({
      where: { category },
      order: { timestamp: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, total };
  }

  /**
   * Find critical audit events
   */
  async findCriticalEvents(
    limit = 100,
    offset = 0,
  ): Promise<{ data: AuditLogEntity[]; total: number }> {
    const [data, total] = await this.repo.findAndCount({
      where: { severity: 'critical' },
      order: { timestamp: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, total };
  }
}
