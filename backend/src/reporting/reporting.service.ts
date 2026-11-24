import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import * as ExcelJS from 'exceljs';

import { UserEntity } from '../users/entities/user.entity';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { DisputeEntity } from '../disputes/entities/dispute.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { BloodRequest as BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';
import { PaginationUtil, PaginatedResponse } from '../common/pagination';

import { ReportingQueryDto } from './dto/reporting-query.dto';
import {
  ReportViewRefreshService,
  MaterializedViewName,
  ViewFreshnessInfo,
} from './report-view-refresh.service';

// ---------------------------------------------------------------------------
// Legacy interface kept for backward compatibility with existing callers
// ---------------------------------------------------------------------------
export interface ReportingFilterDto {
  startDate?: string;
  endDate?: string;
  statusGroups?: string[];
  location?: string;
  bloodType?: string;
  domain?:
    | 'donors'
    | 'units'
    | 'orders'
    | 'disputes'
    | 'organizations'
    | 'requests'
    | 'all';
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
  async search(
    filters: ReportingFilterDto | ReportingQueryDto,
    actor?: { role?: string; organizationId?: string | null },
  ): Promise<Record<string, unknown>> {
    const domain = filters.domain ?? 'all';
    const results: Record<string, unknown> = {};
    const { page, pageSize } = this.resolvePagination(filters);

    if (domain === 'all' || domain === 'donors') {
      results.donors = await this.queryDonorsPaginated(
        filters,
        page,
        pageSize,
        actor,
      );
    }
    if (domain === 'all' || domain === 'units') {
      results.units = await this.queryUnitsPaginated(
        filters,
        page,
        pageSize,
        actor,
      );
    }
    if (domain === 'all' || domain === 'orders') {
      results.orders = await this.queryOrdersPaginated(
        filters,
        page,
        pageSize,
        actor,
      );
    }
    if (domain === 'all' || domain === 'disputes') {
      results.disputes = await this.queryDisputesPaginated(
        filters,
        page,
        pageSize,
        actor,
      );
    }
    if (domain === 'all' || domain === 'organizations') {
      results.organizations = await this.queryOrganizationsPaginated(
        filters,
        page,
        pageSize,
        actor,
      );
    }
    if (domain === 'all' || domain === 'requests') {
      results.requests = await this.queryRequestsPaginated(
        filters,
        page,
        pageSize,
        actor,
      );
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
    actor?: { role?: string; organizationId?: string | null },
  ): Promise<ReportSummaryResult> {
    const useMaterialized =
      !this.isScopedActor(actor) &&
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

    return this.getSummaryLive(filters, actor);
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
    actor?: { role?: string; organizationId?: string | null },
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

    if (this.isScopedActor(actor)) {
      conditions.push('hospital_id = $' + (params.length + 1));
      params.push(actor.organizationId);
    }

    const whereClause = conditions.length
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

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
      baseSql +
        ' ORDER BY report_date DESC, status LIMIT $' +
        limitIdx +
        ' OFFSET $' +
        offsetIdx,
      pageParams,
    );

    return PaginationUtil.createResponse(rows, total, page, pageSize);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private isScopedActor(actor?: {
    role?: string;
    organizationId?: string | null;
  }): actor is { role?: string; organizationId: string } {
    return Boolean(actor?.organizationId);
  }

  private resolvePagination(filters: {
    limit?: number;
    offset?: number;
    page?: number;
    pageSize?: number;
  }): { page: number; pageSize: number } {
    if (filters.page !== undefined || filters.pageSize !== undefined) {
      return {
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 50,
      };
    }
    const pageSize = filters.limit ?? 50;
    const page = Math.floor((filters.offset ?? 0) / pageSize) + 1;
    return { page, pageSize };
  }

  private async queryDonorsPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
    actor?: { role?: string; organizationId?: string | null },
  ): Promise<PaginatedResponse<unknown>> {
    const qb = this.userRepository.createQueryBuilder('user');
    this.applyDateRange(qb, 'user', 'createdAt', filters);
    this.applyStatusGroups(qb, 'user', filters);
    this.applyLocation(qb, 'user', filters);
    this.applyBloodType(qb, 'user', filters);
    this.applyActorScope(qb, 'user', actor);
    return this.paginate(qb, page, pageSize);
  }

  private async queryUnitsPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
    actor?: { role?: string; organizationId?: string | null },
  ): Promise<PaginatedResponse<unknown>> {
    const qb = this.unitRepository.createQueryBuilder('unit');
    this.applyDateRange(qb, 'unit', 'createdAt', filters);
    this.applyStatusGroups(qb, 'unit', filters);
    this.applyLocation(qb, 'unit', filters);
    this.applyBloodType(qb, 'unit', filters);
    this.applyActorScope(qb, 'unit', actor);
    return this.paginate(qb, page, pageSize);
  }

  private async queryOrdersPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
    actor?: { role?: string; organizationId?: string | null },
  ): Promise<PaginatedResponse<unknown>> {
    const qb = this.orderRepository.createQueryBuilder('order');
    this.applyDateRange(qb, 'order', 'createdAt', filters);
    this.applyStatusGroups(qb, 'order', filters);
    this.applyLocation(qb, 'order', filters);
    this.applyBloodType(qb, 'order', filters);
    this.applyActorScope(qb, 'order', actor);
    return this.paginate(qb, page, pageSize);
  }

  private async queryDisputesPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
    actor?: { role?: string; organizationId?: string | null },
  ): Promise<PaginatedResponse<unknown>> {
    const qb = this.disputeRepository.createQueryBuilder('dispute');
    this.applyDateRange(qb, 'dispute', 'createdAt', filters);
    this.applyStatusGroups(qb, 'dispute', filters);
    this.applyActorScope(qb, 'dispute', actor);
    return this.paginate(qb, page, pageSize);
  }

  private async queryOrganizationsPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
    actor?: { role?: string; organizationId?: string | null },
  ): Promise<PaginatedResponse<unknown>> {
    const qb = this.organizationRepository.createQueryBuilder('organization');
    this.applyDateRange(qb, 'organization', 'createdAt', filters);
    this.applyStatusGroups(qb, 'organization', filters);
    this.applyLocation(qb, 'organization', filters);
    this.applyActorScope(qb, 'organization', actor);
    return this.paginate(qb, page, pageSize);
  }

  private async queryRequestsPaginated(
    filters: ReportingFilterDto | ReportingQueryDto,
    page: number,
    pageSize: number,
    actor?: { role?: string; organizationId?: string | null },
  ): Promise<PaginatedResponse<unknown>> {
    const qb = this.requestRepository.createQueryBuilder('request');
    this.applyDateRange(qb, 'request', 'createdAt', filters);
    this.applyStatusGroups(qb, 'request', filters);
    this.applyLocation(qb, 'request', filters);
    this.applyBloodType(qb, 'request', filters);
    this.applyActorScope(qb, 'request', actor);
    return this.paginate(qb, page, pageSize);
  }

  private applyDateRange(
    qb: SelectQueryBuilder<unknown>,
    alias: string,
    column: string,
    filters: ReportingFilterDto | ReportingQueryDto,
  ): void {
    if (filters.startDate) {
      qb.andWhere(`${alias}.${column} >= :startDate`, {
        startDate: filters.startDate,
      });
    }
    if (filters.endDate) {
      qb.andWhere(`${alias}.${column} <= :endDate`, {
        endDate: filters.endDate,
      });
    }
  }

  private applyStatusGroups(
    qb: SelectQueryBuilder<unknown>,
    alias: string,
    filters: ReportingFilterDto | ReportingQueryDto,
  ): void {
    if (filters.statusGroups?.length) {
      qb.andWhere(`${alias}.status IN (:...statusGroups)`, {
        statusGroups: filters.statusGroups,
      });
    }
  }

  private applyLocation(
    qb: SelectQueryBuilder<unknown>,
    alias: string,
    filters: ReportingFilterDto | ReportingQueryDto,
  ): void {
    if (filters.location) {
      qb.andWhere(`${alias}.location = :location`, {
        location: filters.location,
      });
    }
  }

  private applyBloodType(
    qb: SelectQueryBuilder<unknown>,
    alias: string,
    filters: ReportingFilterDto | ReportingQueryDto,
  ): void {
    if (filters.bloodType) {
      qb.andWhere(`${alias}.bloodType = :bloodType`, {
        bloodType: filters.bloodType,
      });
    }
  }

  private applyActorScope(
    qb: SelectQueryBuilder<unknown>,
    alias: string,
    actor?: { role?: string; organizationId?: string | null },
  ): void {
    if (this.isScopedActor(actor)) {
      qb.andWhere(`${alias}.organizationId = :organizationId`, {
        organizationId: actor.organizationId,
      });
    }
  }

  private async paginate(
    qb: SelectQueryBuilder<unknown>,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<unknown>> {
    const skip = PaginationUtil.calculateSkip(page, pageSize);
    const [items, total] = await qb.skip(skip).take(pageSize).getManyAndCount();
    return PaginationUtil.createResponse(items, total, page, pageSize);
  }

  private async getSummaryFromMaterialized(): Promise<ReportSummaryResult> {
    const [orderRows, unitRows, disputeRows] = await Promise.all([
      this.dataSource.query(
        'SELECT COALESCE(SUM(order_count), 0) AS total FROM mv_daily_order_summary',
      ),
      this.dataSource.query(
        'SELECT COALESCE(SUM(unit_count), 0) AS total FROM mv_blood_unit_inventory',
      ),
      this.dataSource.query(
        'SELECT COALESCE(SUM(dispute_count), 0) AS total FROM mv_daily_dispute_summary',
      ),
    ]);

    const freshness = await this.refreshService.getViewFreshness([
      'mv_daily_order_summary',
      'mv_blood_unit_inventory',
      'mv_daily_dispute_summary',
    ]);

    const oldest = freshness.reduce<Date | null>((acc, info) => {
      if (!info.lastRefreshedAt) return acc;
      if (!acc || info.lastRefreshedAt < acc) return info.lastRefreshedAt;
      return acc;
    }, null);

    return {
      donors: 0,
      units: Number(unitRows[0]?.total ?? 0),
      orders: Number(orderRows[0]?.total ?? 0),
      disputes: Number(disputeRows[0]?.total ?? 0),
      dataFreshnessAt: oldest ? oldest.toISOString() : null,
      fromMaterialized: true,
      viewFreshness: freshness,
    };
  }

  private async getSummaryLive(
    filters: ReportingFilterDto | ReportingQueryDto,
    actor?: { role?: string; organizationId?: string | null },
  ): Promise<ReportSummaryResult> {
    const [donors, units, orders, disputes] = await Promise.all([
      this.queryDonorsPaginated(filters, 1, 1, actor).then((r) => r.total),
      this.queryUnitsPaginated(filters, 1, 1, actor).then((r) => r.total),
      this.queryOrdersPaginated(filters, 1, 1, actor).then((r) => r.total),
      this.queryDisputesPaginated(filters, 1, 1, actor).then((r) => r.total),
    ]);

    return {
      donors,
      units,
      orders,
      disputes,
      dataFreshnessAt: null,
      fromMaterialized: false,
    };
  }

  /**
   * Export a report to an Excel buffer.
   */
  async exportToExcel(
    rows: Record<string, unknown>[],
    sheetName = 'Report',
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);

    if (rows.length > 0) {
      const columns = Object.keys(rows[0]).map((key) => ({
        header: key,
        key,
        width: 20,
      }));
      sheet.columns = columns;
      rows.forEach((row) => sheet.addRow(row));
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Refresh all reporting materialized views.
   */
  async refreshMaterializedViews(
    views?: MaterializedViewName[],
  ): Promise<ViewFreshnessInfo[]> {
    await this.refreshService.refreshViews(views);
    return this.refreshService.getViewFreshness(views);
  }
}
