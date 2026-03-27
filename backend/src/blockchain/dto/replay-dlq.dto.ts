import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class ReplayDlqDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = false;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  batchSize?: number = 10;

  @IsOptional()
  @IsNumber()
  @Min(0)
  offset?: number = 0;
}
