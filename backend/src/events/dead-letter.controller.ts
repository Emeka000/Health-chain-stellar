import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Query,
} from '@nestjs/common';
import { DeadLetterService } from './dead-letter.service';
import {
    DeadLetterReason,
    ErrorCategory,
    ReplayRequest,
} from './canonical-event.envelope';
import { CanonicalEventEmitterService } from './canonical-event-emitter.service';

@Controller('api/v1/dead-letter')
export class DeadLetterController {
    constructor(
        private readonly deadLetterService: DeadLetterService,
        private readonly eventEmitter: CanonicalEventEmitterService,
    ) { }

    /**
     * Query dead-letter events
     */
    @Get()
    async queryDeadLetters(
        @Query('eventTypes') eventTypes?: string,
        @Query('deadLetterReasons') deadLetterReasons?: string,
        @Query('errorCategories') errorCategories?: string,
        @Query('startTime') startTime?: string,
        @Query('endTime') endTime?: string,
        @Query('isReplayable') isReplayable?: string,
        @Query('isPoisonMessage') isPoisonMessage?: string,
        @Query('replayed') replayed?: string,
        @Query('limit') limit?: string,
    ) {
        return this.deadLetterService.queryDeadLetters({
            eventTypes: eventTypes ? eventTypes.split(',') : undefined,
            deadLetterReasons: deadLetterReasons
                ? (deadLetterReasons.split(',') as DeadLetterReason[])
                : undefined,
            errorCategories: errorCategories
                ? (errorCategories.split(',') as ErrorCategory[])
                : undefined,
            startTime: startTime ? new Date(startTime) : undefined,
            endTime: endTime ? new Date(endTime) : undefined,
            isReplayable: isReplayable ? isReplayable === 'true' : undefined,
            isPoisonMessage: isPoisonMessage ? isPoisonMessage === 'true' : undefined,
            replayed: replayed ? replayed === 'true' : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    /**
     * Get dead-letter statistics
     */
    @Get('statistics')
    async getStatistics(
        @Query('startTime') startTime?: string,
        @Query('endTime') endTime?: string,
    ) {
        return this.deadLetterService.getStatistics({
            startTime: startTime ? new Date(startTime) : undefined,
            endTime: endTime ? new Date(endTime) : undefined,
        });
    }

    /**
     * Get a specific dead-letter event
     */
    @Get(':id')
    async getDeadLetter(@Param('id') id: string) {
        const events = await this.deadLetterService.queryDeadLetters({
            limit: 1,
        });
        return events.find((e) => e.id === id);
    }

    /**
     * Replay dead-letter events
     */
    @Post('replay')
    async replayDeadLetters(@Body() request: ReplayRequest) {
        return this.deadLetterService.replayDeadLetters(
            request,
            async (event) => {
                // Re-emit the event
                await this.eventEmitter.emit(event, { skipValidation: false });
            },
        );
    }

    /**
     * Purge old dead-letter events
     */
    @Delete('purge')
    async purgeOldEvents(@Query('olderThanDays') olderThanDays: string) {
        const days = parseInt(olderThanDays, 10) || 30;
        return {
            deletedCount: await this.deadLetterService.purgeOldEvents(days),
        };
    }
}
