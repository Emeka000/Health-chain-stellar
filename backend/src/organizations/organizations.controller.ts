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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

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
  @ApiOperation({ summary: 'Register a new organization' })
  @ApiResponse({ status: 201, description: 'Organization registered successfully' })
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
  @ApiOperation({ summary: 'List organizations pending approval' })
  @ApiResponse({ status: 200, description: 'Pending organizations retrieved successfully' })
  @Get('pending')
  listPending() {
    return this.organizationsService.listPending();
  }

  @Public()
  @ApiOperation({ summary: 'Search organizations' })
  @ApiResponse({ status: 200, description: 'Matching organizations retrieved successfully' })
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
  @ApiOperation({ summary: 'Approve an organization' })
  @ApiResponse({ status: 200, description: 'Organization approved successfully' })
  @Patch(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.organizationsService.approve(id, req.user.id);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Reject an organization' })
  @ApiResponse({ status: 200, description: 'Organization rejected successfully' })
  @Patch(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOrganizationDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.organizationsService.reject(id, dto, req.user.id);
  }

  @ApiOperation({ summary: 'Submit a review for an organization' })
  @ApiResponse({ status: 201, description: 'Review submitted successfully' })
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

  @ApiOperation({ summary: 'List reviews for an organization' })
  @ApiResponse({ status: 200, description: 'Organization reviews retrieved successfully' })
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

  @ApiOperation({ summary: 'Report an organization review' })
  @ApiResponse({ status: 201, description: 'Review reported successfully' })
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
  @ApiOperation({ summary: 'Moderate an organization review' })
  @ApiResponse({ status: 200, description: 'Review moderated successfully' })
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

  @ApiOperation({ summary: 'Delete an organization review' })
  @ApiResponse({ status: 200, description: 'Review deleted successfully' })
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
  @ApiOperation({ summary: 'Sync organization verification to the blockchain' })
  @ApiResponse({ status: 201, description: 'Verification synced to blockchain successfully' })
  @Post(':id/verify-on-chain')
  verifyOnChain(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.verificationSyncService.syncVerificationToBlockchain(organizationId);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Revoke organization verification on the blockchain' })
  @ApiResponse({ status: 201, description: 'Verification revoked successfully' })
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
  @ApiOperation({ summary: 'Retry organization verification sync' })
  @ApiResponse({ status: 201, description: 'Verification sync retried successfully' })
  @Post(':id/retry-sync')
  retrySyncVerification(
    @Param('id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.verificationSyncService.retrySyncVerification(organizationId);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Suspend an organization' })
  @ApiResponse({ status: 200, description: 'Organization suspended successfully' })
  @Patch(':id/suspend')
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendOrganizationDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.lifecycleService.suspend(id, dto, req.user.id);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Reinstate a suspended organization' })
  @ApiResponse({ status: 200, description: 'Organization reinstated successfully' })
  @Patch(':id/reinstate')
  reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReinstateOrganizationDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.lifecycleService.reinstate(id, dto, req.user.id);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Unverify an organization' })
  @ApiResponse({ status: 200, description: 'Organization unverified successfully' })
  @Patch(':id/unverify')
  unverify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnverifyOrganizationDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.lifecycleService.unverify(id, dto, req.user.id);
  }

  @Public()
  @ApiOperation({ summary: 'Reapply for organization verification' })
  @ApiResponse({ status: 200, description: 'Reapplication submitted successfully' })
  @Patch(':id/reapply')
  reapply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReapplyOrganizationDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.lifecycleService.reapply(id, dto, req.user.id);
  }
}
