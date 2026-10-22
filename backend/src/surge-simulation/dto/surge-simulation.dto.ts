import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  IsObject,
} from 'class-validator';

export class SurgeSimulationRequestDto {
  @ApiProperty({
    description: 'Additional blood units demanded in the surge scenario',
    example: 500,
  })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  surgeDemandUnits!: number;

  @ApiPropertyOptional({
    description:
      'Override total stock (sum of inventory rows). When omitted, uses database totals.',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  overrideStockUnits?: number;

  @ApiPropertyOptional({
    description:
      'Override concurrent rider delivery capacity (units). When omitted, derived from active riders.',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  overrideRiderCapacityUnits?: number;

  @ApiPropertyOptional({
    description: 'Assumed blood units one rider can carry per run (default 4)',
    default: 4,
  })
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(32)
  unitsPerRider?: number;
}

export class CreateScenarioDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  surgeDemandUnits: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  overrideStockUnits?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  overrideRiderCapacityUnits?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(32)
  unitsPerRider?: number;

  /** Random seed for deterministic replay. Auto-generated if omitted. */
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  seed?: number;

  /** Policy toggles: triage/allocation strategies */
  @IsOptional()
  @IsObject()
  policyConfig?: Record<string, unknown>;
}

export class CompareScenarioDto {
  @IsString({ each: true })
  scenarioIds: string[];
}
