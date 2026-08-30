import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Between, LessThan, Repository } from 'typeorm';

import { ActivityQueryDto } from './dto/activity-query.dto';
import { UserActivityEntity } from './entities/user-activity.entity';
import { ActivityType } from './enums/activity-type.enum';

export interface ActivityRequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class UserActivityService {
  private readonly logger = new Logger(UserActivityService.name);
  private static readonly RETENTION_DAYS = 90;

  constructor(
    @InjectRepository(UserActivityEntity)
    private readonly activityRepository: Repository<UserActivityEntity>,
  ) {}

  async logActivity(params: {
    userId?: string | null;
    activityType: ActivityType;
    description: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<UserActivityEntity> {
    const activity = this.activityRepository.create({
      userId: params.userId ?? null,
      activityType: params.activityType,
      description: params.description,
      metadata: params.metadata ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
    return this.activityRepository.save(activity);
  }

  async queryActivities(query: ActivityQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.activityType) {
      where.activityType = query.activityType;
    }
    if (query.startDate || query.endDate) {
      const start = query.startDate ? new Date(query.startDate) : new Date(0);
      const end = query.endDate ? new Date(query.endDate) : new Date();
      where.createdAt = Between(start, end);
    }

    const [items, total] = await this.activityRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async exportActivities(query: ActivityQueryDto): Promise<string> {
    const result = await this.queryActivities({
      ...query,
      page: 1,
      limit: 5000,
    });
    const rows = result.data;

    // Filter out activities with redacted user data
    const filteredRows = rows.filter(item => {
      // If userId is redacted (marked as [REDACTED]), exclude from export
      if (item.userId === '[REDACTED]') {
        return false;
      }
      // If IP address is redacted, still include but mark as redacted
      return true;
    });

    const csvHeader =
      'id,userId,activityType,description,ipAddress,userAgent,createdAt';
    const csvRows = filteredRows.map((item) =>
      [
        item.id,
        item.userId ?? '',
        item.activityType,
        this.escapeCsv(item.description),
        item.ipAddress ?? '',
        this.escapeCsv(item.userAgent ?? ''),
        item.createdAt.toISOString(),
      ].join(','),
    );
    return [csvHeader, ...csvRows].join('\n');
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async cleanupOldActivities(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(
      cutoffDate.getDate() - UserActivityService.RETENTION_DAYS,
    );

    const result = await this.activityRepository.delete({
      createdAt: LessThan(cutoffDate),
    });
    const deleted = result.affected ?? 0;
    if (deleted > 0) {
      this.logger.log(
        `Deleted ${deleted} user activity rows older than 90 days`,
      );
    }
    return deleted;
  }

  private escapeCsv(value: string): string {
    const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    const escaped = neutralized.replace(/"/g, '""');
    return `"${escaped}"`;
  }
}
