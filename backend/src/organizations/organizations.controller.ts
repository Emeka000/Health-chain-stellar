import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

import { memoryStorage } from 'multer';

import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { CreateOrganizationReviewDto } from './dto/create-organization-review.dto';
import { ModerateOrganizationReviewDto } from './dto/moderate-organization-review.dto';
import { OrganizationReviewQueryDto } from './dto/organization-review-query.dto';
import { RegisterOrganizationDto } from './dto/register-organization.dto';
import { RejectOrganizationDto } from './dto/reject-organization.dto';
import { ReportOrganizationReviewDto } from './dto/report-organization-review.dto';
import { SearchOrganizationsDto } from './dto/search-organizations.dto';
import { RevokeVerificationDto } from './dto/revoke-verification.dto';
import { OrganizationsService } from './organizations.service';
import { OrganizationReviewsService } from './services/organization-reviews.service';
import { VerificationSyncService } from './services/verification-sync.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly organizationReviewsService: OrganizationReviewsService,
    private readonly verificationSyncService: VerificationSyncService,
  ) {}

  @Public()
  @Post('register')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'licenseDocument', maxCount: 1 },
        { name: 'certificateDocument', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024, files: 2 },
      },
    ),
  )
  register(
    @Body() dto: RegisterOrganizationDto,
    @UploadedFiles()
    files: {
      licenseDocument?: Express.Multer.File[];
      certificateDocument?: Express.Multer.File[];
    },
  ) {
    return this.organizationsService.register(dto, files);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('pending')
  listPending() {
    return this.organizationsService.listPending();
  }

  @Public()
  @Get('search')
  search(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: SearchOrganizationsDto,
  ) {
    return this.organizationsService.search(query);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Patch(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.organizationsService.approve(id, req.user.id);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Patch(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOrganizationDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.organizationsService.reject(id, dto, req.user.id);
  }

  @Post(':id/reviews')
  submitReview(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateOrganizationReviewDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.organizationReviewsService.submitReview(
      organizationId,
      req.user.id,
      dto,
    );
  }

  @Get(':id/reviews')
  listReviews(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: OrganizationReviewQueryDto,
  ) {
    return this.organizationReviewsService.getReviewsForOrganization(
      organizationId,
      query,
    );
  }

  @Post('reviews/:reviewId/report')
  reportReview(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: ReportOrganizationReviewDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.organizationReviewsService.reportReview(
      reviewId,
      req.user.id,
      dto,
    );
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Patch('reviews/:reviewId/moderate')
  moderateReview(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: ModerateOrganizationReviewDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.organizationReviewsService.moderateReview(
      reviewId,
      req.user.id,
      dto,
    );
  }

  @Delete('reviews/:reviewId')
  deleteReview(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Req() req: { user: { id: string; role?: string } },
  ) {
    return this.organizationReviewsService.deleteReview(
      reviewId,
      req.user.id,
      req.user.role,
    );
  }

  // =========================================================================
  // Verification Sync Endpoints
  // =========================================================================

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post(':id/verify-on-chain')
  verifyOnChain(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.verificationSyncService.syncVerificationToBlockchain(organizationId);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post(':id/revoke-verification')
  revokeVerification(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Body() dto: RevokeVerificationDto,
  ) {
    return this.verificationSyncService.revokeVerificationFromBlockchain(
      organizationId,
      dto.reason,
    );
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post(':id/retry-sync')
  retrySyncVerification(
    @Param('id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.verificationSyncService.retrySyncVerification(organizationId);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get(':id/sync-status')
  getSyncStatus(
    @Param('id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.verificationSyncService.getSyncStatus(organizationId);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('verification/pending-syncs')
  listPendingSyncs() {
    return this.verificationSyncService.listPendingSyncs();
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post(':id/check-mismatch')
  checkSyncMismatch(
    @Param('id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.verificationSyncService.checkSyncMismatch(organizationId);
  }
}
