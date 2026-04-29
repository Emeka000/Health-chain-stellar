import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ArrayNotEmpty,
} from 'class-validator';

export class CreateDeliveryProofDto {
  @IsNumber()
  @Type(() => Number)
  deliveryId: number;

  @IsString()
  orderId: string;

  @IsString()
  requestId: string;

  @IsString()
  riderId: string;

  @IsDateString()
  pickupTimestamp: string;

  @IsOptional()
  @IsString()
  pickupLocationHash?: string;

  @IsDateString()
  deliveredAt: string;

  @IsOptional()
  @IsString()
  deliveryLocationHash?: string;

  @IsString()
  recipientName: string;

  @IsOptional()
  @IsString()
  recipientSignatureUrl?: string;

  @IsOptional()
  @IsString()
  recipientSignatureHash?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoHashes?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  @Type(() => Number)
  temperatureReadings: number[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  temperatureCelsius?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsString()
  signerKeyId: string;

  @IsString()
  signerPublicKey: string;

  @IsString()
  signerRole: string;

  @IsDateString()
  signedAt: string;

  @IsString()
  signature: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  evidenceDigestReferences: string[];

  @IsOptional()
  @IsString()
  externalTimestampAnchorHash?: string;
}
