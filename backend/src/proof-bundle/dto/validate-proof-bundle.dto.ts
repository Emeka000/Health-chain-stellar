import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class ArtifactDto {
  @IsString()
  type: string;

  @IsString()
  @Length(64, 64)
  digest: string;

  @IsInt()
  @Min(0)
  seq: number;
}

export class ValidateProofBundleDto {
  @IsUUID()
  paymentId: string;

  @IsUUID()
  deliveryProofId: string;

  /** SHA-256 hex of the recipient signature artifact */
  @IsString()
  @Length(64, 64)
  signatureHash: string;

  /** SHA-256 hex of the photo evidence */
  @IsString()
  @Length(64, 64)
  photoHash: string;

  /** SHA-256 hex of the medical verification record */
  @IsString()
  @Length(64, 64)
  medicalHash: string;

  /** Identity of the submitting actor */
  @IsString()
  submittedBy: string;

  /**
   * Ordered artifact manifest for chain-of-evidence validation.
   * Must include entries for 'signature', 'photo', and 'medical' at minimum.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArtifactDto)
  artifacts?: ArtifactDto[];

  /** Identity of the authorized evidence submitter (for audit log) */
  @IsOptional()
  @IsString()
  verifierIdentity?: string;
}
