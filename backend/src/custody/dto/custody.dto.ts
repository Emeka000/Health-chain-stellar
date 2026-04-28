import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { CustodyActor } from '../enums/custody.enum';

export class RecordHandoffDto {
  @IsString() @IsNotEmpty()
  bloodUnitId: string;

  @IsString() @IsOptional()
  orderId?: string;

  @IsString() @IsNotEmpty()
  fromActorId: string;

  @IsEnum(CustodyActor)
  fromActorType: CustodyActor;

  @IsString() @IsNotEmpty()
  toActorId: string;

  @IsEnum(CustodyActor)
  toActorType: CustodyActor;

  @IsNumber() @IsOptional()
  latitude?: number;

  @IsNumber() @IsOptional()
  longitude?: number;

  @IsString() @IsOptional()
  proofReference?: string;
}

export class ConfirmHandoffDto {
  @IsString() @IsOptional()
  proofReference?: string;
}
