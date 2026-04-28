import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { OrganizationType } from '../../organizations/enums/organization-type.enum';
import { OnboardingStep } from '../enums/onboarding.enum';

export class CreateOnboardingDto {
  @IsEnum(OrganizationType)
  orgType: OrganizationType;
}

export class SaveStepDto {
  @IsEnum(OnboardingStep)
  step: OnboardingStep;

  @IsObject()
  data: Record<string, unknown>;
}

export class ReviewOnboardingDto {
  @IsEnum(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsString() @IsOptional()
  rejectionReason?: string;
}

export class ActivateOnboardingDto {
  @IsString() @IsNotEmpty()
  walletAddress: string;

  @IsString() @IsNotEmpty()
  licenseNumber: string;
}
