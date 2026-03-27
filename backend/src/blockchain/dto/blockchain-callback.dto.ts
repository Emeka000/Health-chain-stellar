import {
  IsISO8601,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
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
}
