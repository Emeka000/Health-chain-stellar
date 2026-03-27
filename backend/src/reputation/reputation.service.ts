import { Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { OrderDeliveredEvent } from '../events/order-delivered.event';
import { OrderDisputedEvent } from '../events/order-disputed.event';
import { RiderEntity } from '../riders/entities/rider.entity';

import {
  LeaderboardQueryDto,
  ReputationHistoryQueryDto,
} from './dto/reputation-query.dto';
import { ReputationHistoryEntity } from './entities/reputation-history.entity';
import { ReputationEntity } from './entities/reputation.entity';
import { BadgeType } from './enums/badge-type.enum';
import { ReputationEventType } from './enums/reputation-event-type.enum';

const POINTS = {
  [ReputationEventType.DELIVERY_COMPLETED]: 10,
  [ReputationEventType.DELIVERY_CANCELLED]: -5,
  [ReputationEventType.DELIVERY_FAILED]: -8,
  [ReputationEventType.DISPUTE_RAISED]: -15,
  [ReputationEventType.DISPUTE_RESOLVED]: 5,
  [ReputationEventType.BADGE_EARNED]: 0,
};

@Injectable()
export class ReputationService {
  constructor(
    @InjectRepository(ReputationEntity)
    private readonly reputationRepo: Repository<ReputationEntity>,
    @InjectRepository(ReputationHistoryEntity)
    private readonly historyRepo: Repository<ReputationHistoryEntity>,
    @InjectRepository(RiderEntity)
    private readonly riderRepo: Repository<RiderEntity>,
  ) {}

  // ── Public query methods ──────────────────────────────────────────────

  async getReputation(riderId: string) {
    const rep = await this.reputationRepo.findOne({
      where: { riderId },
      relations: ['rider', 'rider.user'],
    });
    if (!rep)
      throw new NotFoundException(
        `Reputation for rider '${riderId}' not found`,
      );
    return { message: 'Reputation retrieved successfully', data: rep };
  }

  async getLeaderboard(query: LeaderboardQueryDto) {
    const { page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const [items, total] = await this.reputationRepo.findAndCount({
      order: { reputationScore: 'DESC' },
      relations: ['rider', 'rider.user'],
      skip,
      take: limit,
    });

    const ranked = items.map((rep, index) => ({
      ...rep,
      rank: skip + index + 1,
    }));

    return {
      message: 'Leaderboard retrieved successfully',
      data: ranked,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getBadges(riderId: string) {
    const rep = await this.reputationRepo.findOne({ where: { riderId } });
    if (!rep)
      throw new NotFoundException(
        `Reputation for rider '${riderId}' not found`,
      );
    return { message: 'Badges retrieved successfully', data: rep.badges };
  }

  async getHistory(riderId: string, query: ReputationHistoryQueryDto) {
    const { type, page = 1, limit = 20 } = query;
    const rep = await this.reputationRepo.findOne({ where: { riderId } });
    if (!rep)
      throw new NotFoundException(
        `Reputation for rider '${riderId}' not found`,
      );

    const where: Record<string, unknown> = { reputationId: rep.id };
    if (type) where.eventType = type;

    const skip = (page - 1) * limit;
    const [items, total] = await this.historyRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      message: 'Reputation history retrieved successfully',
      data: items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getRank(riderId: string) {
    const rep = await this.reputationRepo.findOne({ where: { riderId } });
    if (!rep)
      throw new NotFoundException(
        `Reputation for rider '${riderId}' not found`,
      );

    const rank = await this.reputationRepo
      .createQueryBuilder('r')
      .where('r.reputationScore > :score', { score: rep.reputationScore })
      .getCount();

    return {
      message: 'Rank retrieved successfully',
      data: { riderId, reputationScore: rep.reputationScore, rank: rank + 1 },
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  private async getOrCreate(riderId: string): Promise<ReputationEntity> {
    let rep = await this.reputationRepo.findOne({ where: { riderId } });
    if (!rep) {
      rep = this.reputationRepo.create({
        riderId,
        reputationScore: 0,
        badges: [],
      });
      rep = await this.reputationRepo.save(rep);
    }
    return rep;
  }

  private async applyPoints(
    riderId: string,
    eventType: ReputationEventType,
    referenceId?: string,
    note?: string,
  ) {
    const rep = await this.getOrCreate(riderId);
    const delta = POINTS[eventType] ?? 0;
    rep.reputationScore = Math.max(0, rep.reputationScore + delta);
    await this.reputationRepo.save(rep);

    await this.historyRepo.save(
      this.historyRepo.create({
        reputationId: rep.id,
        eventType,
        pointsDelta: delta,
        scoreAfter: rep.reputationScore,
        referenceId,
        note,
      }),
    );

    await this.checkAndAwardBadges(rep);
  }

  private async checkAndAwardBadges(rep: ReputationEntity) {
    const rider = await this.riderRepo.findOne({ where: { id: rep.riderId } });
    if (!rider) return;

    const earned: BadgeType[] = [...(rep.badges ?? [])];
    const add = (b: BadgeType) => {
      if (!earned.includes(b)) earned.push(b);
    };

    if (rider.completedDeliveries >= 1) add(BadgeType.FIRST_DELIVERY);
    if (rider.completedDeliveries >= 100) add(BadgeType.CENTURY_CLUB);
    if (rider.completedDeliveries >= 500) add(BadgeType.VETERAN);
    if (rider.rating >= 4.8) add(BadgeType.TOP_RATED);
    if (rep.reputationScore >= 200) add(BadgeType.RELIABLE);
    if (rep.reputationScore >= 500) add(BadgeType.SPEED_DEMON);

    if (earned.length !== rep.badges.length) {
      rep.badges = earned;
      await this.reputationRepo.save(rep);
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────

  @OnEvent('order.delivered')
  async onOrderDelivered(event: OrderDeliveredEvent) {
    // orderId used as referenceId; rider lookup via orders would be ideal,
    // but we update via rider-assignment service which tracks riderId separately.
    // For now we record the event — the dispatch service can call applyPoints directly.
    void event; // handled via recordDelivery() called by dispatch
  }

  @OnEvent('order.disputed')
  async onOrderDisputed(event: OrderDisputedEvent) {
    void event;
  }

  /** Called by dispatch/rider services after a delivery outcome is known */
  async recordDelivery(
    riderId: string,
    orderId: string,
    outcome: 'completed' | 'cancelled' | 'failed',
  ) {
    const typeMap = {
      completed: ReputationEventType.DELIVERY_COMPLETED,
      cancelled: ReputationEventType.DELIVERY_CANCELLED,
      failed: ReputationEventType.DELIVERY_FAILED,
    };
    await this.applyPoints(riderId, typeMap[outcome], orderId);
  }

  async recordDispute(riderId: string, disputeId: string, resolved: boolean) {
    const eventType = resolved
      ? ReputationEventType.DISPUTE_RESOLVED
      : ReputationEventType.DISPUTE_RAISED;
    await this.applyPoints(riderId, eventType, disputeId);
  }
}
