import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { IncidentReviewsService } from './incident-reviews.service';

/**
 * Scheduler for incident review workflow automation
 */
@Injectable()
export class IncidentWorkflowScheduler {
    private readonly logger = new Logger(IncidentWorkflowScheduler.name);

    constructor(private readonly incidentService: IncidentReviewsService) { }

    /**
     * Check for overdue actions every hour and escalate as needed
     */
    @Cron(CronExpression.EVERY_HOUR)
    async checkOverdueActions(): Promise<void> {
        this.logger.log('Running overdue action check...');
        try {
            await this.incidentService.checkOverdueActions();
            this.logger.log('Overdue action check completed');
        } catch (error) {
            this.logger.error('Failed to check overdue actions', error);
        }
    }
}
