import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, LessThan } from 'typeorm';

import { AuthSessionEntity } from '../entities/auth-session.entity';

@Injectable()
export class AuthSessionRepository {
  constructor(
    @InjectRepository(AuthSessionEntity)
    private readonly repository: Repository<AuthSessionEntity>,
  ) {}

  async create(
    sessionData: Partial<AuthSessionEntity>,
  ): Promise<AuthSessionEntity> {
    const session = this.repository.create(sessionData);
    return this.repository.save(session);
  }

  async findBySessionId(sessionId: string): Promise<AuthSessionEntity | null> {
    return this.repository.findOne({
      where: { sessionId, isActive: true },
    });
  }

  async findActiveSessionsByUserId(
    userId: string,
  ): Promise<AuthSessionEntity[]> {
    return this.repository.find({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async updateLastActivity(sessionId: string): Promise<void> {
    await this.repository.update({ sessionId }, { lastActivityAt: new Date() });
  }

  async revokeSession(sessionId: string, reason?: string): Promise<void> {
    await this.repository.update(
      { sessionId },
      {
        isActive: false,
        revokedAt: new Date(),
        revocationReason: reason,
      },
    );
  }

  async revokeUserSessions(userId: string, reason?: string): Promise<void> {
    await this.repository.update(
      { userId, isActive: true },
      {
        isActive: false,
        revokedAt: new Date(),
        revocationReason: reason,
      },
    );
  }

  async deleteExpiredSessions(): Promise<number> {
    const result = await this.repository.delete({
      expiresAt: LessThan(new Date()),
    });
    return result.affected || 0;
  }

  async deleteRevokedSessionsOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.repository.delete({
      revokedAt: LessThan(cutoffDate),
    });
    return result.affected || 0;
  }

  async getSessionStats(userId: string): Promise<{
    activeCount: number;
    totalCount: number;
  }> {
    const [activeCount, totalCount] = await Promise.all([
      this.repository.count({
        where: { userId, isActive: true },
      }),
      this.repository.count({
        where: { userId },
      }),
    ]);

    return { activeCount, totalCount };
  }

  async getAuditLog(
    userId: string,
    limit: number = 50,
  ): Promise<AuthSessionEntity[]> {
    return this.repository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
