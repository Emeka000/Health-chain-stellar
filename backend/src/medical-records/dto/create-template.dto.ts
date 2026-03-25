import { IsString, IsBoolean, IsObject, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  recordType: string;

  @IsObject()
  schemaJson: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;
}
