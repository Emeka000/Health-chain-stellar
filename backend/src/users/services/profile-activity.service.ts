import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  ProfileActivityEntity,
  ProfileActivityType,
} from '../entities/profile-activity.entity';

export interface LogActivityParams {
  userId: string;
  activityType: ProfileActivityType;
  description?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ProfileActivityService {
  constructor(
    @InjectRepository(ProfileActivityEntity)
    private readonly activityRepository: Repository<ProfileActivityEntity>,
  ) {}

  async logActivity(params: LogActivityParams): Promise<ProfileActivityEntity> {
    const activity = this.activityRepository.create({
      userId: params.userId,
      activityType: params.activityType,
      description: params.description || null,
      metadata: params.metadata || null,
      ipAddress: params.ipAddress || null,
      userAgent: params.userAgent || null,
    });

    return this.activityRepository.save(activity);
  }

  async getUserActivities(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ data: ProfileActivityEntity[]; total: number }> {
    const [data, total] = await this.activityRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { data, total };
  }

  async getActivityById(id: string): Promise<ProfileActivityEntity | null> {
    return this.activityRepository.findOne({ where: { id } });
  }

  async deleteOldActivities(
    userId: string,
    daysToKeep: number = 90,
  ): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.activityRepository
      .createQueryBuilder()
      .delete()
      .from(ProfileActivityEntity)
      .where('userId = :userId', { userId })
      .andWhere('createdAt < :cutoffDate', { cutoffDate })
      .execute();

    return result.affected || 0;
  }
}
