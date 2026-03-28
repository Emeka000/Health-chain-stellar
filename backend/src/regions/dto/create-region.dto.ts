import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateRegionDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 20)
  code: string;

  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsString()
  @Length(2, 10)
  countryCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  radiusKm?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
