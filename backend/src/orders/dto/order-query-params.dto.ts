import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsIn,
  IsDateString,
} from 'class-validator';

export const ORDER_SORTABLE_COLUMNS = [
  'id',
  'placedAt',
  'updatedAt',
  'status',
  'bloodType',
  'quantity',
  'urgency',
] as const;

export type OrderSortableColumn = (typeof ORDER_SORTABLE_COLUMNS)[number];

export class OrderQueryParamsDto {
  @IsString()
  hospitalId: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  bloodTypes?: string; // Comma-separated values

  @IsOptional()
  @IsString()
  statuses?: string; // Comma-separated values

  @IsOptional()
  @IsString()
  bloodBank?: string;

  @IsOptional()
  @IsIn(ORDER_SORTABLE_COLUMNS)
  sortBy?: OrderSortableColumn;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([25, 50, 100])
  pageSize?: number;
}
