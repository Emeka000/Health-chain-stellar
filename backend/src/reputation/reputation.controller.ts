import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { User } from '../auth/decorators/user.decorator';
import { Permission } from '../auth/enums/permission.enum';

import {
  LeaderboardQueryDto,
  ReputationHistoryQueryDto,
} from './dto/reputation-query.dto';
import { ReputationService } from './reputation.service';

@ApiTags('Reputation')
@ApiBearerAuth()
@Controller('reputation')
export class ReputationController {
  constructor(private readonly reputationService: ReputationService) {}

  /** GET /reputation/leaderboard */
  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get leaderboard' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('leaderboard')
  getLeaderboard(@Query() query: LeaderboardQueryDto) {
    return this.reputationService.getLeaderboard(query);
  }

  /** GET /reputation/me — current rider's own reputation */
  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get me' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('me')
  getMyReputation(@User('id') userId: string) {
    // userId maps to riderId via the rider profile; service handles lookup
    return this.reputationService.getReputation(userId);
  }

  /** GET /reputation/me/badges */
  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get me badges' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('me/badges')
  getMyBadges(@User('id') userId: string) {
    return this.reputationService.getBadges(userId);
  }

  /** GET /reputation/me/history */
  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get me history' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('me/history')
  getMyHistory(
    @User('id') userId: string,
    @Query() query: ReputationHistoryQueryDto,
  ) {
    return this.reputationService.getHistory(userId, query);
  }

  /** GET /reputation/me/rank */
  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get me rank' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('me/rank')
  getMyRank(@User('id') userId: string) {
    return this.reputationService.getRank(userId);
  }

  /** GET /reputation/:riderId — admin/hospital view */
  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Get :riderId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':riderId')
  getReputation(@Param('riderId') riderId: string) {
    return this.reputationService.getReputation(riderId);
  }

  /** GET /reputation/:riderId/badges */
  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Get :riderId badges' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':riderId/badges')
  getBadges(@Param('riderId') riderId: string) {
    return this.reputationService.getBadges(riderId);
  }

  /** GET /reputation/:riderId/history */
  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Get :riderId history' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':riderId/history')
  getHistory(
    @Param('riderId') riderId: string,
    @Query() query: ReputationHistoryQueryDto,
  ) {
    return this.reputationService.getHistory(riderId, query);
  }

  /** GET /reputation/:riderId/rank */
  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Get :riderId rank' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':riderId/rank')
  getRank(@Param('riderId') riderId: string) {
    return this.reputationService.getRank(riderId);
  }
}
