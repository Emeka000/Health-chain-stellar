import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import * as ExcelJS from 'exceljs';

import { UserEntity } from '../users/entities/user.entity';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { DisputeEntity } from '../disputes/entities/dispute.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';
import { PaginationUtil, PaginatedResponse } from '../common/pagination';

import { ReportingQueryDto } from './dto/reporting-query.dto';
import { ReportViewRefreshService, MaterializedViewName, ViewFreshnessInfo } from './report-view-refresh.service';

// ---------------------------------------------------------------------------
// Legacy interface kept for backward compatibility with existing callers
// ---------------------------------------------------------------------------
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

export interface OrderDailySummaryRow {
  reportDate: string;
  status: string;
  orderCount: number;
  totalQuantity: number;
  totalFees: number;
  totalDeliveryFees: number;
  totalPlatformFees: number;
}

export interface BloodUnitInventoryRow {
  bloodType: string;
  status: string;
  unitCount: number;
  totalVolumeMl: number;
  earliestExpiry: Date | null;
  latestIntake: Date | null;
}

export interface ReportSummaryResult {
  donors: number;
  units: number;
  orders: number;
  disputes: number;
  /** ISO timestamp of the oldest materialized view used, or null if live. */
  dataFreshnessAt: string | null;
  /** Whether the summary was served from materialized views. */
  fromMaterialized: boolean;
  /** Per-view freshness details exposed to consumers. */
  viewFreshness?: ViewFreshnessInfo[];
}

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
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
    private readonly refreshService: ReportViewRefreshService,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Multi-domain search with pagination and filter constraints.
   * Uses live queries against indexed operational tables.
   */
  async search(filters: ReportingFilterDto | ReportingQueryDto): Promise<Record<string, unknown>> {
    const domain = filters.domain ?? 'all';
    const results: Record<string, unknown> = {};
    const { page, pageSize } = this.resolvePagination(filters);

    if (domain === 'all' || domain === 'donors') {
      results.donors = await this.queryDonorsPaginated(filters, page, pageSize);
    }
    if (domain === 'all' || domain === 'units') {
      results.units = await this.queryUnitsPaginated(filters, page, pageSize);
    }
    if (domain === 'all' || domain === 'orders') {
      results.orders = await this.queryOrdersPaginated(filters, page, pageSize);
    }
    if (domain === 'all' || domain === 'disputes') {
      results.disputes = await this.queryDisputesPaginated(filters, page, pageSize);
    }
    if (domain === 'all' || domain === 'organizations') {
      results.organizations = await this.queryOrganizationsPaginated(filters, page, pageSize);
    }
    if (domain === 'all' || domain === 'requests') {
      results.requests = await this.queryRequestsPaginated(filters, page, pageSize);
    }

    return results;
  }

  /**
   * High-level summary metrics.
   * Serves from pre-aggregated materialized views when fresh; falls back to
   * live queries and always exposes staleness metadata to the consumer.
   */
  async getSummary(
    filters: ReportingFilterDto | ReportingQueryDto,
    forceLive = false,
  ): Promise<ReportSummaryResult> {
    const useMaterialized =
      !forceLive &&
      (filters as ReportingQueryDto).useMaterialized !== false &&
      !filters.startDate &&
      !filters.endDate &&
      !filters.statusGroups?.length &&
      !filters.bloodType;

    if (useMaterialized) {
      const [orderFresh, unitFresh, disputeFresh] = await Promise.all([
        this.refreshService.isViewFresh('mv_daily_order_summary'),
        this.refreshService.isViewFresh('mv_blood_unit_inventory'),
        this.refreshService.isViewFresh('mv_daily_dispute_summary'),
      ]);

      if (orderFresh && unitFresh && disputeFresh) {
        return this.getSummaryFromMaterialized();
      }
    }

    return this.getSummaryLive(filters);
  }

  /**
   * Pre-aggregated daily order summary from materialized view.
   * Supports optional date range filtering and pagination.
   */
  async getOrderDailySummary(
    startDate?: string,
    endDate?: string,
    page = 1,
    pageSize = 50,
  ): Promise<PaginatedResponse<OrderDailySummaryRow>> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (startDate) {
      params.push(startDate);
      conditions.push('report_date >= $' + params.length);
    }
    if (endDate) {
      params.push(endDate);
      conditions.push('report_date <= $' + params.length);
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const baseSql = [
      'SELECT',
      '  report_date   AS "reportDate",',
      '  status,',
      '  order_count   AS "orderCount",',
      '  total_quantity AS "totalQuantity",',
      '  COALESCE(total_fees, 0)          AS "totalFees",',
      '  COALESCE(total_delivery_fees, 0) AS "totalDeliveryFees",',
      '  COALESCE(total_platform_fees, 0) AS "totalPlatformFees"',
      'FROM mv_daily_order_summary',
      whereClause,
    ].join(' ');

    const countResult = await this.dataSource.query(
      'SELECT COUNT(*) AS total FROM (' + baseSql + ') sub',
      params,
    );
    const total = Number(countResult[0]?.total ?? 0);

    const pageParams = [...params];
    pageParams.push(pageSize);
    const limitIdx = pageParams.length;
    pageParams.push(PaginationUtil.calculateSkip(page, pageSize));
    const offsetIdx = pageParams.length;

    const rows: OrderDailySummaryRow[] = await this.dataSource.query(
      baseSql + ' ORDER BY report_date DESC, status LIMIT $' + limitIdx + ' OFFSET $' + offsetIdx,
      pageParams,
    );

    return PaginationUtil.createResponse(rows, page, pageSize, total);
  }

  /**
   * Blood unit inventory snapshot from materialized view.
   */
  async getBloodUnitInventory(
    bloodType?: string,
    status?: string,
  ): Promise<BloodUnitInventoryRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (bloodType) {
      params.push(bloodType);
      conditions.push('blood_type = $' + params.length);
    }
    if (status) {
      params.push(status);
      conditions.push('status = $' + params.length);
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const sql = [
      'SELECT',
      '  blood_type          AS "bloodType",',
      '  status,',
      '  unit_count          AS "unitCount",',
      '  COALESCE(total_volume_ml, 0) AS "totalVolumeMl",',
      '  earliest_expiry     AS "earliestExpiry",',
      '  latest_intake       AS "latestIntake"',
      'FROM mv_blood_unit_inventory',
      whereClause,
      'ORDER BY blood_type, status',
    ].join(' ');

    return this.dataSource.query(sql, params);
  }

  /** Returns freshness metadata for all materialized views. */
  async getViewFreshness(): Promise<ViewFreshnessInfo[]> {
    return this.refreshService.getFreshnessInfo();
  }

  /** Trigger a manual refresh of a specific view (admin operation). */
  async triggerViewRefresh(viewName: MaterializedViewName) {
    return this.refreshService.refreshView(viewName);
  }

  /** Trigger refresh of all views. */
  async triggerAllViewRefresh() {
    return this.refreshService.refreshAll();
  }

  // ── Excel export ──────────────────────────────────────────────────────────

  async exportToExcel(filters: ReportingFilterDto): Promise<Buffer> {
    // Cap export at 10 000 rows per domain to avoid OOM
    const exportFilters = { ...filters, limit: 10_000, offset: 0 };
    const workbook = new ExcelJS.Workbook();
    const data = await this.search(exportFilters);

    if (data.donors) {
      const sheet = workbook.addWorksheet('Donors');
      sheet.columns = [
        { header: 'ID', key: 'id' },
        { header: 'Email', key: 'email' },
        { header: 'Name', key: 'name' },
        { header: 'Region', key: 'region' },
        { header: 'Created At', key: 'createdAt' },
      ];
      const paged = data.donors as PaginatedResponse<Record<string, unknown>>;
      paged.data.forEach((d) => sheet.addRow(d));
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
      const paged = data.units as PaginatedResponse<Record<string, unknown>>;
      paged.data.forEach((u) => sheet.addRow(u));
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
      const paged = data.orders as PaginatedResponse<Record<string, unknown>>;
      paged.data.forEach((o) => sheet.addRow(o));
    }

    return workbook.xlsx.writeBuffer() as Promise<Buffer>;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private resolvePagination(
    filters: ReportingFilterDto | ReportingQueryDto,
  ): { page: number; pageSize: number } {
    const q = filters as ReportingQueryDto;
    if (q.page !== undefined || q.pageSize !== undefined) {
      return { page: q.page ?? 1, pageSize: q.pageSize ?? 50 };
    }
    // Legacy: derive from limit/offset
    const pageSize = Math.min(filters.limit ?? 50, 200);
    const page = filters.offset ? Math.floor(filters.offset / pageSize) + 1 : 1;
    return { page, pageSize };
  }

  private applyDateFilters(
    query: SelectQueryBuilder<unknown>,
    alias: string,
    filters: ReportingFilterDto | ReportingQueryDto,
  ): void {
    if (filters.startDate && filters.endDate) {
      query.andWhere(alias + '.createdAt BETWEEN :start AND :end', {
        start: new Date(filters.startDate),
        end: new Date(filters.endDate),
      });
    } else if (filters.startDate) {
      query.andWhere(alias + '.createdAt >= :start', {
        start: new Date(filters.startDate),
      });
    } else if (filters.endDate) {
      query.andWhere(alias + '.createdAt <= :end', {
        end: new Date(filters.endDate),
      });
    }
  }

  private async queryDonorsPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<UserEntity>> {
    const query = this.userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.email', 'user.role', 'user.createdAt'])
      .where('user.role = :role', { role: 'donor' });

    this.applyDateFilters(query as unknown as SelectQueryBuilder<unknown>, 'user', filters);

    if (filters.bloodType) {
      query.andWhere("user.profile->>'bloodType' = :bloodType", { bloodType: filters.bloodType });
    }
    if (filters.location) {
      query.andWhere('user.region ILIKE :location', { location: '%' + filters.location + '%' });
    }

    const [items, total] = await query
      .orderBy('user.createdAt', 'DESC')
      .skip(PaginationUtil.calculateSkip(page, pageSize))
      .take(pageSize)
      .getManyAndCount();

    return PaginationUtil.createResponse(items, page, pageSize, total);
  }

  private async queryUnitsPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<BloodUnit>> {
    const query = this.unitRepository.createQueryBuilder('unit');
    this.applyDateFilters(query as unknown as SelectQueryBuilder<unknown>, 'unit', filters);

    if (filters.bloodType) {
      query.andWhere('unit.bloodType = :bloodType', { bloodType: filters.bloodType });
    }
    if (filters.statusGroups?.length) {
      query.andWhere('unit.status IN (:...statuses)', { statuses: filters.statusGroups });
    }

    const [items, total] = await query
      .orderBy('unit.createdAt', 'DESC')
      .skip(PaginationUtil.calculateSkip(page, pageSize))
      .take(pageSize)
      .getManyAndCount();

    return PaginationUtil.createResponse(items, page, pageSize, total);
  }

  private async queryOrdersPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<OrderEntity>> {
    const query = this.orderRepository
      .createQueryBuilder('order')
      .select([
        'order.id',
        'order.hospitalId',
        'order.bloodType',
        'order.quantity',
        'order.status',
        'order.createdAt',
        'order.appliedPolicyId',
      ]);

    this.applyDateFilters(query as unknown as SelectQueryBuilder<unknown>, 'order', filters);

    if (filters.statusGroups?.length) {
      query.andWhere('order.status IN (:...statuses)', { statuses: filters.statusGroups });
    }

    const [items, total] = await query
      .orderBy('order.createdAt', 'DESC')
      .skip(PaginationUtil.calculateSkip(page, pageSize))
      .take(pageSize)
      .getManyAndCount();

    return PaginationUtil.createResponse(items, page, pageSize, total);
  }

  private async queryDisputesPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<DisputeEntity>> {
    const query = this.disputeRepository.createQueryBuilder('dispute');
    this.applyDateFilters(query as unknown as SelectQueryBuilder<unknown>, 'dispute', filters);

    if (filters.statusGroups?.length) {
      query.andWhere('dispute.status IN (:...statuses)', { statuses: filters.statusGroups });
    }

    const [items, total] = await query
      .orderBy('dispute.createdAt', 'DESC')
      .skip(PaginationUtil.calculateSkip(page, pageSize))
      .take(pageSize)
      .getManyAndCount();

    return PaginationUtil.createResponse(items, page, pageSize, total);
  }

  private async queryOrganizationsPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<OrganizationEntity>> {
    const query = this.organizationRepository.createQueryBuilder('org');
    this.applyDateFilters(query as unknown as SelectQueryBuilder<unknown>, 'org', filters);

    if (filters.location) {
      query.andWhere('(org.city ILIKE :loc OR org.country ILIKE :loc)', {
        loc: '%' + filters.location + '%',
      });
    }

    const [items, total] = await query
      .orderBy('org.createdAt', 'DESC')
      .skip(PaginationUtil.calculateSkip(page, pageSize))
      .take(pageSize)
      .getManyAndCount();

    return PaginationUtil.createResponse(items, page, pageSize, total);
  }

  private async queryRequestsPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<BloodRequestEntity>> {
    const query = this.requestRepository.createQueryBuilder('req');
    this.applyDateFilters(query as unknown as SelectQueryBuilder<unknown>, 'req', filters);

    if (filters.bloodType) {
      query.andWhere('req.bloodType = :bloodType', { bloodType: filters.bloodType });
    }
    if (filters.statusGroups?.length) {
      query.andWhere('req.status IN (:...statuses)', { statuses: filters.statusGroups });
    }

    const [items, total] = await query
      .orderBy('req.createdAt', 'DESC')
      .skip(PaginationUtil.calculateSkip(page, pageSize))
      .take(pageSize)
      .getManyAndCount();

    return PaginationUtil.createResponse(items, page, pageSize, total);
  }

  // ── Summary helpers ───────────────────────────────────────────────────────

  private async getSummaryFromMaterialized(): Promise<ReportSummaryResult> {
    const [orderRows, unitRows, disputeRows, freshnessInfo] = await Promise.all([
      this.dataSource.query('SELECT SUM(order_count)::BIGINT AS total FROM mv_daily_order_summary'),
      this.dataSource.query('SELECT SUM(unit_count)::BIGINT AS total FROM mv_blood_unit_inventory'),
      this.dataSource.query('SELECT SUM(dispute_count)::BIGINT AS total FROM mv_daily_dispute_summary'),
      this.refreshService.getFreshnessInfo(),
    ]);

    // Donor count is cheap — always live (no materialized view for users)
    const donorCount = await this.userRepository.count({ where: { role: 'donor' as any } });

    const oldestRefresh = freshnessInfo
      .map((f) => f.lastRefreshed)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    return {
      donors: donorCount,
      units: Number(unitRows[0]?.total ?? 0),
      orders: Number(orderRows[0]?.total ?? 0),
      disputes: Number(disputeRows[0]?.total ?? 0),
      dataFreshnessAt: oldestRefresh?.toISOString() ?? null,
      fromMaterialized: true,
      viewFreshness: freshnessInfo,
    };
  }

  private async getSummaryLive(
    filters: ReportingFilterDto | ReportingQueryDto,
  ): Promise<ReportSummaryResult> {
    const donorQuery = this.userRepository
      .createQueryBuilder('user')
      .where('user.role = :role', { role: 'donor' });
    this.applyDateFilters(donorQuery as unknown as SelectQueryBuilder<unknown>, 'user', filters);

    const unitQuery = this.unitRepository.createQueryBuilder('unit');
    this.applyDateFilters(unitQuery as unknown as SelectQueryBuilder<unknown>, 'unit', filters);

    const orderQuery = this.orderRepository.createQueryBuilder('order');
    this.applyDateFilters(orderQuery as unknown as SelectQueryBuilder<unknown>, 'order', filters);

    const disputeQuery = this.disputeRepository.createQueryBuilder('dispute');
    this.applyDateFilters(disputeQuery as unknown as SelectQueryBuilder<unknown>, 'dispute', filters);

    const [donors, units, orders, disputes] = await Promise.all([
      donorQuery.getCount(),
      unitQuery.getCount(),
      orderQuery.getCount(),
      disputeQuery.getCount(),
    ]);

    return {
      donors,
      units,
      orders,
      disputes,
      dataFreshnessAt: new Date().toISOString(),
      fromMaterialized: false,
    };
  }
}
