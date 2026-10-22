import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between, LessThan } from 'typeorm';
import {
    CanonicalEventEnvelope,
    DeadLetterReason,
    ErrorCategory,
    ReplayRequest,
    ReplayResult,
} from './canonical-event.envelope';
import { DeadLetterEventEntity } from './entities/dead-letter-event.entity';

/**
 * Dead Letter Service
 * 
 * Manages dead-letter events and replay functionality
 */
@Injectable()
export class DeadLetterService {
    private readonly logger = new Logger(DeadLetterService.name);

    // Poison message threshold - if an event fails this many times, mark as poison
    private readonly POISON_MESSAGE_THRESHOLD = 5;

    constructor(
        @InjectRepository(DeadLetterEventEntity)
        private readonly deadLetterRepo: Repository<DeadLetterEventEntity>,
    ) { }

    /**
     * Store an event in dead-letter storage
     */
    async storeDeadLetter(params: {
        originalEvent: CanonicalEventEnvelope;
        reason: DeadLetterReason;
        errorCategory: ErrorCategory;
        errorMessage: string;
        errorStack?: string;
        failedConsumer: string;
        attemptCount: number;
        diagnostics?: Record<string, unknown>;
    }): Promise<DeadLetterEventEntity> {
        // Check if this event has been dead-lettered before
        const existingCount = await this.deadLetterRepo.count({
            where: {
                eventId: params.originalEvent.metadata.eventId,
            },
        });

        const isPoisonMessage = existingCount >= this.POISON_MESSAGE_THRESHOLD;

        const deadLetter = this.deadLetterRepo.create({
            eventId: params.originalEvent.metadata.eventId,
            eventType: params.originalEvent.metadata.eventType,
            schemaVersion: params.originalEvent.metadata.schemaVersion,
            correlationId: params.originalEvent.metadata.correlationId,
            originalEvent: params.originalEvent,
            deadLetteredAt: new Date(),
            deadLetterReason: params.reason,
            errorCategory: params.errorCategory,
            errorMessage: params.errorMessage,
            errorStack: params.errorStack || null,
            failedConsumer: params.failedConsumer,
            attemptCount: params.attemptCount,
            isReplayable: this.isReplayable(params.reason, params.errorCategory),
            isPoisonMessage,
            diagnostics: params.diagnostics || null,
            replayed: false,
            replayedAt: null,
            replayResult: null,
            replayError: null,
            replayAttemptCount: 0,
        });

        const saved = await this.deadLetterRepo.save(deadLetter);

        if (isPoisonMessage) {
            this.logger.error(
                `Poison message detected: eventId=${params.originalEvent.metadata.eventId}, eventType=${params.originalEvent.metadata.eventType}, failures=${existingCount + 1}`,
            );
        } else {
            this.logger.warn(
                `Event dead-lettered: eventId=${params.originalEvent.metadata.eventId}, reason=${params.reason}, consumer=${params.failedConsumer}`,
            );
        }

        return saved;
    }

    /**
     * Query dead-letter events
     */
    async queryDeadLetters(params: {
        eventTypes?: string[];
        deadLetterReasons?: DeadLetterReason[];
        errorCategories?: ErrorCategory[];
        startTime?: Date;
        endTime?: Date;
        isReplayable?: boolean;
        isPoisonMessage?: boolean;
        replayed?: boolean;
        limit?: number;
    }): Promise<DeadLetterEventEntity[]> {
        const qb = this.deadLetterRepo.createQueryBuilder('dl');

        if (params.eventTypes && params.eventTypes.length > 0) {
            qb.andWhere('dl.event_type IN (:...eventTypes)', {
                eventTypes: params.eventTypes,
            });
        }

        if (params.deadLetterReasons && params.deadLetterReasons.length > 0) {
            qb.andWhere('dl.dead_letter_reason IN (:...reasons)', {
                reasons: params.deadLetterReasons,
            });
        }

        if (params.errorCategories && params.errorCategories.length > 0) {
            qb.andWhere('dl.error_category IN (:...categories)', {
                categories: params.errorCategories,
            });
        }

        if (params.startTime) {
            qb.andWhere('dl.dead_lettered_at >= :startTime', {
                startTime: params.startTime,
            });
        }

        if (params.endTime) {
            qb.andWhere('dl.dead_lettered_at <= :endTime', {
                endTime: params.endTime,
            });
        }

        if (params.isReplayable !== undefined) {
            qb.andWhere('dl.is_replayable = :isReplayable', {
                isReplayable: params.isReplayable,
            });
        }

        if (params.isPoisonMessage !== undefined) {
            qb.andWhere('dl.is_poison_message = :isPoisonMessage', {
                isPoisonMessage: params.isPoisonMessage,
            });
        }

        if (params.replayed !== undefined) {
            qb.andWhere('dl.replayed = :replayed', { replayed: params.replayed });
        }

        qb.orderBy('dl.dead_lettered_at', 'DESC');

        if (params.limit) {
            qb.limit(params.limit);
        }

        return qb.getMany();
    }

    /**
     * Replay dead-letter events
     */
    async replayDeadLetters(
        request: ReplayRequest,
        replayHandler: (event: CanonicalEventEnvelope) => Promise<void>,
    ): Promise<ReplayResult> {
        // Query events to replay
        const events = await this.queryDeadLetters({
            eventTypes: request.eventTypes,
            deadLetterReasons: request.deadLetterReasons,
            errorCategories: request.errorCategories,
            startTime: request.timeWindow?.startTime
                ? new Date(request.timeWindow.startTime)
                : undefined,
            endTime: request.timeWindow?.endTime
                ? new Date(request.timeWindow.endTime)
                : undefined,
            isReplayable: true,
            isPoisonMessage: request.skipPoisonMessages ? false : undefined,
            replayed: false,
            limit: request.limit,
        });

        // Filter by specific event IDs if provided
        let eventsToReplay = events;
        if (request.eventIds && request.eventIds.length > 0) {
            eventsToReplay = events.filter((e) =>
                request.eventIds!.includes(e.eventId),
            );
        }

        const result: ReplayResult = {
            selectedCount: eventsToReplay.length,
            successCount: 0,
            failureCount: 0,
            skippedCount: 0,
            replayedEventIds: [],
            failedEventIds: [],
            skippedEventIds: [],
            errors: [],
        };

        // Dry run mode - just return what would be replayed
        if (request.dryRun) {
            result.replayedEventIds = eventsToReplay.map((e) => e.eventId);
            return result;
        }

        // Replay events
        for (const deadLetter of eventsToReplay) {
            // Skip poison messages if requested
            if (request.skipPoisonMessages && deadLetter.isPoisonMessage) {
                result.skippedCount++;
                result.skippedEventIds.push(deadLetter.eventId);
                continue;
            }

            try {
                // Increment replay attempt count
                await this.deadLetterRepo.update(deadLetter.id, {
                    replayAttemptCount: deadLetter.replayAttemptCount + 1,
                });

                // Replay the event
                await replayHandler(deadLetter.originalEvent);

                // Mark as successfully replayed
                await this.deadLetterRepo.update(deadLetter.id, {
                    replayed: true,
                    replayedAt: new Date(),
                    replayResult: 'SUCCESS',
                    replayError: null,
                });

                result.successCount++;
                result.replayedEventIds.push(deadLetter.eventId);

                this.logger.log(
                    `Successfully replayed event: ${deadLetter.eventId} (${deadLetter.eventType})`,
                );
            } catch (error) {
                const errorMessage = (error as Error).message;

                // Mark replay as failed
                await this.deadLetterRepo.update(deadLetter.id, {
                    replayResult: 'FAILURE',
                    replayError: errorMessage,
                });

                result.failureCount++;
                result.failedEventIds.push(deadLetter.eventId);
                result.errors.push({
                    eventId: deadLetter.eventId,
                    error: errorMessage,
                });

                this.logger.error(
                    `Failed to replay event: ${deadLetter.eventId} (${deadLetter.eventType})`,
                    error,
                );
            }
        }

        this.logger.log(
            `Replay completed: ${result.successCount} succeeded, ${result.failureCount} failed, ${result.skippedCount} skipped`,
        );

        return result;
    }

    /**
     * Get dead-letter statistics
     */
    async getStatistics(params?: {
        startTime?: Date;
        endTime?: Date;
    }): Promise<{
        totalCount: number;
        byEventType: Record<string, number>;
        byReason: Record<string, number>;
        byErrorCategory: Record<string, number>;
        replayableCount: number;
        poisonMessageCount: number;
        replayedCount: number;
    }> {
        const qb = this.deadLetterRepo.createQueryBuilder('dl');

        if (params?.startTime) {
            qb.andWhere('dl.dead_lettered_at >= :startTime', {
                startTime: params.startTime,
            });
        }

        if (params?.endTime) {
            qb.andWhere('dl.dead_lettered_at <= :endTime', {
                endTime: params.endTime,
            });
        }

        const events = await qb.getMany();

        const byEventType: Record<string, number> = {};
        const byReason: Record<string, number> = {};
        const byErrorCategory: Record<string, number> = {};

        let replayableCount = 0;
        let poisonMessageCount = 0;
        let replayedCount = 0;

        for (const event of events) {
            byEventType[event.eventType] = (byEventType[event.eventType] || 0) + 1;
            byReason[event.deadLetterReason] =
                (byReason[event.deadLetterReason] || 0) + 1;
            byErrorCategory[event.errorCategory] =
                (byErrorCategory[event.errorCategory] || 0) + 1;

            if (event.isReplayable) replayableCount++;
            if (event.isPoisonMessage) poisonMessageCount++;
            if (event.replayed) replayedCount++;
        }

        return {
            totalCount: events.length,
            byEventType,
            byReason,
            byErrorCategory,
            replayableCount,
            poisonMessageCount,
            replayedCount,
        };
    }

    /**
     * Purge old dead-letter events
     */
    async purgeOldEvents(olderThanDays: number): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

        const result = await this.deadLetterRepo.delete({
            deadLetteredAt: LessThan(cutoffDate),
            replayed: true,
        });

        const deletedCount = result.affected || 0;

        this.logger.log(
            `Purged ${deletedCount} dead-letter events older than ${olderThanDays} days`,
        );

        return deletedCount;
    }

    /**
     * Determine if an event is replayable based on reason and error category
     */
    private isReplayable(
        reason: DeadLetterReason,
        errorCategory: ErrorCategory,
    ): boolean {
        // Permanent errors are not replayable
        if (errorCategory === ErrorCategory.PERMANENT) {
            return false;
        }

        // Malformed envelopes are not replayable
        if (reason === DeadLetterReason.MALFORMED_ENVELOPE) {
            return false;
        }

        // Unsupported versions may become replayable after upgrade
        if (reason === DeadLetterReason.UNSUPPORTED_VERSION) {
            return true;
        }

        // Schema validation failures may become replayable after schema update
        if (reason === DeadLetterReason.SCHEMA_VALIDATION_FAILED) {
            return true;
        }

        // Transient errors are replayable
        if (errorCategory === ErrorCategory.TRANSIENT) {
            return true;
        }

        // Default to replayable for unknown cases
        return true;
    }
}
