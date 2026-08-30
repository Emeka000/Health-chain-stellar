import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { DeadLetterStatus } from './outbox-dead-letter.entity';
import { OutboxService } from './outbox.service';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('api/v1/outbox')
export class OutboxController {
  constructor(private readonly outboxService: OutboxService) {}

  /** List dead-lettered events (optionally filtered by status) */
  @ApiOperation({ summary: 'Get dead letters' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('dead-letters')
  getDeadLetters(@Query('status') status?: DeadLetterStatus) {
    return this.outboxService.getDeadLetters(status);
  }

  /** Operator: replay a dead-lettered event */
  @ApiOperation({ summary: 'Post dead letters :id replay' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('dead-letters/:id/replay')
  replayDeadLetter(
    @Param('id') id: string,
    @Body('operatorNotes') operatorNotes?: string,
  ) {
    return this.outboxService.replayDeadLetter(id, operatorNotes);
  }

  /** Operator: discard a dead-lettered event */
  @ApiOperation({ summary: 'Post dead letters :id discard' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('dead-letters/:id/discard')
  discardDeadLetter(
    @Param('id') id: string,
    @Body('operatorNotes') operatorNotes?: string,
  ) {
    return this.outboxService.discardDeadLetter(id, operatorNotes);
  }
}
