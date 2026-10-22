import { IsEnum } from 'class-validator';
import { PledgeStatus } from '../enums/pledge.enum';

export class UpdatePledgeStatusDto {
  @IsEnum(PledgeStatus, {
    message: 'status must be one of: ACTIVE, PAUSED, COMPLETED',
  })
  status: PledgeStatus;
}
