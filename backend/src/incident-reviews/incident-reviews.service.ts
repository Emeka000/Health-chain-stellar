import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginatedResponse, PaginationUtil } from '../common/pagination';

import { CreateIncidentReviewDto } from './dto/create-incident-review.dto';
import { QueryIncidentReviewDto } from './dto/query-incident-review.dto';
import { UpdateIncidentReviewDto } from './dto/update-incident-review.dto';
import { IncidentReviewEntity } from './entities/incident-review.entity';
import { IncidentReviewStatus } from './enums/incident-review-status.enum';
import { IncidentReviewClosedEvent } from './events/incident-review-closed.event';

export interface IncidentTrendSummary {
  rootCause: string;
  count: number;
  percentage: number;
}

export interface IncidentStatsSummary {
  total: number;
  open: number;
  inReview: number;
  closed: number;
  byRootCause: IncidentTrendSummary[];
  bySeverity: Record<string, number>;
}

@Injectable()
export class IncidentReviewsService {
  private readonly logger = new Logger(IncidentReviewsService.name);

  constructor(
    @InjectRepository(IncidentReviewEntity)
    private readonly reviewRepo: Repository<IncidentReviewEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateIncidentReviewDto,
    reportedByUserId: string,
  ): Promise<IncidentReviewEntity> {
    const review = this.reviewRepo.create({
      ...dto,
      riderId: dto.riderId ?? null,
      hospitalId: dto.hospitalId ?? null,
      bloodBankId: dto.bloodBankId ?? null,
      correctiveAction: dto.correctiveAction ?? null,
      reportedByUserId,
      reviewedByUserId: null,
      resolutionNotes: null,
      affectsScoring: dto.affectsScoring ?? true,
      scoringApplied: false,
      closedAt: null,
      metadata: dto.metadata ?? null,
    });

    const saved = await this.reviewRepo.save(review);
    this.logger.log(
      `Incident review created: ${saved.id} for order ${saved.orderId}`,
    );
    return saved;
  }

  async findAll(
    query: QueryIncidentReviewDto,
  ): Promise<PaginatedResponse<IncidentReviewEntity>> {
    const { page = 1, pageSize = 25 } = query;

    const qb = this.reviewRepo
      .createQueryBuilder('review')
      .orderBy('review.created_at', 'DESC');

    if (query.orderId) {
      qb.andWhere('review.order_id = :orderId', { orderId: query.orderId });
    }
    if (query.riderId) {
      qb.andWhere('review.rider_id = :riderId', { riderId: query.riderId });
    }
    if (query.hospitalId) {
      qb.andWhere('review.hospital_id = :hospitalId', {
        hospitalId: query.hospitalId,
      });
    }
    if (query.bloodBankId) {
      qb.andWhere('review.blood_bank_id = :bloodBankId', {
        bloodBankId: query.bloodBankId,
      });
    }
    if (query.rootCause) {
      qb.andWhere('review.root_cause = :rootCause', {
        rootCause: query.rootCause,
      });
    }
    if (query.severity) {
      qb.andWhere('review.severity = :severity', { severity: query.severity });
    }
    if (query.status) {
      qb.andWhere('review.status = :status', { status: query.status });
    }
    if (query.affectsScoring !== undefined) {
      qb.andWhere('review.affects_scoring = :affectsScoring', {
        affectsScoring: query.affectsScoring,
      });
    }
    if (query.startDate) {
      qb.andWhere('review.created_at >= :startDate', {
        startDate: new Date(query.startDate),
      });
    }
    if (query.endDate) {
      qb.andWhere('review.created_at <= :endDate', {
        endDate: new Date(query.endDate),
      });
    }

    qb.skip(PaginationUtil.calculateSkip(page, pageSize)).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return PaginationUtil.createResponse(data, page, pageSize, total);
  }

  async findOne(id: string): Promise<IncidentReviewEntity> {
    const review = await this.reviewRepo.findOne({ where: { id } });
    if (!review) {
      throw new NotFoundException(`Incident review "${id}" not found`);
    }
    return review;
  }

  async update(
    id: string,
    dto: UpdateIncidentReviewDto,
  ): Promise<IncidentReviewEntity> {
    const review = await this.findOne(id);

    if (
      review.status === IncidentReviewStatus.CLOSED &&
      dto.status !== undefined
    ) {
      throw new BadRequestException('Cannot update a closed incident review');
    }

    const isClosing =
      dto.status === IncidentReviewStatus.CLOSED &&
      review.status !== IncidentReviewStatus.CLOSED;

    Object.assign(review, {
      ...dto,
      closedAt: isClosing ? new Date() : review.closedAt,
    });

    const saved = await this.reviewRepo.save(review);

    if (isClosing) {
      this.eventEmitter.emit(
        'incident.review.closed',
        new IncidentReviewClosedEvent(
          saved.id,
          saved.orderId,
          saved.riderId,
          saved.hospitalId,
          saved.bloodBankId,
          saved.rootCause,
          saved.severity,
          saved.affectsScoring,
          saved.closedAt!,
        ),
      );
      this.logger.log(`Incident review closed: ${saved.id}`);
    }

    return saved;
  }

  async markScoringApplied(id: string): Promise<void> {
    await this.reviewRepo.update(id, { scoringApplied: true });
  }

  async getStats(query: {
    startDate?: string;
    endDate?: string;
    riderId?: string;
    hospitalId?: string;
  }): Promise<IncidentStatsSummary> {
    const qb = this.reviewRepo.createQueryBuilder('review');

    if (query.riderId) {
      qb.andWhere('review.rider_id = :riderId', { riderId: query.riderId });
    }
    if (query.hospitalId) {
      qb.andWhere('review.hospital_id = :hospitalId', {
        hospitalId: query.hospitalId,
      });
    }
    if (query.startDate) {
      qb.andWhere('review.created_at >= :startDate', {
        startDate: new Date(query.startDate),
      });
    }
    if (query.endDate) {
      qb.andWhere('review.created_at <= :endDate', {
        endDate: new Date(query.endDate),
      });
    }

    const all = await qb.getMany();
    const total = all.length;

    const open = all.filter(
      (r) => r.status === IncidentReviewStatus.OPEN,
    ).length;
    const inReview = all.filter(
      (r) => r.status === IncidentReviewStatus.IN_REVIEW,
    ).length;
    const closed = all.filter(
      (r) => r.status === IncidentReviewStatus.CLOSED,
    ).length;

    // Root cause frequency
    const rootCauseMap = new Map<string, number>();
    for (const r of all) {
      rootCauseMap.set(r.rootCause, (rootCauseMap.get(r.rootCause) ?? 0) + 1);
    }
    const byRootCause: IncidentTrendSummary[] = Array.from(
      rootCauseMap.entries(),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([rootCause, count]) => ({
        rootCause,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100 * 10) / 10 : 0,
      }));

    // Severity breakdown
    const bySeverity: Record<string, number> = {};
    for (const r of all) {
      bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    }

    return { total, open, inReview, closed, byRootCause, bySeverity };
  }
}
