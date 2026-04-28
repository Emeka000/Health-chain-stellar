import {
  IsISO8601,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class BlockchainCallbackDto {
  @IsString()
  @IsNotEmpty()
  eventId: string;

  @IsString()
  @IsNotEmpty()
  transactionHash: string;

  @IsString()
  @IsNotEmpty()
  contractMethod: string;

  @IsString()
  @IsIn(['pending', 'confirmed', 'failed'])
  status: 'pending' | 'confirmed' | 'failed';

  @IsISO8601()
  timestamp: string;

  @IsOptional()
  @IsString()
  details?: string;

  /**
   * Number of block confirmations reported by the blockchain provider.
   * When omitted, defaults to 1 (the callback itself counts as one confirmation).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  confirmations?: number;
}
