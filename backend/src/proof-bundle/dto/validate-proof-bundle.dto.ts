import { IsString, IsUUID, Length } from 'class-validator';

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
}
