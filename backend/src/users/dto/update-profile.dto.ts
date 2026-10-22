import {
  IsString,
  IsOptional,
  IsEmail,
  IsPhoneNumber,
  MaxLength,
  MinLength,
  IsObject,
} from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  region?: string;

  @IsObject()
  @IsOptional()
  profile?: Record<string, unknown>;
}
