import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { DeadLetterStatus } from './outbox-dead-letter.entity';
import { OutboxService } from './outbox.service';

@Controller('api/v1/outbox')
export class OutboxController {
  constructor(private readonly outboxService: OutboxService) {}

  /** List dead-lettered events (optionally filtered by status) */
  @Get('dead-letters')
  getDeadLetters(@Query('status') status?: DeadLetterStatus) {
    return this.outboxService.getDeadLetters(status);
  }

  /** Operator: replay a dead-lettered event */
  @Post('dead-letters/:id/replay')
  replayDeadLetter(
    @Param('id') id: string,
    @Body('operatorNotes') operatorNotes?: string,
  ) {
    return this.outboxService.replayDeadLetter(id, operatorNotes);
  }

  /** Operator: discard a dead-lettered event */
  @Post('dead-letters/:id/discard')
  discardDeadLetter(
    @Param('id') id: string,
    @Body('operatorNotes') operatorNotes?: string,
  ) {
    return this.outboxService.discardDeadLetter(id, operatorNotes);
  }
}
