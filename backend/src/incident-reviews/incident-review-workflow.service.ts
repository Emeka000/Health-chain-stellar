import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { IncidentReviewEntity } from './entities/incident-review.entity';
import { CorrectiveActionEntity } from './entities/corrective-action.entity';
import { IncidentReviewStatus } from './enums/incident-review-status.enum';
import { IncidentRootCause } from './enums/incident-root-cause.enum';
import { IncidentSeverity } from './enums/incident-severity.enum';
import { CorrectiveActionStatus } from './enums/corrective-action-status.enum';

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
            where: { incidentReviewId: input.incidentReviewId },
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

        const now = new Date();
        const overdueCount = openIncidents.filter(
            (i) => i.dueDate && i.dueDate < now,
        ).length;

        const escalatedCount = openIncidents.filter(
            (i) => i.escalationLevel > 0,
        ).length;

        const byRootCause: Record<string, number> = {};
        const bySeverity: Record<string, number> = {};

        for (const incident of openIncidents) {
            byRootCause[incident.rootCause] = (byRootCause[incident.rootCause] ?? 0) + 1;
            bySeverity[incident.severity] = (bySeverity[incident.severity] ?? 0) + 1;
        }

        return {
            totalOpen: openIncidents.length,
            byRootCause,
            bySeverity,
            overdueCount,
            escalatedCount,
        };
    }

    /**
     * Get action completion rate metrics
     */
    async getActionCompletionMetrics(): Promise<{
        totalActions: number;
        completedActions: number;
        completionRate: number;
        overdueActions: number;
        byStatus: Record<string, number>;
    }> {
        const allActions = await this.actionRepo.find();
        const completedActions = allActions.filter(
            (a) => a.status === CorrectiveActionStatus.COMPLETED,
        ).length;

        const now = new Date();
        const overdueActions = allActions.filter(
            (a) =>
                a.status !== CorrectiveActionStatus.COMPLETED &&
                a.dueDate &&
                a.dueDate < now,
        ).length;

        const byStatus: Record<string, number> = {};
        for (const action of allActions) {
            byStatus[action.status] = (byStatus[action.status] ?? 0) + 1;
        }

        return {
            totalActions: allActions.length,
            completedActions,
            completionRate:
                allActions.length > 0
                    ? Math.round((completedActions / allActions.length) * 100)
                    : 0,
            overdueActions,
            byStatus,
        };
    }

    /**
     * Calculate due date based on severity
     */
    private calculateDueDate(severity: IncidentSeverity): Date {
        const now = new Date();
        const hoursToAdd =
            severity === IncidentSeverity.CRITICAL
                ? 24
                : severity === IncidentSeverity.HIGH
                    ? 72
                    : severity === IncidentSeverity.MEDIUM
                        ? 168
                        : 336; // 2 weeks for LOW

        return new Date(now.getTime() + hoursToAdd * 60 * 60 * 1000);
    }

    /**
     * Assign owner based on severity and context
     */
    private assignOwner(severity: IncidentSeverity, hospitalId?: string): string {
        if (severity === IncidentSeverity.CRITICAL) {
            return 'ops-manager';
        }
        if (severity === IncidentSeverity.HIGH) {
            return hospitalId ? `hospital-coordinator-${hospitalId}` : 'ops-team';
        }
        return 'ops-team';
    }

    /**
     * Event listener: Auto-create incident review from severe anomaly
     */
    @OnEvent('anomaly.detected.severe')
    async handleSevereAnomaly(payload: {
        anomalyId: string;
        orderId?: string;
        riderId?: string;
        hospitalId?: string;
        description: string;
        metadata?: Record<string, unknown>;
    }): Promise<void> {
        await this.autoCreateIncidentReview({
            orderId: payload.orderId,
            riderId: payload.riderId,
            hospitalId: payload.hospitalId,
            rootCause: IncidentRootCause.ANOMALY_DETECTED,
            severity: IncidentSeverity.HIGH,
            description: payload.description,
            linkedAnomalyId: payload.anomalyId,
            reportedByUserId: 'SYSTEM',
            metadata: payload.metadata,
        });
    }

    /**
     * Event listener: Auto-create incident review from SLA breach
     */
    @OnEvent('sla.breached')
    async handleSlaBreached(payload: {
        slaRecordId: string;
        orderId: string;
        hospitalId: string;
        bloodBankId?: string;
        riderId?: string;
        stage: string;
        elapsedSeconds: number;
        budgetSeconds: number;
    }): Promise<void> {
        await this.autoCreateIncidentReview({
            orderId: payload.orderId,
            riderId: payload.riderId,
            hospitalId: payload.hospitalId,
            bloodBankId: payload.bloodBankId,
            rootCause: IncidentRootCause.SLA_BREACH,
            severity: IncidentSeverity.MEDIUM,
            description: `SLA breach at stage ${payload.stage}: ${payload.elapsedSeconds}s elapsed vs ${payload.budgetSeconds}s budget`,
            linkedSlaBreachId: payload.slaRecordId,
            linkedOrderIds: [payload.orderId],
            reportedByUserId: 'SYSTEM',
            metadata: {
                stage: payload.stage,
                elapsedSeconds: payload.elapsedSeconds,
                budgetSeconds: payload.budgetSeconds,
            },
        });
    }

    /**
     * Event listener: Auto-create incident review from compliance violation
     */
    @OnEvent('compliance.violation.detected')
    async handleComplianceViolation(payload: {
        violationId: string;
        orderId?: string;
        riderId?: string;
        hospitalId?: string;
        bloodBankId?: string;
        policyId: string;
        description: string;
        severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        metadata?: Record<string, unknown>;
    }): Promise<void> {
        const severityMap: Record<string, IncidentSeverity> = {
            CRITICAL: IncidentSeverity.CRITICAL,
            HIGH: IncidentSeverity.HIGH,
            MEDIUM: IncidentSeverity.MEDIUM,
            LOW: IncidentSeverity.LOW,
        };

        await this.autoCreateIncidentReview({
            orderId: payload.orderId,
            riderId: payload.riderId,
            hospitalId: payload.hospitalId,
            bloodBankId: payload.bloodBankId,
            rootCause: IncidentRootCause.COMPLIANCE_VIOLATION,
            severity: severityMap[payload.severity] ?? IncidentSeverity.MEDIUM,
            description: payload.description,
            linkedPolicyIds: [payload.policyId],
            reportedByUserId: 'SYSTEM',
            metadata: {
                ...payload.metadata,
                violationId: payload.violationId,
            },
        });
    }

    /**
     * Event listener: Auto-create incident review from cold chain failure
     */
    @OnEvent('cold-chain.failure.detected')
    async handleColdChainFailure(payload: {
        orderId: string;
        riderId?: string;
        telemetryId: string;
        temperature: number;
        threshold: number;
        duration: number;
        description: string;
    }): Promise<void> {
        await this.autoCreateIncidentReview({
            orderId: payload.orderId,
            riderId: payload.riderId,
            rootCause: IncidentRootCause.COLD_CHAIN_FAILURE,
            severity: IncidentSeverity.CRITICAL,
            description: payload.description,
            linkedOrderIds: [payload.orderId],
            linkedTelemetryIds: [payload.telemetryId],
            reportedByUserId: 'SYSTEM',
            metadata: {
                temperature: payload.temperature,
                threshold: payload.threshold,
                duration: payload.duration,
            },
        });
    }

    /**
     * Event listener: Auto-create incident review from escrow dispute
     */
    @OnEvent('escrow.dispute.created')
    async handleEscrowDispute(payload: {
        disputeId: string;
        orderId: string;
        hospitalId?: string;
        riderId?: string;
        description: string;
        amount: number;
    }): Promise<void> {
        await this.autoCreateIncidentReview({
            orderId: payload.orderId,
            riderId: payload.riderId,
            hospitalId: payload.hospitalId,
            rootCause: IncidentRootCause.ESCROW_DISPUTE,
            severity: IncidentSeverity.HIGH,
            description: payload.description,
            linkedOrderIds: [payload.orderId],
            reportedByUserId: 'SYSTEM',
            metadata: {
                disputeId: payload.disputeId,
                amount: payload.amount,
            },
        });
    }
}
