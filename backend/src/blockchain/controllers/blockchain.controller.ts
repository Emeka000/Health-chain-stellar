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
  Header,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Request } from 'express';

import { RequireAdminScope } from '../decorators/require-admin-scope.decorator';
import { BlockchainCallbackDto } from '../dto/blockchain-callback.dto';
import { SubmitTransactionDto } from '../dto/submit-transaction.dto';
import { AdminScope } from '../enums/admin-scope.enum';
import { AdminGuard } from '../guards/admin.guard';
import { BlockchainHealthService } from '../services/blockchain-health.service';
import { DlqReplayAuditService } from '../services/dlq-replay-audit.service';
import { FailedSorobanTxService } from '../services/failed-soroban-tx.service';
import { QueueMetricsService } from '../services/queue-metrics.service';
import { SorobanService } from '../services/soroban.service';
import { Public } from '../../auth/decorators/public.decorator';

import type { QueueMetrics, SorobanTxResult } from '../types/soroban-tx.types';

@ApiTags('Blockchain')
@ApiBearerAuth()
@Controller('blockchain')
export class BlockchainController {
  private readonly logger = new Logger(BlockchainController.name);

  constructor(
    private sorobanService: SorobanService,
    private configService: ConfigService,
    private queueMetricsService: QueueMetricsService,
    private failedTxService: FailedSorobanTxService,
    private blockchainHealthService: BlockchainHealthService,
    private dlqReplayAuditService: DlqReplayAuditService,
  ) {}

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
  @ApiOperation({ summary: 'Post submit transaction' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('submit-transaction')
  @UseGuards(AdminGuard)
  @RequireAdminScope(AdminScope.ADMIN_FULL)
  @HttpCode(HttpStatus.ACCEPTED)
  async submitTransaction(
    @Body() job: SubmitTransactionDto,
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

    const secret = this.configService.get<string>('BLOCKCHAIN_CALLBACK_SECRET');
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

  @ApiOperation({ summary: 'Post webhook callback' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('webhook/callback')
  @Public()
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

    // Only reject a replay once the callback has actually been processed.
    // The idempotency key is set after successful processing so that a
    // failed attempt can be retried with the same eventId.
    const alreadyProcessed =
      await this.sorobanService.isCallbackProcessed(callback.eventId);

    if (alreadyProcessed) {
      this.logger.warn('Blockchain callback replay detected', {
        eventId: callback.eventId,
      });
      throw new ConflictException('Replay callback detected');
    }

    await this.sorobanService.processWebhookCallback(callback);

    await this.sorobanService.markCallbackProcessed(callback.eventId);

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
  @ApiOperation({ summary: 'Get queue status' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('queue/status')
  @UseGuards(AdminGuard)
  @RequireAdminScope(AdminScope.READ_METRICS)
  @HttpCode(HttpStatus.OK)
  async getQueueStatus(): Promise<QueueMetrics> {
    return this.sorobanService.getQueueMetrics();
  }

  /**
   * Get status of a specific job (admin only).
   *
   * Returns current job state, error details, and retry count.
   * Protected by AdminGuard - requires admin authentication, since a job's
   * data contains the contract method, its arguments and metadata.
   *
   * @param jobId - Job ID to check
   * @returns Job status or null if not found
   * @throws 403 if not authenticated as admin
   */
  @ApiOperation({ summary: 'Get job :jobId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Get('job/:jobId')
  @UseGuards(AdminGuard)
  @RequireAdminScope(AdminScope.READ_METRICS)
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
  @ApiOperation({ summary: 'Get metrics' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
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
   * @returns Plai

/* … truncated 6794 chars — edit only what you need near the top … */
