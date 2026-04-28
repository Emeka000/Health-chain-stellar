import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { ContractEventIndexerService } from './contract-event-indexer.service';
import {
  CursorResetDto,
  DiscardPoisonEventDto,
  IngestEventDto,
  QueryContractEventsDto,
  QuarantinePoisonEventDto,
  ReplayFromLedgerDto,
  ReplayPoisonEventDto,
  VerifyIndexedDto,
} from './dto/contract-event.dto';
import { PoisonEventStatus } from './entities/poison-event.entity';

@Controller('api/v1/contract-events')
export class ContractEventIndexerController {
  constructor(private readonly service: ContractEventIndexerService) {}

  /** Ingest a single contract event (idempotent — duplicates are silently ignored) */
  @Post('ingest')
  ingest(@Body() dto: IngestEventDto) {
    return this.service.ingest(dto);
  }

  /** Ingest a batch of contract events */
  @Post('ingest/batch')
  ingestBatch(@Body() events: IngestEventDto[]) {
    return this.service.ingestBatch(events);
  }

  /** Query indexed contract events with optional filters */
  @Get()
  findAll(@Query() query: QueryContractEventsDto) {
    return this.service.findAll(query);
  }

  /** Get all events for a specific off-chain entity (order, donor, etc.) */
  @Get('entity/:ref')
  findByEntityRef(@Param('ref') ref: string) {
    return this.service.findByEntityRef(ref);
  }

  /** Get current indexer cursor positions per domain+projection */
  @Get('cursors')
  getCursors() {
    return this.service.getCursors();
  }

  /** Replay: delete events from a ledger height and reset cursors for re-ingestion */
  @Post('replay')
  replay(@Body() dto: ReplayFromLedgerDto) {
    return this.service.replayFromLedger(dto);
  }

  // ── Chain reorg / cursor recovery ────────────────────────────────────

  /**
   * Reset cursor(s) to a specific ledger without deleting indexed events.
   * Use when a cursor is corrupted but events are still valid.
   */
  @Post('cursors/reset')
  resetCursor(@Body() dto: CursorResetDto) {
    return this.service.resetCursor(dto);
  }

  /**
   * Verify indexed data integrity for a ledger range.
   * Returns event count and any ledger gaps.
   */
  @Post('verify')
  verifyIndexed(@Body() dto: VerifyIndexedDto) {
    return this.service.verifyIndexed(dto);
  }

  // ── Poison-event operator endpoints ──────────────────────────────────

  /** List quarantined poison events (optionally filtered by status) */
  @Get('poison-events')
  getPoisonEvents(@Query('status') status?: PoisonEventStatus) {
    return this.service.getPoisonEvents(status);
  }

  /** Quarantine a poison event (called by projection workers on failure) */
  @Post('poison-events/quarantine')
  quarantine(@Body() dto: QuarantinePoisonEventDto) {
    return this.service.quarantinePoisonEvent(dto);
  }

  /** Operator: mark a poison event as replayed and re-process it */
  @Post('poison-events/replay')
  replayPoison(@Body() dto: ReplayPoisonEventDto) {
    return this.service.replayPoisonEvent(dto);
  }

  /** Operator: discard a poison event (no further processing) */
  @Post('poison-events/discard')
  discardPoison(@Body() dto: DiscardPoisonEventDto) {
    return this.service.discardPoisonEvent(dto);
  }
}
