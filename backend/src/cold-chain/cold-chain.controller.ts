import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ColdChainService } from './cold-chain.service';
import { DeliveryTimelineService } from './delivery-timeline.service';
import { IngestTelemetryDto } from './dto/ingest-telemetry.dto';

@Controller('cold-chain')
export class ColdChainController {
  constructor(
    private readonly coldChainService: ColdChainService,
    private readonly timelineService: DeliveryTimelineService,
  ) {}

  @Post('telemetry')
  ingest(@Body() dto: IngestTelemetryDto) {
    return this.coldChainService.ingest(dto);
  }

  @Get('deliveries/:deliveryId/timeline')
  getTimeline(@Param('deliveryId') deliveryId: string) {
    return this.coldChainService.getTimeline(deliveryId);
  }

  @Get('deliveries/:deliveryId/compliance')
  getCompliance(@Param('deliveryId') deliveryId: string) {
    return this.coldChainService.getCompliance(deliveryId);
  }

  /**
   * Unified delivery evidence bundle: correlates cold-chain telemetry
   * with route deviation incidents on a single timeline (Issue #616).
   */
  @Get('deliveries/:deliveryId/evidence')
  getEvidenceBundle(
    @Param('deliveryId') deliveryId: string,
    @Query('orderId') orderId?: string,
  ) {
    return this.timelineService.buildTimeline(deliveryId, orderId ?? null);
  }

  /**
   * Re-evaluate the evidence bundle after late-arriving data (Issue #616).
   */
  @Post('deliveries/:deliveryId/evidence/reevaluate')
  reevaluateEvidence(
    @Param('deliveryId') deliveryId: string,
    @Query('orderId') orderId?: string,
  ) {
    return this.timelineService.reevaluate(deliveryId, orderId ?? null);
  }
}
