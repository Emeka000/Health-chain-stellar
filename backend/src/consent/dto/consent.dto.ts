import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class PublishConsentTermDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  versionLabel: string;

  /** SHA-256 hex digest of the canonical consent document */
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i)
  versionHash: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changeSummary?: string;
}

export class RecordConsentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  consentSource?: string;
}
