import * as fs from 'fs';

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import { MediaProcessingService, MediaUploadContext } from './media-processing.service';

@ApiTags('Media Processing')
@ApiBearerAuth()
@Controller('media')
export class MediaProcessingController {
  constructor(private readonly mediaService: MediaProcessingService) {}

  /**
   * Upload a file through the secure ingestion pipeline.
   * The file is quarantined, scanned, metadata-stripped, and only then
   * written to approved storage.
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload and process a media file',
    description:
      'Runs the full security pipeline: size check → MIME sniff → malware scan → metadata strip → approved storage.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        category: { type: 'string', enum: ['profile', 'evidence', 'medical', 'signature'] },
        ownerType: { type: 'string' },
      },
      required: ['file', 'category'],
    },
  })
  @ApiResponse({ status: 201, description: 'File processed and approved' })
  @ApiResponse({ status: 400, description: 'File rejected — see reason in response body' })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('category') category: string,
    @Query('ownerType') ownerType: string,
    @Request() req: any,
  ) {
    const context: MediaUploadContext = {
      ownerId: req.user?.id ?? 'anonymous',
      ownerType: ownerType ?? 'user',
      category: (category ?? 'profile') as MediaUploadContext['category'],
    };
    const result = await this.mediaService.ingest(file, context);

    // Issue a signed URL for the approved file
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const signed = this.mediaService.issueSignedUrl(result.fileId, context.ownerId, baseUrl);

    return { ...result, signedUrl: signed };
  }

  /**
   * Serve an approved file via a short-lived signed URL token.
   * Validates token expiry and owner before streaming the file.
   */
  @Get('serve/:token')
  @ApiOperation({ summary: 'Serve an approved file via signed URL' })
  @ApiParam({ name: 'token', description: 'Signed URL token' })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 403, description: 'Token expired or access denied' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  async serve(
    @Param('token') token: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const ownerId: string = req.user?.id ?? 'anonymous';
    const fileId = this.mediaService.resolveSignedUrl(token, ownerId);

    // In a real implementation fileId would be looked up in FileMetadataService
    // to get the actual storagePath.  Here we return the fileId for simplicity.
    res.json({ fileId, servedAt: new Date().toISOString() });
  }

  /**
   * Issue a new signed URL for an already-approved file.
   */
  @Post('signed-url/:fileId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a signed URL for an approved file' })
  @ApiParam({ name: 'fileId', description: 'Approved file ID' })
  @ApiQuery({ name: 'ownerType', required: false })
  @ApiResponse({ status: 200, description: 'Signed URL issued' })
  async issueSignedUrl(
    @Param('fileId') fileId: string,
    @Request() req: any,
  ) {
    const ownerId: string = req.user?.id ?? 'anonymous';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.mediaService.issueSignedUrl(fileId, ownerId, baseUrl);
  }
}
