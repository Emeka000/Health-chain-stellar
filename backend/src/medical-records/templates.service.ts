import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecordTemplateEntity } from './entities/record-template.entity';
import { MedicalRecordEntity } from './entities/medical-record.entity';
import { CreateTemplateDto } from './dto/create-template.dto';
import { CreateRecordFromTemplateDto } from './dto/create-record-from-template.dto';

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(RecordTemplateEntity)
    private readonly templateRepo: Repository<RecordTemplateEntity>,
    @InjectRepository(MedicalRecordEntity)
    private readonly recordRepo: Repository<MedicalRecordEntity>,
  ) {}

  private validateSchemaJson(schemaJson: unknown): void {
    if (typeof schemaJson !== 'object' || schemaJson === null || Array.isArray(schemaJson)) {
      throw new BadRequestException('schemaJson must be a valid JSON object');
    }
    try {
      JSON.parse(JSON.stringify(schemaJson));
    } catch {
      throw new BadRequestException('schemaJson contains non-serializable values');
    }
  }

  async createTemplate(providerId: string, dto: CreateTemplateDto): Promise<RecordTemplateEntity> {
    this.validateSchemaJson(dto.schemaJson);
    const template = this.templateRepo.create({
      providerId,
      name: dto.name,
      recordType: dto.recordType,
      schemaJson: dto.schemaJson,
      isPublic: dto.isPublic ?? false,
    });
    return this.templateRepo.save(template);
  }

  async listTemplates(providerId: string): Promise<RecordTemplateEntity[]> {
    return this.templateRepo
      .createQueryBuilder('t')
      .where('t.isPublic = :pub OR t.providerId = :pid', { pub: true, pid: providerId })
      .orderBy('t.createdAt', 'DESC')
      .getMany();
  }

  async createRecordFromTemplate(
    providerId: string,
    templateId: string,
    dto: CreateRecordFromTemplateDto,
  ): Promise<MedicalRecordEntity> {
    const template = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!template) {
      throw new NotFoundException(`Template '${templateId}' not found`);
    }
    if (!template.isPublic && template.providerId !== providerId) {
      throw new ForbiddenException('Access to this template is not allowed');
    }

    const record = this.recordRepo.create({
      providerId,
      templateId: template.id,
      recordType: template.recordType,
      data: { ...template.schemaJson, ...(dto.data ?? {}) },
    });
    return this.recordRepo.save(record);
  }
}
