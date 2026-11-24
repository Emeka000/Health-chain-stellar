import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { BloodType } from '../../blood-requests/entities/blood-request.entity';
import { UrgencyLevel } from '../../blood-requests/enums/urgency-level.enum';
import { MatchingRequest } from '../interfaces/matching-request.interface';

export class MatchRequestDto implements MatchingRequest {
  @ApiProperty({ enum: BloodType, description: 'Blood type required' })
  @IsEnum(BloodType)
  bloodType: BloodType;

  @ApiProperty({ enum: UrgencyLevel, description: 'Urgency level of the request' })
  @IsEnum(UrgencyLevel)
  urgency: UrgencyLevel;

  @ApiProperty({ description: 'Quantity required in millilitres', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantityMl: number;

  @ApiProperty({ description: 'Optional hospital or facility identifier', required: false })
  @IsOptional()
  @IsString()
  hospitalId?: string;
}
