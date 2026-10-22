import { IsString, Matches } from 'class-validator';

export class ConfirmDonationDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'transactionHash must be a valid 64-character hex string',
  })
  transactionHash: string;
}
