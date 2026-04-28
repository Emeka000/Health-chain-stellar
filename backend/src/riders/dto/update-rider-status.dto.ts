import { IsEnum } from 'class-validator';

import { RiderStatus } from '../enums/rider-status.enum';

export class UpdateRiderStatusDto {
  @IsEnum(RiderStatus)
  status: RiderStatus;
}
