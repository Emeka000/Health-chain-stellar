import {
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  IsInt,
  Min,
  Max,
  IsDateString,
  IsIn,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export type ReportDomain =
  | 'donors'
  | 'units'
  | 'orders'
  | 'disputes'
  | 'organizations'
  | 'requests'
  | 'all';

export class ReportingQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  /**
   * Filter by one or more status values.
   * Accepts comma-separated string or repeated query params.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [],
  )
  statusGroups?: string[];

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  bloodType?: string;

  @IsOptional()
  @IsIn(['donors', 'units', 'orders', 'disputes', 'organizations', 'requests', 'all'])
  domain?: ReportDomain;

  /** Page number (1-based). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** Number of records per page. Capped at 200 to prevent runaway queries. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;

  /**
   * @deprecated Use page/pageSize instead.
   * Kept for backward compatibility; ignored when page/pageSize are present.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  limit?: number;

  /**
   * When true, the endpoint will use pre-aggregated materialized views
   * instead of live queries. Defaults to true for summary endpoints.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  useMaterialized?: boolean = true;
}

export class ReportSummaryQueryDto extends ReportingQueryDto {
  /** Force a live query even if materialized data is available. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  forceLive?: boolean = false;
}
