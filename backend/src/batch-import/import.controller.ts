import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { ImportEntityType, QuarantineReasonCode } from './enums/import.enum';
import { ImportService } from './import.service';

@ApiTags('Batch Import')
@Controller('batch-import')
@RequirePermissions(Permission.ADMIN_ACCESS)
export class ImportController {
  constructor(private readonly importService: ImportService) { }

  /**
   * Upload CSV → validate all rows → stage with quarantine metadata.
   * Idempotent: re-uploading the same file returns the original batch.
   */
  @Post('stage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Stage a CSV import with row-level validation' })
  async stage(
    @UploadedFile() file: Express.Multer.File,
    @Query('entityType') entityType: string,
    @Query('chunkSize') chunkSize: string,
    @Request() req: { user: { sub: string } },
  ) {
    if (!file) throw new BadRequestException('file is required');
    if (!Object.values(ImportEntityType).includes(entityType as ImportEntityType)) {
      throw new BadRequestException(
        `entityType must be one of: ${Object.values(ImportEntityType).join(', ')}`,
      );
    }
    const size = chunkSize ? parseInt(chunkSize, 10) : undefined;
    if (size !== undefined && (isNaN(size) || size < 1 || size > 1000)) {
      throw new BadRequestException('chunkSize must be between 1 and 1000');
    }
    return this.importService.stageImport(
      file.buffer,
      entityType as ImportEntityType,
      req.user.sub,
      file.originalname ?? null,
      size,
    );
  }

  /** Get staged batch + all rows (for preview). */
  @Get(':batchId')
  @ApiOperation({ summary: 'Preview a staged batch with all rows' })
  preview(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.importService.getBatch(batchId);
  }

  /**
   * Commit valid rows in chunks with checkpoint tracking.
   * Optionally pass rowIds for partial acceptance.
   * Safe to call again on an INTERRUPTED batch — resumes from last checkpoint.
   */
  @Post(':batchId/commit')
  @ApiOperation({ summary: 'Commit valid rows (chunked, resumable)' })
  commit(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() body: { rowIds?: string[] },
    @Request() req: { user: { sub: string } },
  ) {
    return this.importService.commitBatch(batchId, req.user.sub, body.rowIds);
  }

  /**
   * Resume an INTERRUPTED batch from its last successful checkpoint.
   * Already-committed rows are never re-processed.
   */
  @Post(':batchId/resume')
  @ApiOperation({ summary: 'Resume an interrupted batch from last checkpoint' })
  resume(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Request() req: { user: { sub: string } },
  ) {
    return this.importService.resumeBatch(batchId, req.user.sub);
  }

  /** Get the import quality report with acceptance/rejection metrics. */
  @Get(':batchId/report')
  @ApiOperation({ summary: 'Get import quality report with acceptance/rejection metrics' })
  report(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.importService.getQualityReport(batchId);
  }

  /** Get quarantined rows, optionally filtered by reason code. */
  @Get(':batchId/quarantine')
  @ApiOperation({ summary: 'Get quarantined rows with structured reason codes' })
  @ApiQuery({ name: 'reasonCode', enum: QuarantineReasonCode, required: false })
  quarantine(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Query('reasonCode') reasonCode?: QuarantineReasonCode,
  ) {
    return this.importService.getQuarantinedRows(batchId, reasonCode);
  }
}
