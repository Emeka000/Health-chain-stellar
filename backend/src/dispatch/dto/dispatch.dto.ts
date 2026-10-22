import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateDispatchDto {
  @IsUUID()
  @IsNotEmpty()
  orderId: string;

  @IsUUID()
  @IsOptional()
  riderId?: string;
}

export class UpdateDispatchDto {
  @IsUUID()
  @IsOptional()
  riderId?: string;
}

export class CancelDispatchDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
