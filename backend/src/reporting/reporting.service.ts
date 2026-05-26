import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, Between, In } from 'typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { DisputeEntity } from '../disputes/entities/dispute.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';
import * as ExcelJS from 'exceljs';

export interface ReportingFilterDto {
  startDate?: string;
  endDate?: string;
  statusGroups?: string[];
  location?: string;
  bloodType?: string;
  domain?: 'donors' | 'units' | 'orders' | 'disputes' | 'organizations' | 'requests' | 'all';
  limit?: number;
  offset?: number;
}

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(BloodUnit)
    private readonly unitRepository: Repository<BloodUnit>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(DisputeEntity)
    private readonly disputeRepository: Repository<DisputeEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizationRepository: Repository<OrganizationEntity>,
    @InjectRepository(BloodRequestEntity)
    private readonly requestRepository: Repository<BloodRequestEntity>,
  ) {}

  async search(filters: ReportingFilterDto) {
    const domain = filters.domain || 'all';
    const results: any = {};

    if (domain === 'all' || domain === 'donors') {
      results.donors = await this.queryDonors(filters);
    }
    if (domain === 'all' || domain === 'units') {
      results.units = await this.queryUnits(filters);
    }
    if (domain === 'all' || domain === 'orders') {
      results.orders = await this.queryOrders(filters);
    }
    if (domain === 'all' || domain === 'disputes') {
      results.disputes = await this.queryDisputes(filters);
    }
    if (domain === 'all' || domain === 'organizations') {
      results.organizations = await this.queryOrganizations(filters);
    }
    if (domain === 'all' || domain === 'requests') {
      results.requests = await this.queryRequests(filters);
    }

    return results;
  }

  private async queryDonors(filters: ReportingFilterDto) {
    const query = this.userRepository.createQueryBuilder('user');
    query.where('user.role = :role', { role: 'donor' });
    this.applyCommonFilters(query, 'user', filters);
    if (filters.bloodType) {
      query.andWhere("user.profile->>'bloodType' = :bloodType", { bloodType: filters.bloodType });
    }
    if (filters.location) {
      query.andWhere('user.region ILIKE :location', { location: `%${filters.location}%` });
    }
    return query.take(filters.limit || 50).skip(filters.offset || 0).getManyAndCount();
  }

  private async queryUnits(filters: ReportingFilterDto) {
    const query = this.unitRepository.createQueryBuilder('unit');
    this.applyCommonFilters(query, 'unit', filters);
    if (filters.bloodType) {
      query.andWhere('unit.bloodType = :bloodType', { bloodType: filters.bloodType });
    }
    if (filters.statusGroups && filters.statusGroups.length > 0) {
      query.andWhere('unit.status IN (:...statuses)', { statuses: filters.statusGroups });
    }
    return query.take(filters.limit || 50).skip(filters.offset || 0).getManyAndCount();
  }

  private async queryOrders(filters: ReportingFilterDto) {
    const query = this.orderRepository.createQueryBuilder('order');
    this.applyCommonFilters(query, 'order', filters);
    if (filters.statusGroups && filters.statusGroups.length > 0) {
      query.andWhere('order.status IN (:...statuses)', { statuses: filters.statusGroups });
    }
    return query.take(filters.limit || 50).skip(filters.offset || 0).getManyAndCount();
  }

  private async queryDisputes(filters: ReportingFilterDto) {
    const query = this.disputeRepository.createQueryBuilder('dispute');
    this.applyCommonFilters(query, 'dispute', filters);
    if (filters.statusGroups && filters.statusGroups.length > 0) {
      query.andWhere('dispute.status IN (:...statuses)', { statuses: filters.statusGroups });
    }
    return query.take(filters.limit || 50).skip(filters.offset || 0).getManyAndCount();
  }

  private async queryOrganizations(filters: ReportingFilterDto) {
    const query = this.organizationRepository.createQueryBuilder('org');
    this.applyCommonFilters(query, 'org', filters);
    if (filters.location) {
      query.andWhere('(org.city ILIKE :loc OR org.country ILIKE :loc)', { loc: `%${filters.location}%` });
    }
    return query.take(filters.limit || 50).skip(filters.offset || 0).getManyAndCount();
  }

  private async queryRequests(filters: ReportingFilterDto) {
    const query = this.requestRepository.createQueryBuilder('req');
    this.applyCommonFilters(query, 'req', filters);
    if (filters.bloodType) {
      query.andWhere('req.bloodType = :bloodType', { bloodType: filters.bloodType });
    }
    if (filters.statusGroups && filters.statusGroups.length > 0) {
      query.andWhere('req.status IN (:...statuses)', { statuses: filters.statusGroups });
    }
    return query.take(filters.limit || 50).skip(filters.offset || 0).getManyAndCount();
  }

  private applyCommonFilters(query: SelectQueryBuilder<any>, alias: string, filters: ReportingFilterDto) {
    if (filters.startDate && filters.endDate) {
      query.andWhere(`${alias}.createdAt BETWEEN :start AND :end`, {
        start: new Date(filters.startDate),
        end: new Date(filters.endDate),
      });
    } else if (filters.startDate) {
      query.andWhere(`${alias}.createdAt >= :start`, { start: new Date(filters.startDate) });
    } else if (filters.endDate) {
      query.andWhere(`${alias}.createdAt <= :end`, { end: new Date(filters.endDate) });
    }
  }

  async getSummary(filters: ReportingFilterDto) {
    // Generate high-level metrics
    const [donorCount] = await this.queryDonors({ ...filters, limit: 0 });
    const [unitCount] = await this.queryUnits({ ...filters, limit: 0 });
    const [orderCount] = await this.queryOrders({ ...filters, limit: 0 });
    const [disputeCount] = await this.queryDisputes({ ...filters, limit: 0 });

    return {
      donors: donorCount[1],
      units: unitCount[1],
      orders: orderCount[1],
      disputes: disputeCount[1],
    };
  }

  async exportToExcel(filters: ReportingFilterDto): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const data = await this.search({ ...filters, limit: 10000 }); // Large limit for export

    if (data.donors) {
      const sheet = workbook.addWorksheet('Donors');
      sheet.columns = [
        { header: 'ID', key: 'id' },
        { header: 'Email', key: 'email' },
        { header: 'Name', key: 'name' },
        { header: 'Region', key: 'region' },
        { header: 'Created At', key: 'createdAt' },
      ];
      data.donors[0].forEach((d: any) => sheet.addRow(d));
    }

    if (data.units) {
      const sheet = workbook.addWorksheet('Units');
      sheet.columns = [
        { header: 'Unit Code', key: 'unitCode' },
        { header: 'Blood Type', key: 'bloodType' },
        { header: 'Status', key: 'status' },
        { header: 'Volume (ml)', key: 'volumeMl' },
        { header: 'Expires At', key: 'expiresAt' },
      ];
      data.units[0].forEach((u: any) => sheet.addRow(u));
    }

    if (data.orders) {
      const sheet = workbook.addWorksheet('Orders');
      sheet.columns = [
        { header: 'ID', key: 'id' },
        { header: 'Hospital ID', key: 'hospitalId' },
        { header: 'Blood Type', key: 'bloodType' },
        { header: 'Quantity', key: 'quantity' },
        { header: 'Status', key: 'status' },
      ];
      data.orders[0].forEach((o: any) => sheet.addRow(o));
    }

    return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }
}
