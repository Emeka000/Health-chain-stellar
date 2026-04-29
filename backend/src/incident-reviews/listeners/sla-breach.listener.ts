import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { IncidentReviewsService } from '../incident-reviews.service';
import { IncidentRootCause } from '../enums/incident-root-cause.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';

/**
 * Event payload when an SLA breach occurs
 */
export interface SlaBreachEvent {
    breachId: string;
    orderId: string;
    riderId?: string;
    hospitalId?: string;
    bloodBankId?: string;
    breachType: string;
    breachMinutes: number;
    description: string;
    metadata?: Record<string, unknown>;
}

/**
 * Auto-creates incident reviews from SLA breaches
 */
@Injectable()
export class SlaBreachListener {
    private readonly logger = new Logger(SlaBreachListener.name);

    constructor(private readonly incidentService: IncidentReviewsService) { }

    @OnEvent('sla.breach.detected', { async: true })
    async handleSlaBreach(event: SlaBreachEvent): Promise<void> {
        try {
            // Determine severity based on breach magnitude
            let severity = IncidentSeverity.MEDIUM;
            if (event.breachMinutes > 60) {
                severity = IncidentSeverity.HIGH;
            }
            if (event.breachMinutes > 120) {
                severity = IncidentSeverity.CRITICAL;
            }

            const dueDate = new Date();
            dueDate.setDate(
                dueDate.getDate() + (severity === IncidentSeverity.CRITICAL ? 1 : 3),
            );

            await this.incidentService.autoCreateFromSlaBreac({
                slaBreachId: event.breachId,
                orderId: event.orderId,
                riderId: event.riderId ?? null,
                hospitalId: event.hospitalId ?? null,
                bloodBankId: event.bloodBankId ?? null,
                rootCause: IncidentRootCause.SLA_BREACH,
                severity,
                description: `Auto-created from SLA breach: ${event.description} (${event.breachMinutes} min over)`,
                dueDate,
                metadata: event.metadata ?? null,
            });

            this.logger.log(
                `Auto-created incident review from SLA breach ${event.breachId}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to auto-create incident from SLA breach ${event.breachId}`,
                error,
            );
        }
    }
}
