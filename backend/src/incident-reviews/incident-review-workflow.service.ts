import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { IncidentReviewEntity } from './entities/incident-review.entity';
import { CorrectiveActionEntity } from './entities/corrective-action.entity';
import { IncidentReviewStatus } from './enums/incident-review-status.enum';
import { IncidentRootCause } from './enums/incident-root-cause.enum';
import { IncidentSeverity } from './enums/incident-severity.enum';
import { CorrectiveActionStatus } from './entities/corrective-action.entity';

export interface AutoCreateIncidentInput {
    orderId?: string;
    riderId?: string;
    hospitalId?: string;
    bloodBankId?: string;
    rootCause: IncidentRootCause;
    severity: IncidentSeverity;
    description: string;
    linkedAnomalyId?: string;
    linkedSlaBreachId?: string;
    linkedOrderIds?: string[];
    linkedTelemetryIds?: string[];
    linkedPolicyIds?: string[];
    reportedByUserId: string;
    metadata?: Record<string, unknown>;
}

export interface EscalationInput {
    incidentReviewId: string;
    escalatedBy: string;
    reason: string;
}

export interface ClosureValidationInput {
    incidentReviewId: string;
    validatedBy: string;
    notes: string;
}

@Injectable()
export class IncidentReviewWorkflowService {
    private readonly logger = new Logger(IncidentReviewWorkflowService.name);

    constructor(
        @InjectRepository(IncidentReviewEntity)
        private readonly incidentRepo: Repository<IncidentReviewEntity>,
        @InjectRepository(CorrectiveActionEntity)
        private readonly actionRepo: Repository<CorrectiveActionEntity>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    /**
     * Auto-create incident review from severe anomaly, SLA breach, or compliance violation
     */
    async autoCreateIncidentReview(
        input: AutoCreateIncidentInput,
    ): Promise<IncidentReviewEntity> {
        // Calculate due date based on severity
        const dueDate = this.calculateDueDate(input.severity);

        const incident = this.incidentRepo.create({
            orderId: input.orderId ?? null,
            riderId: input.riderId ?? null,
            hospitalId: input.hospitalId ?? null,
            bloodBankId: input.bloodBankId ?? null,
            reportedByUserId: input.reportedByUserId,
            rootCause: input.rootCause,
            severity: input.severity,
            status: IncidentReviewStatus.OPEN,
            description: input.description,
            linkedAnomalyId: input.linkedAnomalyId ?? null,
            linkedSlaBreachId: input.linkedSlaBreachId ?? null,
            linkedOrderIds: input.linkedOrderIds ?? null,
            linkedTelemetryIds: input.linkedTelemetryIds ?? null,
            linkedPolicyIds: input.linkedPolicyIds ?? null,
            dueDate,
            ownerId: this.assignOwner(input.severity, input.hospitalId),
            metadata: input.metadata ?? null,
        });

        const saved = await this.incidentRepo.save(incident);

        this.eventEmitter.emit('incident-review.auto-created', {
            incidentReviewId: saved.id,
            rootCause: input.rootCause,
            severity: input.severity,
        });

        this.logger.log(
            `Auto-created incident review ${saved.id} for ${input.rootCause} with severity ${input.severity}`,
        );

        return saved;
    }

    /**
     * Escalate overdue incident reviews
     */
    async escalateOverdueIncidents(): Promise<void> {
        const now = new Date();
        const overdueIncidents = await this.incidentRepo.find({
            where: {
                status: IncidentReviewStatus.OPEN,
                dueDate: LessThan(now),
                escalatedAt: IsNull(),
            },
        });

        for (const incident of overdueIncidents) {
            await this.escalateIncident({
                incidentReviewId: incident.id,
                escalatedBy: 'SYSTEM',
                reason: 'Overdue incident review',
            });
        }

        if (overdueIncidents.length > 0) {
            this.logger.log(`Escalated ${overdueIncidents.length} overdue incident reviews`);
        }
    }

    /**
     * Manually escalate an incident
     */
    async escalateIncident(input: EscalationInput): Promise<IncidentReviewEntity> {
        const incident = await this.incidentRepo.findOne({
            where: { id: input.incidentReviewId },
        });

        if (!incident) {
            throw new Error(`Incident review ${input.incidentReviewId} not found`);
        }

        incident.status = IncidentReviewStatus.ESCALATED;
        incident.escalationLevel = (incident.escalationLevel ?? 0) + 1;
        incident.escalatedAt = new Date();
        incident.metadata = {
            ...incident.metadata,
            escalationHistory: [
                ...(incident.metadata?.escalationHistory ?? []),
                {
                    escalatedBy: input.escalatedBy,
                    escalatedAt: new Date().toISOString(),
                    reason: input.reason,
                    level: incident.escalationLevel,
                },
            ],
        };

        const saved = await this.incidentRepo.save(incident);

        this.eventEmitter.emit('incident-review.escalated', {
            incidentReviewId: saved.id,
            escalationLevel: saved.escalationLevel,
            escalatedBy: input.escalatedBy,
        });

        this.logger.log(
            `Escalated incident review ${saved.id} to level ${saved.escalationLevel}`,
        );

        return saved;
    }

    /**
     * Validate closure - requires all corrective actions to be completed
     */
    async validateClosure(
        input: ClosureValidationInput,
    ): Promise<{ valid: boolean; reason?: string }> {
        const incident = await this.incidentRepo.findOne({
            where: { id: input.incidentReviewId },
        });

        if (!incident) {
            return { valid: false, reason: 'Incident review not found' };
        }

        // Check if all corrective actions are completed
        const actions = await this.actionRepo.find({
            where: { incidentReview: { id: input.incidentReviewId } },
        });

        const incompleteActions = actions.filter(
            (a) => a.status !== CorrectiveActionStatus.COMPLETED,
        );

        if (incompleteActions.length > 0) {
            return {
                valid: false,
                reason: `${incompleteActions.length} corrective action(s) not completed`,
            };
        }

        // Check if root cause is documented
        if (!incident.rootCause) {
            return { valid: false, reason: 'Root cause not documented' };
        }

        // Check if resolution notes are provided
        if (!incident.resolutionNotes) {
            return { valid: false, reason: 'Resolution notes not provided' };
        }

        // Mark as validated
        incident.closureValidatedBy = input.validatedBy;
        incident.closureValidatedAt = new Date();
        incident.status = IncidentReviewStatus.CLOSED;
        incident.closedAt = new Date();

        await this.incidentRepo.save(incident);

        this.eventEmitter.emit('incident-review.closure-validated', {
            incidentReviewId: incident.id,
            validatedBy: input.validatedBy,
        });

        this.logger.log(`Validated closure for incident review ${incident.id}`);

        return { valid: true };
    }

    /**
     * Get dashboard metrics for open risk
     */
    async getOpenRiskDashboard(): Promise<{
        totalOpen: number;
        byRootCause: Record<string, number>;
        bySeverity: Record<string, number>;
        overdueCount: number;
        escalatedCount: number;
    }> {
        const openIncidents = await this.incidentRepo.find({
            where: { status: IncidentReviewStatus.OPEN },
        });

        const byRootCause: Record<string, number> = {};
        const bySeverity: Record<string, number> = {};
        let overdueCount = 0;
        let escalatedCount = 0;
        const now = new Date();

        for (const incident of openIncidents) {
            byRootCause[incident.rootCause] = (byRootCause[incident.rootCause] ?? 0) + 1;
            bySeverity[incident.severity] = (bySeverity[incident.severity] ?? 0) + 1;
            if (incident.dueDate && incident.dueDate < now) {
                overdueCount++;
            }
            if (incident.status === IncidentReviewStatus.ESCALATED) {
                escalatedCount++;
            }
        }

        return {
            totalOpen: openIncidents.length,
            byRootCause,
            bySeverity,
            overdueCount,
            escalatedCount,
        };
    }

    private calculateDueDate(severity: IncidentSeverity): Date {
        const now = new Date();
        const hoursBySeverity: Record<IncidentSeverity, number> = {
            [IncidentSeverity.CRITICAL]: 4,
            [IncidentSeverity.HIGH]: 24,
            [IncidentSeverity.MEDIUM]: 72,
            [IncidentSeverity.LOW]: 168,
        };
        const hours = hoursBySeverity[severity] ?? 72;
        return new Date(now.getTime() + hours * 60 * 60 * 1000);
    }

    private assignOwner(severity: IncidentSeverity, hospitalId?: string): string | null {
        if (severity === IncidentSeverity.CRITICAL || severity === IncidentSeverity.HIGH) {
            return hospitalId ?? 'SYSTEM';
        }
        return null;
    }
}
