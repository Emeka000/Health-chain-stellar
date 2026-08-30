import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { User } from '../auth/decorators/user.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { ReputationAbuseService } from './reputation-abuse.service';

@ApiTags('Reputation')
@ApiBearerAuth()
@Controller('reputation/abuse')
export class ReputationAbuseController {
  constructor(private readonly abuseService: ReputationAbuseService) {}

  /** GET /reputation/abuse/flags — list all PENDING flags (admin only) */
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get flags' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('flags')
  listPending() {
    return this.abuseService.listPendingFlags();
  }

  /** PATCH /reputation/abuse/flags/:id/review — start review */
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Patch flags :id review' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch('flags/:id/review')
  startReview(@Param('id') id: string, @User('id') reviewerId: string) {
    return this.abuseService.startReview(id, reviewerId);
  }

  /** PATCH /reputation/abuse/flags/:id/clear — clear flag (delta is safe to apply) */
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Patch flags :id clear' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch('flags/:id/clear')
  clear(
    @Param('id') id: string,
    @User('id') reviewerId: string,
    @Body('note') note: string,
  ) {
    return this.abuseService.clearFlag(id, reviewerId, note);
  }

  /** PATCH /reputation/abuse/flags/:id/reverse — reverse flag (delta must NOT be applied) */
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Patch flags :id reverse' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch('flags/:id/reverse')
  reverse(
    @Param('id') id: string,
    @User('id') reviewerId: string,
    @Body('note') note: string,
  ) {
    return this.abuseService.reverseFlag(id, reviewerId, note);
  }
}
