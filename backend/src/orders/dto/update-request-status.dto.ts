import {
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { OrderStatus } from '../enums/order-status.enum';
import { RequestStatusAction } from '../enums/request-status-action.enum';

export class UpdateRequestStatusDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(RequestStatusAction)
  action?: RequestStatusAction;

  @ValidateIf(
    (dto: UpdateRequestStatusDto) => dto.action === RequestStatusAction.REJECT,
  )
  @IsString()
  @MinLength(3)
  reason?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
