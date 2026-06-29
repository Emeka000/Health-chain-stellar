import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { ReputationAwareAssignmentService } from '../services/reputation-aware-assignment.service';

@ApiTags('Riders')
@ApiBearerAuth()
@Controller('riders/assignment')
export class AssignmentController {
  constructor(private readonly service: ReputationAwareAssignmentService) {}

  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  assign(@Body() body: { orderId: string; pickupLat: number; pickupLon: number; maxCandidates?: number }) {
    return this.service.assignRider(body);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get decisions :orderId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('decisions/:orderId')
  getDecision(@Param('orderId') orderId: string) {
    return this.service.getDecision(orderId);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get weights' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('weights')
  getWeights() {
    return this.service.getActiveWeights();
  }

  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Patch weights' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch('weights')
  updateWeights(@Body() body: Record<string, number>) {
    return this.service.updateWeights(body);
  }
}
