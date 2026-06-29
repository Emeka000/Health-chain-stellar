import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SlaService } from './sla.service';
import { SlaBreachQueryDto } from './dto/sla-breach-query.dto';

@ApiTags('SLA')
@ApiBearerAuth()
@Controller('sla')
export class SlaController {
  constructor(private readonly slaService: SlaService) {}

  @ApiOperation({ summary: 'Get SLA metrics for a single order' })
  @ApiResponse({ status: 200, description: 'SLA metrics for the order' })
  @Get('orders/:orderId')
  getOrderMetrics(@Param('orderId') orderId: string) {
    return this.slaService.getOrderMetrics(orderId);
  }

  @ApiOperation({ summary: 'Query all breached SLA records' })
  @ApiResponse({ status: 200, description: 'List of breached SLA records' })
  @Get('breaches')
  queryBreaches(@Query() query: SlaBreachQueryDto) {
    return this.slaService.queryBreaches(query);
  }

  @ApiOperation({ summary: 'SLA breach summary grouped by hospital' })
  @ApiResponse({ status: 200, description: 'Breach summary by hospital' })
  @Get('reports/by-hospital')
  byHospital(@Query() query: SlaBreachQueryDto) {
    return this.slaService.getBreachSummary('hospitalId', query);
  }

  @ApiOperation({ summary: 'SLA breach summary grouped by blood bank' })
  @ApiResponse({ status: 200, description: 'Breach summary by blood bank' })
  @Get('reports/by-blood-bank')
  byBloodBank(@Query() query: SlaBreachQueryDto) {
    return this.slaService.getBreachSummary('bloodBankId', query);
  }

  @ApiOperation({ summary: 'SLA breach summary grouped by rider' })
  @ApiResponse({ status: 200, description: 'Breach summary by rider' })
  @Get('reports/by-rider')
  byRider(@Query() query: SlaBreachQueryDto) {
    return this.slaService.getBreachSummary('riderId', query);
  }

  @ApiOperation({ summary: 'SLA breach summary grouped by urgency tier' })
  @ApiResponse({ status: 200, description: 'Breach summary by urgency tier' })
  @Get('reports/by-urgency')
  byUrgency(@Query() query: SlaBreachQueryDto) {
    return this.slaService.getBreachSummary('urgencyTier', query);
  }
}
