import { IsObject, IsOptional } from 'class-validator';

export class CreateRecordFromTemplateDto {
  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;
}
