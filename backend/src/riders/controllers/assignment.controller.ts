import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { ReputationAwareAssignmentService } from '../services/reputation-aware-assignment.service';

@Controller('riders/assignment')
export class AssignmentController {
  constructor(private readonly service: ReputationAwareAssignmentService) {}

  @RequirePermissions(Permission.MANAGE_RIDERS)
  @Post()
  async assign(@Body() body: { orderId: string; pickupLat: number; pickupLon: number; maxCandidates?: number }): Promise<any> {
    return this.service.assignRider(body);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @Get('decisions/:orderId')
  getDecision(@Param('orderId') orderId: string) {
    return this.service.getDecision(orderId);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @Get('weights')
  getWeights() {
    return this.service.getActiveWeights();
  }

  @RequirePermissions(Permission.MANAGE_RIDERS)
  @Patch('weights')
  updateWeights(@Body() body: Record<string, number>) {
    return this.service.updateWeights(body);
  }
}
