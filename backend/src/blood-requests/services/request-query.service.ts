import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Response } from 'express';

import { Repository, SelectQueryBuilder } from 'typeorm';

import {
  QueryRequestsDto,
  SortField,
  SortOrder,
  UrgencyLevel,
} from '../dto/query-requests.dto';
import { BloodRequestItemEntity } from '../entities/blood-request-item.entity';
import { BloodRequestEntity } from '../entities/blood-request.entity';
import { BloodRequestStatus } from '../enums/blood-request-status.enum';
import { ReportExportService } from '../../reporting/services/report-export.service';
import { ReportGeneratorService } from '../../reporting/services/report-generator.service';

export interface RequestStatistics {
  totalRequests: number;
  pendingRequests: number;
  approvedRequests: number;
  fulfilledRequests: number;
  cancelledRequests: number;
  averageFulfillmentTime: number;
  slaComplianceRate: number;
  requestsByBloodType: Record<string, number>;
  requestsByUrgency: Record<string, number>;
  requestsByHospital: Record<string, number>;
}

export interface SLAComplianceReport {
  totalRequests: number;
  onTimeFulfillments: number;
  lateFulfillments: number;
  complianceRate: number;
  averageDelayHours: number;
  requestsByStatus: Record<string, number>;
}

@Injectable()
export class RequestQueryService {
  private readonly logger = new Logger(RequestQueryService.name);

  constructor(
    @InjectRepository(BloodRequestEntity)
    private readonly bloodRequestRepository: Repository<BloodRequestEntity>,
    @InjectRepository(BloodRequestItemEntity)
    private readonly bloodRequestItemRepository: Repository<BloodRequestItemEntity>,
    @Inject(forwardRef(() => ReportExportService))
    private readonly reportExportService: ReportExportService,
    private readonly reportGeneratorService: ReportGeneratorService,
  ) {}

  async queryRequests(queryDto: QueryRequestsDto): Promise<{
    data: BloodRequestEntity[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const queryBuilder = this.buildQuery(queryDto);

    const [data, total] = await queryBuilder.getManyAndCount();
    const sortedData = this.sortRequestsByPriority(
      data,
      queryDto.sortBy || SortField.TRIAGE_SCORE,
      queryDto.sortOrder || SortOrder.DESC,
    );

    return {
      data: sortedData,
      total,
      limit: queryDto.limit || 20,
      offset: queryDto.offset || 0,
    };
  }

  private buildQuery(
    queryDto: QueryRequestsDto,
  ): SelectQueryBuilder<BloodRequestEntity> {
    const queryBuilder =
      this.bloodRequestRepository.createQueryBuilder('request');

    // Join with items for blood type filtering
    queryBuilder.leftJoinAndSelect('request.items', 'items');

    // Status filter
    if (queryDto.status) {
      queryBuilder.andWhere('request.status = :status', {
        status: queryDto.status,
      });
    }

    // Hospital filter
    if (queryDto.hospitalId) {
      queryBuilder.andWhere('request.hospitalId = :hospitalId', {
        hospitalId: queryDto.hospitalId,
      });
    }

    // Blood type filter (via items)
    if (queryDto.bloodType) {
      queryBuilder.andWhere('items.bloodType = :bloodType', {
        bloodType: queryDto.bloodType,
      });
    }

    // Date range filter
    if (queryDto.startDate) {
      queryBuilder.andWhere('request.createdAt >= :startDate', {
        startDate: queryDto.startDate,
      });
    }

    if (queryDto.endDate) {
      queryBuilder.andWhere('request.createdAt <= :endDate', {
        endDate: queryDto.endDate,
      });
    }

    // Text search (search in request number and notes)
    if (queryDto.searchText) {
      queryBuilder.andWhere(
        '(request.requestNumber ILIKE :searchText OR request.notes ILIKE :searchText)',
        { searchText: `%${queryDto.searchText}%` },
      );
    }

    // Urgency filter (would need urgency field in entity)
    // For now, we'll skip this as it's not in the entity

    // Sorting
    const sortField = queryDto.sortBy || SortField.TRIAGE_SCORE;
    const sortOrder = queryDto.sortOrder || SortOrder.DESC;
    if (sortField !== SortField.TRIAGE_SCORE) {
      queryBuilder.orderBy(`request.${sortField}`, sortOrder);
    }

    // Pagination
    queryBuilder.take(queryDto.limit || 20);
    queryBuilder.skip(queryDto.offset || 0);

    return queryBuilder;
  }

  sortRequestsByPriority(
    requests: BloodRequestEntity[],
    sortField: SortField,
    sortOrder: SortOrder,
  ): BloodRequestEntity[] {
    const sorted = [...requests];

    sorted.sort((a, b) => {
      if (sortField === SortField.TRIAGE_SCORE) {
        const scoreDelta = (b.triageScore ?? 0) - (a.triageScore ?? 0);
        if (scoreDelta !== 0) {
          return sortOrder === SortOrder.DESC ? scoreDelta : -scoreDelta;
        }

        const requiredByDelta = a.requiredByTimestamp - b.requiredByTimestamp;
        if (requiredByDelta !== 0) return requiredByDelta;

        const createdDelta = a.createdTimestamp - b.createdTimestamp;
        if (createdDelta !== 0) return createdDelta;

        return a.requestNumber.localeCompare(b.requestNumber);
      }

      const left = (a as any)[sortField];
      const right = (b as any)[sortField];
      const fieldDelta =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : `${left}`.localeCompare(`${right}`);
      return sortOrder === SortOrder.DESC ? -fieldDelta : fieldDelta;
    });

    return sorted;
  }

  async getRequestStatistics(
    hospitalId?: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<RequestStatistics> {
    const queryBuilder =
      this.bloodRequestRepository.createQueryBuilder('request');

    if (hospitalId) {
      queryBuilder.andWhere('request.hospitalId = :hospitalId', { hospitalId });
    }

    if (startDate) {
      queryBuilder.andWhere('request.createdAt >= :startDate', { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere('request.createdAt <= :endDate', { endDate });
    }

    const requests = await queryBuilder.getMany();

    const totalRequests = requests.length;
    const pendingRequests = requests.filter(
      (r) => r.status === BloodRequestStatus.PENDING,
    ).length;
    const approvedRequests = requests.filter(
      (r) => r.status === BloodRequestStatus.APPROVED,
    ).length;
    const fulfilledRequests = requests.filter(
      (r) => r.status === BloodRequestStatus.FULFILLED,
    ).length;
    const cancelledRequests = requests.filter(
      (r) => r.status === BloodRequestStatus.CANCELLED,
    ).length;

    // Calculate average fulfillment time
    const fulfilledWithTime = requests.filter(
      (r) =>
        r.status === BloodRequestStatus.FULFILLED &&
        r.requiredByTimestamp &&
        r.updatedAt,
    );

    let averageFulfillmentTime = 0;
    if (fulfilledWithTime.length > 0) {
      const totalTime = fulfilledWithTime.reduce((sum, r) => {
        const fulfillmentTime = r.updatedAt.getTime() - r.createdAt.getTime();
        return sum + fulfillmentTime;
      }, 0);
      averageFulfillmentTime =
        totalTime / fulfilledWithTime.length / (1000 * 60 * 60); // Convert to hours
    }

    // Calculate SLA compliance rate
    // requiredByTimestamp is stored in Unix seconds, so convert to ms before comparing.
    const onTimeFulfillments = fulfilledWithTime.filter(
      (r) => r.updatedAt.getTime() <= r.requiredByTimestamp * 1000,
    ).length;
    const slaComplianceRate =
      fulfilledWithTime.length > 0
        ? (onTimeFulfillments / fulfilledWithTime.length) * 100
        : 0;

    // Requests by blood type
    const requestsByBloodType: Record<string, number> = {};
    requests.forEach((request) => {
      request.items?.forEach((item) => {
        requestsByBloodType[item.bloodType] =
          (requestsByBloodType[item.bloodType] || 0) + 1;
      });
    });

    // Requests by urgency (would need urgency field)
    const requestsByUrgency: Record<string, number> = {
      [UrgencyLevel.CRITICAL]: 0,
      [UrgencyLevel.HIGH]: 0,
      [UrgencyLevel.MEDIUM]: 0,
      [UrgencyLevel.LOW]: 0,
    };

    // Requests by hospital
    const requestsByHospital: Record<string, number> = {};
    requests.forEach((request) => {
      requestsByHospital[request.hospitalId] =
        (requestsByHospital[request.hospitalId] || 0) + 1;
    });

    return {
      totalRequests,
      pendingRequests,
      approvedRequests,
      fulfilledRequests,
      cancelledRequests,
      averageFulfillmentTime,
      slaComplianceRate,
      requestsByBloodType,
      requestsByUrgency,
      requestsByHospital,
    };
  }

  async getSLAComplianceReport(
    hospitalId?: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<SLAComplianceReport> {
    const queryBuilder =
      this.bloodRequestRepository.createQueryBuilder('request');

    if (hospitalId) {
      queryBuilder.andWhere('request.hospitalId = :hospitalId', { hospitalId });
    }

    if (startDate) {
      queryBuilder.andWhere('request.createdAt >= :startDate', { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere('request.createdAt <= :endDate', { endDate });
    }

    const requests = await queryBuilder.getMany();

    const fulfilled = requests.filter(
      (r) =>
        r.status === BloodRequestStatus.FULFILLED &&
        r.requiredByTimestamp &&
        r.updatedAt,
    );

    // requiredByTimestamp is stored in Unix seconds, so convert to ms before comparing.
    const onTimeFulfillments = fulfilled.filter(
      (r) => r.updatedAt.getTime() <= r.requiredByTimestamp * 1000,
    ).length;
    const lateFulfillments = fulfilled.length - onTimeFulfillments;

    const complianceRate =
      fulfilled.length > 0
        ? (onTimeFulfillments / fulfilled.length) * 100
        : 0;

    let averageDelayHours = 0;
    if (lateFulfillments > 0) {
      const totalDelay = fulfilled
        .filter((r) => r.updatedAt.getTime() > r.requiredByTimestamp * 1000)
        .reduce((sum, r) => {
          const delayMs =
            r.updatedAt.getTime() - r.requiredByTimestamp * 1000;
          return sum + delayMs;
        }, 0);
      averageDelayHours = totalDelay / lateFulfillments / (1000 * 60 * 60);
    }

    const requestsByStatus: Record<string, number> = {};
    requests.forEach((request) => {
      requestsByStatus[request.status] =
        (requestsByStatus[request.status] || 0) + 1;
    });

    return {
      totalRequests: requests.length,
      onTimeFulfillments,
      lateFulfillments,
      complianceRate,
      averageDelayHours,
      requestsByStatus,
    };
  }

  async exportToCSV(
    queryDto: QueryRequestsDto,
    response: Response,
  ): Promise<void> {
    const { data } = await this.queryRequests({ ...queryDto, limit: 10000 });

    const csv = this.reportGeneratorService.generateCSV(data, [
      'requestNumber',
      'status',
      'hospitalId',
      'triageScore',
      'requiredByTimestamp',
      'createdAt',
    ]);

    response.setHeader('Content-Type', 'text/csv');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="blood-requests.csv"',
    );
    response.send(csv);
  }

  async exportToPDF(
    queryDto: QueryRequestsDto,
    response: Response,
  ): Promise<void> {
    const { data } = await this.queryRequests({ ...queryDto, limit: 10000 });

    const pdfBuffer = await this.reportGeneratorService.generatePDF(data, {
      title: 'Blood Requests Report',
      columns: [
        'requestNumber',
        'status',
        'hospitalId',
        'triageScore',
        'requiredByTimestamp',
        'createdAt',
      ],
    });

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="blood-requests.pdf"',
    );
    response.send(pdfBuffer);
  }

  async initiateExport(
    queryDto: QueryRequestsDto,
    format: 'csv' | 'pdf',
  ): Promise<{ exportId: string }> {
    const exportId = await this.reportExportService.createExport({
      type: 'blood-requests',
      format,
      query: queryDto,
    });

    this.logger.log(
      `Initiated ${format} export for blood requests: ${exportId}`,
    );

    return { exportId };
  }
}
