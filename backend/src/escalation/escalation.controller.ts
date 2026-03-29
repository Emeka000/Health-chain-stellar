import { Controller, Get, Param, Post, Body, Request, UseGuards } from '@nestjs/common';
import { EscalationService } from './escalation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/escalations')
export class EscalationController {
  constructor(private readonly escalationService: EscalationService) {}

  @Get('open')
  getOpen() {
    return this.escalationService.findOpen();
  }

  @Get('request/:requestId')
  getByRequest(@Param('requestId') requestId: string) {
    return this.escalationService.findByRequest(requestId);
  }

  @Post(':id/acknowledge')
  acknowledge(@Param('id') id: string, @Request() req: any) {
    const userId: string = req.user?.sub ?? req.user?.id ?? 'unknown';
    return this.escalationService.acknowledge(id, userId);
  }
}
