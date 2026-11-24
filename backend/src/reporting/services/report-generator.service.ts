import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { BloodRequest } from '../../blood-requests/entities/blood-request.entity';
import * as PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import {
  ReportType,
  ReportFormat,
  ReportPeriod,
  ReportData,
  ReportMetadata,
} from '../interfaces/report.interface';

@Injectable()
export class ReportGeneratorService {
  private readonly logger = new Logger(ReportGeneratorService.name);

  constructor(
    @InjectRepository(BloodRequest)
    private readonly bloodRequestRepository: Repository<BloodRequest>,
  ) {}

  async generateReport(
    type: ReportType,
    format: ReportFormat,
    period: ReportPeriod,
  ): Promise<Buffer> {
    const data = await this.collectReportData(type, period);

    switch (format) {
      case ReportFormat.PDF:
        return this.generatePDF(data);
      case ReportFormat.EXCEL:
        return this.generateExcel(data);
      case ReportFormat.CSV:
        return this.generateCSV(data);
      case ReportFormat.JSON:
        return this.generateJSON(data);
      default:
        throw new Error(`Unsupported report format: ${format}`);
    }
  }

  private async collectReportData(
    type: ReportType,
    period: ReportPeriod,
  ): Promise<ReportData> {
    const { startDate, endDate } = this.getPeriodDates(period);

    const requests = await this.bloodRequestRepository.find({
      where: {
        createdAt: Between(startDate, endDate),
      },
      relations: ['requester', 'donor'],
    });

    const metadata: ReportMetadata = {
      type,
      period,
      startDate,
      endDate,
      generatedAt: new Date(),
      totalRecords: requests.length,
    };

    return {
      metadata,
      data: requests,
      summary: this.calculateSummary(requests),
    };
  }

  private getPeriodDates(period: ReportPeriod): {
    startDate: Date;
    endDate: Date;
  } {
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case ReportPeriod.DAILY:
        startDate.setDate(startDate.getDate() - 1);
        break;
      case ReportPeriod.WEEKLY:
        startDate.setDate(startDate.getDate() - 7);
        break;
      case ReportPeriod.MONTHLY:
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case ReportPeriod.QUARTERLY:
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case ReportPeriod.YEARLY:
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 1);
    }

    return { startDate, endDate };
  }

  private calculateSummary(requests: BloodRequest[]): Record<string, any> {
    const totalRequests = requests.length;
    const completedRequests = requests.filter(
      (r) => r.status === 'completed',
    ).length;
    const pendingRequests = requests.filter(
      (r) => r.status === 'pending',
    ).length;
    const cancelledRequests = requests.filter(
      (r) => r.status === 'cancelled',
    ).length;

    const bloodTypeDistribution = requests.reduce(
      (acc, request) => {
        const bloodType = request.bloodType;
        acc[bloodType] = (acc[bloodType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalRequests,
      completedRequests,
      pendingRequests,
      cancelledRequests,
      completionRate:
        totalRequests > 0 ? (completedRequests / totalRequests) * 100 : 0,
      bloodTypeDistribution,
    };
  }

  private async generatePDF(data: ReportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(20).text('Blood Request Report', { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Report Type: ${data.metadata.type}`);
        doc.text(`Period: ${data.metadata.period}`);
        doc.text(`Start Date: ${data.metadata.startDate.toISOString()}`);
        doc.text(`End Date: ${data.metadata.endDate.toISOString()}`);
        doc.text(`Generated At: ${data.metadata.generatedAt.toISOString()}`);
        doc.text(`Total Records: ${data.metadata.totalRecords}`);
        doc.moveDown();

        doc.fontSize(16).text('Summary', { underline: true });
        doc.moveDown();
        doc.fontSize(12);
        Object.entries(data.summary).forEach(([key, value]) => {
          if (typeof value === 'object') {
            doc.text(`${key}:`);
            Object.entries(value as Record<string, any>).forEach(
              ([subKey, subValue]) => {
                doc.text(`  ${subKey}: ${subValue}`);
              },
            );
          } else {
            doc.text(`${key}: ${value}`);
          }
        });

        doc.end();
      } catch (error) {
        this.logger.error('Failed to generate PDF report', error);
        reject(error);
      }
    });
  }

  private async generateExcel(data: ReportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    worksheet.addRow(['Blood Request Report']);
    worksheet.addRow([]);
    worksheet.addRow(['Report Type', data.metadata.type]);
    worksheet.addRow(['Period', data.metadata.period]);
    worksheet.addRow(['Start Date', data.metadata.startDate.toISOString()]);
    worksheet.addRow(['End Date', data.metadata.endDate.toISOString()]);
    worksheet.addRow(['Generated At', data.metadata.generatedAt.toISOString()]);
    worksheet.addRow(['Total Records', data.metadata.totalRecords]);
    worksheet.addRow([]);

    worksheet.addRow(['Summary']);
    Object.entries(data.summary).forEach(([key, value]) => {
      if (typeof value === 'object') {
        worksheet.addRow([key, JSON.stringify(value)]);
      } else {
        worksheet.addRow([key, value]);
      }
    });

    worksheet.addRow([]);
    worksheet.addRow(['Data']);

    if (data.data.length > 0) {
      const headers = Object.keys(data.data[0]);
      worksheet.addRow(headers);

      data.data.forEach((row) => {
        worksheet.addRow(headers.map((header) => row[header]));
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private async generateCSV(data: ReportData): Promise<Buffer> {
    const lines: string[] = [];

    lines.push('Blood Request Report');
    lines.push('');
    lines.push(`Report Type,${data.metadata.type}`);
    lines.push(`Period,${data.metadata.period}`);
    lines.push(`Start Date,${data.metadata.startDate.toISOString()}`);
    lines.push(`End Date,${data.metadata.endDate.toISOString()}`);
    lines.push(`Generated At,${data.metadata.generatedAt.toISOString()}`);
    lines.push(`Total Records,${data.metadata.totalRecords}`);
    lines.push('');

    lines.push('Summary');
    Object.entries(data.summary).forEach(([key, value]) => {
      if (typeof value === 'object') {
        lines.push(`${key},${JSON.stringify(value)}`);
      } else {
        lines.push(`${key},${value}`);
      }
    });

    lines.push('');
    lines.push('Data');

    if (data.data.length > 0) {
      const headers = Object.keys(data.data[0]);
      lines.push(headers.join(','));

      data.data.forEach((row) => {
        lines.push(headers.map((header) => row[header]).join(','));
      });
    }

    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  private async generateJSON(data: ReportData): Promise<Buffer> {
    return Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
  }
}
