import { Controller, Get, Param, Query } from '@nestjs/common';
import { SlaService } from './sla.service';
import { SlaBreachQueryDto } from './dto/sla-breach-query.dto';

@Controller('sla')
export class SlaController {
  constructor(private readonly slaService: SlaService) {}

  /** SLA metrics for a single order */
  @Get('orders/:orderId')
  getOrderMetrics(@Param('orderId') orderId: string) {
    return this.slaService.getOrderMetrics(orderId);
  }

  /** All breached records, filterable */
  @Get('breaches')
  queryBreaches(@Query() query: SlaBreachQueryDto) {
    return this.slaService.queryBreaches(query);
  }

  /** Breach summary grouped by hospital */
  @Get('reports/by-hospital')
  byHospital(@Query() query: SlaBreachQueryDto) {
    return this.slaService.getBreachSummary('hospitalId', query);
  }

  /** Breach summary grouped by blood bank */
  @Get('reports/by-blood-bank')
  byBloodBank(@Query() query: SlaBreachQueryDto) {
    return this.slaService.getBreachSummary('bloodBankId', query);
  }

  /** Breach summary grouped by rider */
  @Get('reports/by-rider')
  byRider(@Query() query: SlaBreachQueryDto) {
    return this.slaService.getBreachSummary('riderId', query);
  }

  /** Breach summary grouped by urgency tier */
  @Get('reports/by-urgency')
  byUrgency(@Query() query: SlaBreachQueryDto) {
    return this.slaService.getBreachSummary('urgencyTier', query);
  }
}
