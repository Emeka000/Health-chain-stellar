import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { IncidentReviewsService } from '../incident-reviews.service';
import { IncidentRootCause } from '../enums/incident-root-cause.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';

/**
 * Event payload when a compliance violation is detected
 */
export interface ComplianceViolationEvent {
    violationId: string;
    orderId?: string;
    riderId?: string;
    hospitalId?: string;
    bloodBankId?: string;
    violationType: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    metadata?: Record<string, unknown>;
}

/**
 * Auto-creates incident reviews from compliance violations
 */
@Injectable()
export class ComplianceViolationListener {
    private readonly logger = new Logger(ComplianceViolationListener.name);

    constructor(private readonly incidentService: IncidentReviewsService) { }

    @OnEvent('compliance.violation.detected', { async: true })
    async handleComplianceViolation(
        event: ComplianceViolationEvent,
    ): Promise<void> {
        try {
            const severityMap: Record<string, IncidentSeverity> = {
                low: IncidentSeverity.LOW,
                medium: IncidentSeverity.MEDIUM,
                high: IncidentSeverity.HIGH,
                critical: IncidentSeverity.CRITICAL,
            };

            const severity = severityMap[event.severity] ?? IncidentSeverity.MEDIUM;

            const dueDate = new Date();
            dueDate.setDate(
                dueDate.getDate() + (severity === IncidentSeverity.CRITICAL ? 1 : 5),
            );

            await this.incidentService.autoCreateFromComplianceViolation({
                violationId: event.violationId,
                orderId: event.orderId ?? 'unknown',
                riderId: event.riderId ?? null,
                hospitalId: event.hospitalId ?? null,
                bloodBankId: event.bloodBankId ?? null,
                rootCause: IncidentRootCause.COMPLIANCE_VIOLATION,
                severity,
                description: `Auto-created from compliance violation: ${event.description}`,
                dueDate,
                metadata: event.metadata ?? null,
            });

            this.logger.log(
                `Auto-created incident review from compliance violation ${event.violationId}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to auto-create incident from compliance violation ${event.violationId}`,
                error,
            );
        }
    }
}
