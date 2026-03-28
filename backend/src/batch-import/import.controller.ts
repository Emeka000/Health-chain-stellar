import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  ParseUUIDPipe,
  Request,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { ImportEntityType } from './enums/import.enum';
import { ImportService } from './import.service';

@Controller('batch-import')
@RequirePermissions(Permission.ADMIN_ACCESS)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  /** Upload CSV → returns staged batch with row-level validation results */
  @Post('stage')
  @UseInterceptors(FileInterceptor('file'))
  async stage(
    @UploadedFile() file: Express.Multer.File,
    @Query('entityType') entityType: string,
    @Request() req: { user: { sub: string } },
  ) {
    if (!file) throw new BadRequestException('file is required');
    if (!Object.values(ImportEntityType).includes(entityType as ImportEntityType)) {
      throw new BadRequestException(
        `entityType must be one of: ${Object.values(ImportEntityType).join(', ')}`,
      );
    }
    return this.importService.stageImport(
      file.buffer,
      entityType as ImportEntityType,
      req.user.sub,
      file.originalname ?? null,
    );
  }

  /** Get staged batch + all rows (for preview) */
  @Get(':batchId')
  preview(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.importService.getBatch(batchId);
  }

  /** Commit valid rows — optionally pass rowIds for partial acceptance */
  @Post(':batchId/commit')
  commit(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() body: { rowIds?: string[] },
    @Request() req: { user: { sub: string } },
  ) {
    return this.importService.commitBatch(batchId, req.user.sub, body.rowIds);
  }
}
