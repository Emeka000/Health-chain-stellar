import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AnomalySeverity } from '../../anomaly/enums/anomaly-type.enum';

import { IncidentReviewsService } from '../incident-reviews.service';
import { IncidentRootCause } from '../enums/incident-root-cause.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';

/**
 * Event payload when a severe anomaly is detected
 */
export interface AnomalyDetectedEvent {
    anomalyId: string;
    type: string;
    severity: AnomalySeverity;
    orderId?: string;
    riderId?: string;
    hospitalId?: string;
    bloodBankId?: string;
    description: string;
    metadata?: Record<string, unknown>;
}

/**
 * Auto-creates incident reviews from severe anomaly detections
 */
@Injectable()
export class AnomalyIncidentListener {
    private readonly logger = new Logger(AnomalyIncidentListener.name);

    constructor(private readonly incidentService: IncidentReviewsService) { }

    @OnEvent('anomaly.detected.high', { async: true })
    @OnEvent('anomaly.detected.critical', { async: true })
    async handleSevereAnomaly(event: AnomalyDetectedEvent): Promise<void> {
        try {
            const severity =
                event.severity === AnomalySeverity.HIGH
                    ? IncidentSeverity.HIGH
                    : IncidentSeverity.CRITICAL;

            const dueDate = new Date();
            dueDate.setDate(
                dueDate.getDate() + (severity === IncidentSeverity.CRITICAL ? 1 : 3),
            );

            await this.incidentService.autoCreateFromAnomaly({
                anomalyId: event.anomalyId,
                orderId: event.orderId ?? 'unknown',
                riderId: event.riderId ?? null,
                hospitalId: event.hospitalId ?? null,
                bloodBankId: event.bloodBankId ?? null,
                rootCause: IncidentRootCause.ANOMALY_DETECTED,
                severity,
                description: `Auto-created from anomaly: ${event.description}`,
                dueDate,
                metadata: event.metadata ?? null,
            });

            this.logger.log(
                `Auto-created incident review from anomaly ${event.anomalyId}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to auto-create incident from anomaly ${event.anomalyId}`,
                error,
            );
        }
    }
}
