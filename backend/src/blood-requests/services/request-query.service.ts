import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

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
  ) {}

  async queryRequests(queryDto: QueryRequestsDto): Promise<{
    data: BloodRequestEntity[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const queryBuilder = this.buildQuery(queryDto);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
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
    const sortField = queryDto.sortBy || SortField.CREATED_AT;
    const sortOrder = queryDto.sortOrder || SortOrder.DESC;
    queryBuilder.orderBy(`request.${sortField}`, sortOrder);

    // Pagination
    queryBuilder.take(queryDto.limit || 20);
    queryBuilder.skip(queryDto.offset || 0);

    return queryBuilder;
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
    const onTimeFulfillments = fulfilledWithTime.filter(
      (r) => r.updatedAt.getTime() <= r.requiredByTimestamp,
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
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
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
      averageFulfillmentTime: Math.round(averageFulfillmentTime * 100) / 100,
      slaComplianceRate: Math.round(slaComplianceRate * 100) / 100,
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

    const totalRequests = requests.length;
    const fulfilledRequests = requests.filter(
      (r) => r.status === BloodRequestStatus.FULFILLED,
    );

    const onTimeFulfillments = fulfilledRequests.filter(
      (r) =>
        r.requiredByTimestamp && r.updatedAt.getTime() <= r.requiredByTimestamp,
    ).length;

    const lateFulfillments = fulfilledRequests.filter(
      (r) =>
        r.requiredByTimestamp && r.updatedAt.getTime() > r.requiredByTimestamp,
    ).length;

    const complianceRate =
      fulfilledRequests.length > 0
        ? (onTimeFulfillments / fulfilledRequests.length) * 100
        : 0;

    // Calculate average delay for late fulfillments
    const lateRequests = fulfilledRequests.filter(
      (r) =>
        r.requiredByTimestamp && r.updatedAt.getTime() > r.requiredByTimestamp,
    );

    let averageDelayHours = 0;
    if (lateRequests.length > 0) {
      const totalDelay = lateRequests.reduce((sum, r) => {
        const delay = r.updatedAt.getTime() - r.requiredByTimestamp;
        return sum + delay;
      }, 0);
      averageDelayHours = totalDelay / lateRequests.length / (1000 * 60 * 60);
    }

    // Requests by status
    const requestsByStatus: Record<string, number> = {};
    requests.forEach((request) => {
      requestsByStatus[request.status] =
        (requestsByStatus[request.status] || 0) + 1;
    });

    return {
      totalRequests,
      onTimeFulfillments,
      lateFulfillments,
      complianceRate: Math.round(complianceRate * 100) / 100,
      averageDelayHours: Math.round(averageDelayHours * 100) / 100,
      requestsByStatus,
    };
  }

  async exportToCSV(queryDto: QueryRequestsDto): Promise<string> {
    const { data } = await this.queryRequests(queryDto);

    const headers = [
      'Request Number',
      'Hospital ID',
      'Status',
      'Required By',
      'Created At',
      'Updated At',
      'Blood Types',
      'Total Quantity (ml)',
      'Notes',
    ];

    const rows = data.map((request) => {
      const bloodTypes =
        request.items?.map((item) => item.bloodType).join(', ') || '';
      const totalQuantity =
        request.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;

      return [
        request.requestNumber,
        request.hospitalId,
        request.status,
        request.requiredByTimestamp
          ? new Date(request.requiredByTimestamp).toISOString()
          : '',
        request.createdAt.toISOString(),
        request.updatedAt.toISOString(),
        bloodTypes,
        totalQuantity.toString(),
        request.notes || '',
      ]
        .map((field) => `"${field}"`)
        .join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  async exportToPDF(queryDto: QueryRequestsDto): Promise<Buffer> {
    // PDF export would require a PDF library like pdfkit or puppeteer
    // For now, return a placeholder
    this.logger.warn('PDF export not yet implemented');
    return Buffer.from('PDF export not yet implemented');
  }
}
