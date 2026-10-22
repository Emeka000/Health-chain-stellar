import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
} from 'class-validator';
import { DonationAsset } from '../enums/donation.enum';

export class CreateDonationDto {
  @IsNumber()
  @IsPositive({ message: 'amount must be a positive number' })
  amount: number;

  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'payerAddress must be a valid Stellar public key',
  })
  payerAddress: string;

  @IsString({ message: 'recipientId must be a valid UUID' })
  recipientId: string;

  @IsEnum(DonationAsset, { message: 'asset must be one of: XLM, USDC, HEALTH' })
  @IsOptional()
  asset?: DonationAsset;
}
