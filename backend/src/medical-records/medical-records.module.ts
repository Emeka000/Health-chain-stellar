import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordTemplateEntity } from './entities/record-template.entity';
import { MedicalRecordEntity } from './entities/medical-record.entity';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RecordTemplateEntity, MedicalRecordEntity])],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class MedicalRecordsModule {}
