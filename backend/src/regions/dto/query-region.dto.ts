import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryRegionDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
