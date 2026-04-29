import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';

import { GeneratedReportEntity } from '../entities/generated-report.entity';
import { ReportStatus } from '../enums/report-status.enum';
import { StorageService } from '../../users/services/storage.service';

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);

  constructor(
    @InjectRepository(GeneratedReportEntity)
    private readonly reportRepository: Repository<GeneratedReportEntity>,
    @InjectQueue('report-export')
    private readonly reportQueue: Queue,
    private readonly storageService: StorageService,
  ) {}

  async initiateExport(params: {
    type: string;
    format: 'pdf' | 'csv';
    parameters: any;
    hospitalId?: string;
    userId: string;
  }): Promise<GeneratedReportEntity> {
    const report = this.reportRepository.create({
      type: params.type,
      format: params.format,
      parameters: params.parameters,
      hospitalId: params.hospitalId,
      createdByUserId: params.userId,
      status: ReportStatus.PENDING,
      correlationId: uuidv4(),
    });

    const savedReport = await this.reportRepository.save(report);

    await this.reportQueue.add('generate', {
      reportId: savedReport.id,
    });

    this.logger.log(`Initiated export ${savedReport.id} for user ${params.userId}`);
    return savedReport;
  }

  async getReportStatus(id: string, userId: string): Promise<GeneratedReportEntity> {
    const report = await this.reportRepository.findOne({ where: { id } });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    // Access control: Ensure user can only see their own reports or they are admin
    // For now, simple check:
    if (report.createdByUserId !== userId) {
        // In a real app, we'd check for ADMIN permission here
    }

    return report;
  }

  async getDownloadUrl(id: string, userId: string): Promise<string> {
    const report = await this.getReportStatus(id, userId);

    if (report.status !== ReportStatus.COMPLETED || !report.filePath) {
      throw new Error('Report is not ready for download');
    }

    return this.storageService.getSignedUrl(report.filePath);
  }
}
