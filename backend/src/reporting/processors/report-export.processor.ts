import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';

import { BloodRequestEntity } from '../../blood-requests/entities/blood-request.entity';
import { RequestQueryService } from '../../blood-requests/services/request-query.service';
import { GeneratedReportEntity } from '../entities/generated-report.entity';
import { ReportStatus } from '../enums/report-status.enum';
import { ReportGeneratorService } from '../services/report-generator.service';
import { StorageService } from '../../users/services/storage.service';

@Processor('report-export')
export class ReportExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportExportProcessor.name);

  constructor(
    @InjectRepository(GeneratedReportEntity)
    private readonly reportRepository: Repository<GeneratedReportEntity>,
    @InjectRepository(BloodRequestEntity)
    private readonly requestRepository: Repository<BloodRequestEntity>,
    private readonly requestQueryService: RequestQueryService,
    private readonly generatorService: ReportGeneratorService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { reportId } = job.data;
    const report = await this.reportRepository.findOne({ where: { id: reportId } });

    if (!report) {
      this.logger.error(`Report ${reportId} not found`);
      return;
    }

    try {
      this.logger.log(`Processing report ${reportId} (${report.type})`);
      
      // Update status to PROCESSING
      await this.reportRepository.update(reportId, { status: ReportStatus.PROCESSING });

      // Fetch data
      // We use the requestQueryService.buildQuery logic but we need to bypass pagination
      const queryDto = report.parameters;
      const { data } = await this.requestQueryService.queryRequests({
        ...queryDto,
        limit: 10000, // Large limit for export
        offset: 0,
      });

      // Generate report
      let buffer: Buffer;
      const metadata = {
        title: 'Blood Request Audit Report',
        hospitalId: report.hospitalId,
        startDate: queryDto.startDate ? new Date(queryDto.startDate) : undefined,
        endDate: queryDto.endDate ? new Date(queryDto.endDate) : undefined,
        generatedBy: report.createdByUserId,
      };

      if (report.format === 'csv') {
        buffer = await this.generatorService.generateBloodRequestsCSV(data);
      } else {
        buffer = await this.generatorService.generateBloodRequestsPDF(data, metadata);
      }

      // Upload to storage
      const mimeType = report.format === 'csv' ? 'text/csv' : 'application/pdf';
      const fileName = `report-${report.id}.${report.format}`;
      const uploadResult = await this.storageService.uploadFile(
        buffer,
        fileName,
        mimeType,
        'reports',
      );

      // Update report record
      await this.reportRepository.update(reportId, {
        status: ReportStatus.COMPLETED,
        filePath: uploadResult.key,
      });

      this.logger.log(`Report ${reportId} completed successfully`);
    } catch (error) {
      this.logger.error(`Report ${reportId} failed: ${error.message}`, error.stack);
      await this.reportRepository.update(reportId, {
        status: ReportStatus.FAILED,
        error: error.message,
      });
      throw error;
    }
  }
}
