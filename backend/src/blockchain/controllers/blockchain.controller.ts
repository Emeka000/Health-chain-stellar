import { createHmac, timingSafeEqual } from 'crypto';

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  Req,
} from '@nestjs/common';

import { Request } from 'express';

import { BlockchainCallbackDto } from '../dto/blockchain-callback.dto';
import { AdminGuard } from '../guards/admin.guard';
import { QueueMetricsService } from '../services/queue-metrics.service';
import { SorobanService } from '../services/soroban.service';

import type {
  SorobanTxJob,
  QueueMetrics,
  SorobanTxResult,
} from '../types/soroban-tx.types';

@Controller('blockchain')
export class BlockchainController {
  private readonly logger = new Logger(BlockchainController.name);

  constructor(private sorobanService: SorobanService) {}

  /**
   * Submit a transaction to the Soroban queue.
   *
   * All contract calls must go through this endpoint.
   * Returns immediately with job ID for async status tracking.
   *
   * @param job - Transaction job with contractMethod, args, and idempotencyKey
   * @returns Job ID for status tracking
   * @throws 400 if idempotency key already exists (duplicate submission)
   */
  @Post('submit-transaction')
  @HttpCode(HttpStatus.ACCEPTED)
  async submitTransaction(
    @Body() job: SorobanTxJob,
  ): Promise<{ jobId: string }> {
    const jobId = await this.sorobanService.submitTransaction(job);
    return { jobId };
  }

  private canonicalizePayload(payload: Record<string, unknown>): string {
    const sorted = Object.keys(payload)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const value = payload[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          acc[key] = this.canonicalizePayload(value as Record<string, unknown>);
        } else {
          acc[key] = value;
        }
        return acc;
      }, {});

    return JSON.stringify(sorted);
  }

  private verifyWebhookSignature(
    payload: Record<string, unknown>,
    providedSignature?: string,
  ): void {
    if (!providedSignature) {
      this.logger.warn('Missing webhook signature header');
      throw new UnauthorizedException('Missing signature');
    }

    const secret = process.env.BLOCKCHAIN_CALLBACK_SECRET;
    if (!secret) {
      this.logger.error('BLOCKCHAIN_CALLBACK_SECRET is not configured');
      throw new BadRequestException('Server misconfiguration');
    }

    const canonicalized = this.canonicalizePayload(payload);
    const expectedSignature = createHmac('sha256', secret)
      .update(canonicalized)
      .digest('hex');

    const providedBuffer = Buffer.from(providedSignature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      this.logger.warn('Blockchain callback signature verification failed', {
        eventId: payload.eventId,
        ip: 'unknown',
        endpoint: '/blockchain/webhook/callback',
      });
      throw new UnauthorizedException('Invalid signature');
    }
  }

  @Post('webhook/callback')
  @HttpCode(HttpStatus.OK)
  async processCallback(
    @Body() callback: BlockchainCallbackDto,
    @Req() request: Request,
  ): Promise<{ success: boolean }> {
    this.verifyWebhookSignature(
      callback,
      request.headers['x-webhook-signature'] as string,
    );

    const eventTime = Date.parse(callback.timestamp);
    if (isNaN(eventTime)) {
      throw new BadRequestException('Invalid timestamp');
    }

    const ageMs = Math.abs(Date.now() - eventTime);
    const maxAgeMs = 5 * 60 * 1000;

    if (ageMs > maxAgeMs) {
      this.logger.warn('Blockchain callback rejected due to stale timestamp', {
        eventId: callback.eventId,
        timestamp: callback.timestamp,
        ageMs,
      });
      throw new BadRequestException('Callback is stale');
    }

    const replayAllowed =
      await this.sorobanService.checkAndSetCallbackIdempotency(
        callback.eventId,
      );

    if (!replayAllowed) {
      this.logger.warn('Blockchain callback replay detected', {
        eventId: callback.eventId,
      });
      throw new ConflictException('Replay callback detected');
    }

    await this.sorobanService.processWebhookCallback(callback);

    this.logger.log('Blockchain callback processed successfully', {
      eventId: callback.eventId,
      transactionHash: callback.transactionHash,
      status: callback.status,
    });

    return { success: true };
  }

  /**
   * Get real-time queue metrics (admin only).
   *
   * Protected by AdminGuard - requires admin authentication.
   * Returns current queue depth, failed jobs, and DLQ count.
   *
   * @returns Queue metrics
   * @throws 403 if not authenticated as admin
   */
  @Get('queue/status')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async getQueueStatus(): Promise<QueueMetrics> {
    return this.sorobanService.getQueueMetrics();
  }

  /**
   * Get status of a specific job.
   *
   * Returns current job state, error details, and retry count.
   *
   * @param jobId - Job ID to check
   * @returns Job status or null if not found
   */
  @Get('job/:jobId')
  @HttpCode(HttpStatus.OK)
  async getJobStatus(
    @Param('jobId') jobId: string,
  ): Promise<SorobanTxResult | null> {
    return this.sorobanService.getJobStatus(jobId);
  }

  /**
   * Get detailed queue metrics including counters and timings (admin only).
   *
   * Returns counters for queued, processing, success, failure, retries, DLQ
   * plus processing duration statistics (avg/min/max).
   *
   * @returns Detailed metrics object
   * @throws 403 if not authenticated as admin
   */
  @Get('metrics')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async getDetailedMetrics() {
    return this.queueMetricsService.getDetailedMetrics();
  }

  /**
   * Prometheus-compatible metrics scrape endpoint (admin only).
   *
   * Returns metrics in the Prometheus text exposition format so any
   * Prometheus-compatible scraper (Grafana, Datadog agent, etc.) can
   * consume them without additional configuration.
   *
   * @returns Plain-text Prometheus metrics
   * @throws 403 if not authenticated as admin
   */
  @Get('metrics/prometheus')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getPrometheusMetrics(): Promise<string> {
    const m = await this.queueMetricsService.getDetailedMetrics();
    const lines: string[] = [
      '# HELP soroban_queue_jobs_queued_total Total jobs added to the main queue',
      '# TYPE soroban_queue_jobs_queued_total counter',
      `soroban_queue_jobs_queued_total ${m.counters.queued}`,
      '',
      '# HELP soroban_queue_jobs_processing_current Jobs currently being processed',
      '# TYPE soroban_queue_jobs_processing_current gauge',
      `soroban_queue_jobs_processing_current ${m.counters.processing}`,
      '',
      '# HELP soroban_queue_jobs_success_total Jobs completed successfully',
      '# TYPE soroban_queue_jobs_success_total counter',
      `soroban_queue_jobs_success_total ${m.counters.success}`,
      '',
      '# HELP soroban_queue_jobs_failure_total Jobs that failed at least once',
      '# TYPE soroban_queue_jobs_failure_total counter',
      `soroban_queue_jobs_failure_total ${m.counters.failure}`,
      '',
      '# HELP soroban_queue_jobs_retries_total Total retry attempts across all jobs',
      '# TYPE soroban_queue_jobs_retries_total counter',
      `soroban_queue_jobs_retries_total ${m.counters.retries}`,
      '',
      '# HELP soroban_queue_jobs_dlq_total Jobs moved to the dead-letter queue',
      '# TYPE soroban_queue_jobs_dlq_total counter',
      `soroban_queue_jobs_dlq_total ${m.counters.dlq}`,
      '',
      '# HELP soroban_queue_processing_duration_avg_ms Average job processing duration in ms',
      '# TYPE soroban_queue_processing_duration_avg_ms gauge',
      `soroban_queue_processing_duration_avg_ms ${m.timings.avgMs}`,
      '',
      '# HELP soroban_queue_processing_duration_min_ms Minimum job processing duration in ms',
      '# TYPE soroban_queue_processing_duration_min_ms gauge',
      `soroban_queue_processing_duration_min_ms ${m.timings.minMs}`,
      '',
      '# HELP soroban_queue_processing_duration_max_ms Maximum job processing duration in ms',
      '# TYPE soroban_queue_processing_duration_max_ms gauge',
      `soroban_queue_processing_duration_max_ms ${m.timings.maxMs}`,
      '',
      '# HELP soroban_queue_waiting_jobs Live count of waiting jobs in main queue',
      '# TYPE soroban_queue_waiting_jobs gauge',
      `soroban_queue_waiting_jobs ${m.live.waiting}`,
      '',
      '# HELP soroban_queue_active_jobs Live count of active jobs in main queue',
      '# TYPE soroban_queue_active_jobs gauge',
      `soroban_queue_active_jobs ${m.live.active}`,
      '',
      '# HELP soroban_queue_failed_jobs Live count of failed jobs in main queue',
      '# TYPE soroban_queue_failed_jobs gauge',
      `soroban_queue_failed_jobs ${m.live.failed}`,
      '',
      '# HELP soroban_queue_delayed_jobs Live count of delayed (backoff) jobs',
      '# TYPE soroban_queue_delayed_jobs gauge',
      `soroban_queue_delayed_jobs ${m.live.delayed}`,
      '',
      '# HELP soroban_queue_dlq_depth Live depth of the dead-letter queue',
      '# TYPE soroban_queue_dlq_depth gauge',
      `soroban_queue_dlq_depth ${m.live.dlqDepth}`,
    ];
    return lines.join('\n');
  }
}
