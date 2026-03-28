import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AnomalyIncidentEntity } from './entities/anomaly-incident.entity';
import { QueryAnomaliesDto } from './dto/query-anomalies.dto';
import { ReviewAnomalyDto } from './dto/review-anomaly.dto';

@Injectable()
export class AnomalyService {
  constructor(
    @InjectRepository(AnomalyIncidentEntity)
    private readonly repo: Repository<AnomalyIncidentEntity>,
  ) {}

  async findAll(query: QueryAnomaliesDto) {
    const { type, severity, status, page = 1, pageSize = 25 } = query;

    const qb = this.repo.createQueryBuilder('a').orderBy('a.created_at', 'DESC');

    if (type) qb.andWhere('a.type = :type', { type });
    if (severity) qb.andWhere('a.severity = :severity', { severity });
    if (status) qb.andWhere('a.status = :status', { status });

    const [data, totalCount] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      data,
      pagination: {
        currentPage: page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    };
  }

  async findOne(id: string): Promise<AnomalyIncidentEntity> {
    const incident = await this.repo.findOne({ where: { id } });
    if (!incident) throw new NotFoundException(`Anomaly ${id} not found`);
    return incident;
  }

  async review(
    id: string,
    dto: ReviewAnomalyDto,
    reviewedBy: string,
  ): Promise<AnomalyIncidentEntity> {
    const incident = await this.findOne(id);
    await this.repo.update(id, {
      status: dto.status,
      reviewNotes: dto.reviewNotes ?? null,
      reviewedBy,
    });
    return { ...incident, ...dto, reviewedBy };
  }
}
