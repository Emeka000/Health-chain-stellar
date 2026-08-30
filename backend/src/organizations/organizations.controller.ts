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
import {
  ReapplyOrganizationDto,
  ReinstateOrganizationDto,
  SuspendOrganizationDto,
  UnverifyOrganizationDto,
} from './dto/org-lifecycle.dto';
import { OrganizationReviewQueryDto } from './dto/organization-review-query.dto';
import { RegisterOrganizationDto } from './dto/register-organization.dto';
import { RejectOrganizationDto } from './dto/reject-organization.dto';
import { ReportOrganizationReviewDto } from './dto/report-organization-review.dto';
import { SearchOrganizationsDto } from './dto/search-organizations.dto';
import { OrgVerificationLifecycleService } from './services/org-verification-lifecycle.service';
import { OrganizationsService } from './organizations.service';
import { OrganizationReviewsService } from './services/organization-reviews.service';
import { VerificationSyncService } from './services/verification-sync.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly organizationReviewsService: OrganizationReviewsService,
    private readonly verificationSyncService: VerificationSyncService,
    private readonly lifecycleService: OrgVerificationLifecycleService,
  ) {}

  @Public()
  @ApiOperation({ summary: 'Post register' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
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
  @ApiOperation({ summary: 'Get pending' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('pending')
  listPending() {
    return this.organizationsService.listPending();
  }

  @Public()
  @ApiOperation({ summary: 'Get search' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
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
  @ApiOperation({ summary: 'Patch :id approve' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.organizationsService.approve(id, req.user.id);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Patch :id reject' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOrganizationDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.organizationsService.reject(id, dto, req.user.id);
  }

  @ApiOperation({ summary: 'Post :id reviews' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
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

  @ApiOperation({ summary: 'Get :id reviews' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
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

  @ApiOperation({ summary: 'Post reviews :reviewId report' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
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
  @ApiOperation({ summary: 'Patch reviews :reviewId moderate' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
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

  @ApiOperation({ summary: 'Delete reviews :reviewId' })
  @ApiResponse({ status: 200, description: 'Resource deleted successfully' })
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
  @ApiOperation({ summary: 'Post :id verify on chain' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/verify-on-chain')
  verifyOnChain(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.verificationSyncService.syncVerificationToBlockchain(organizationId);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Post :id revoke verification' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
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
  @ApiOperation({ summary: 'Post :id retry sync' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/retry-sync')
  retrySyncVerification(
    @Param('id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.verificationSyncService.retrySyncVerification(organizationId);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get :id sync status' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id/sync-status')
  getSyncStatus(
    @Param('id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.verificationSyncService.getSyncStatus(organizationId);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get verification pending syncs' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('verification/pending-syncs')
  listPendingSyncs() {
    return this.verificationSyncService.listPendingSyncs();
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Post :id check mismatch' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/check-mismatch')
  checkSyncMismatch(
    @Param('id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.verificationSyncService.checkSyncMismatch(organizationId);
  }

  // =========================================================================
  // Verification Lifecycle Endpoints
  // =========================================================================

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Post :id suspend' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/suspend')
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
    @Body() dto: SuspendOrganizationDto,
  ) {
    return this.lifecycleService.suspend(id, req.user.id, dto);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Post :id reinstate' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/reinstate')
  reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
    @Body() dto: ReinstateOrganizationDto,
  ) {
    return this.lifecycleService.reinstate(id, req.user.id, dto);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Post :id unverify' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/unverify')
  unverify(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
    @Body() dto: UnverifyOrganizationDto,
  ) {
    return this.lifecycleService.unverify(id, req.user.id, dto);
  }

  @ApiOperation({ summary: 'Post :id reapply' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':id/reapply')
  reapply(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
    @Body() dto: ReapplyOrganizationDto,
  ) {
    return this.lifecycleService.reapply(id, req.user.id, dto);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get :id lifecycle history' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id/lifecycle-history')
  getLifecycleHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycleService.getHistory(id);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get :id grace period' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id/grace-period')
  getGracePeriod(@Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycleService.getActiveGracePeriod(id);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get :id restriction level' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id/restriction-level')
  getRestrictionLevel(@Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycleService.getRestrictionLevel(id);
  }
}
