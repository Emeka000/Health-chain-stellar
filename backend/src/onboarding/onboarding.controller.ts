import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { User } from '../auth/decorators/user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  ActivateOnboardingDto,
  CreateOnboardingDto,
  ReviewOnboardingDto,
  SaveStepDto,
} from './dto/onboarding.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('Onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  @Post()
  @ApiOperation({ summary: 'Start a new onboarding draft' })
  create(@User('id') userId: string, @Body() dto: CreateOnboardingDto) {
    return this.service.create(userId, dto);
  }

  @Put(':id/steps')
  @ApiOperation({ summary: 'Save a wizard step (creates or updates)' })
  saveStep(
    @Param('id') id: string,
    @User('id') userId: string,
    @Body() dto: SaveStepDto,
  ) {
    return this.service.saveStep(id, userId, dto);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit onboarding for review' })
  submit(@Param('id') id: string, @User('id') userId: string) {
    return this.service.submit(id, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get onboarding by id (owner or admin)' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Get()
  @RequirePermissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'List submitted onboardings pending review' })
  listPending() {
    return this.service.listPending();
  }

  @Post(':id/review')
  @RequirePermissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Approve or reject an onboarding submission' })
  review(
    @Param('id') id: string,
    @User('id') reviewerId: string,
    @Body() dto: ReviewOnboardingDto,
  ) {
    return this.service.review(id, reviewerId, dto);
  }

  @Post(':id/activate')
  @RequirePermissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Activate an approved onboarding (creates org + on-chain registration)' })
  activate(
    @Param('id') id: string,
    @User('id') reviewerId: string,
    @Body() dto: ActivateOnboardingDto,
  ) {
    return this.service.activate(id, reviewerId, dto);
  }
}
