import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IncidentReviewWorkflowService } from './incident-review-workflow.service';

@Injectable()
export class IncidentReviewSchedulerService {
    private readonly logger = new Logger(IncidentReviewSchedulerService.name);

    constructor(
        private readonly workflowService: IncidentReviewWorkflowService,
    ) { }

    /**
     * Run every hour to check for overdue incident reviews and escalate them
     */
    @Cron(CronExpression.EVERY_HOUR)
    async escalateOverdueIncidents(): Promise<void> {
        this.logger.log('Running scheduled escalation check for overdue incident reviews');
        try {
            await this.workflowService.escalateOverdueIncidents();
        } catch (error) {
            this.logger.error(
                `Failed to escalate overdue incidents: ${(error as Error).message}`,
                (error as Error).stack,
            );
        }
    }
}
