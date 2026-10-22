import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RouteDeviationIncidentEntity, DeviationSeverity } from './entities/route-deviation-incident.entity';
import { SeverityClassificationResult } from './severity-classifier.service';

export interface TriageAction {
    actionType:
    | 'NOTIFY_RIDER'
    | 'NOTIFY_SUPERVISOR'
    | 'ESCALATE_TO_OPS'
    | 'CREATE_INCIDENT_REVIEW'
    | 'TRIGGER_REROUTE'
    | 'ALERT_HOSPITAL'
    | 'LOG_ONLY';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    description: string;
    metadata?: Record<string, unknown>;
}

export interface TriageResult {
    deviationId: string;
    severity: DeviationSeverity;
    riskScore: number;
    actions: TriageAction[];
    explanation: string;
    timestamp: Date;
}

export interface TriagePolicy {
    // Severity-based action rules
    minorActions: TriageAction[];
    moderateActions: TriageAction[];
    severeActions: TriageAction[];

    // Contextual overrides
    criticalOrderEscalation: boolean;
    coldChainImmediateAlert: boolean;
    repeatOffenderEscalation: boolean;

    // Thresholds
    repeatOffenderThreshold: number; // Number of deviations
    autoIncidentReviewThreshold: number; // Risk score threshold
}

@Injectable()
export class TriageAutomationService {
    private readonly logger = new Logger(TriageAutomationService.name);

    // Default triage policy
    private readonly defaultPolicy: TriagePolicy = {
        minorActions: [
            {
                actionType: 'NOTIFY_RIDER',
                priority: 'LOW',
                description: 'Send route correction notification to rider',
            },
            {
                actionType: 'LOG_ONLY',
                priority: 'LOW',
                description: 'Log deviation for analytics',
            },
        ],
        moderateActions: [
            {
                actionType: 'NOTIFY_RIDER',
                priority: 'MEDIUM',
                description: 'Send urgent route correction to rider',
            },
            {
                actionType: 'NOTIFY_SUPERVISOR',
                priority: 'MEDIUM',
                description: 'Alert dispatch supervisor',
            },
        ],
        severeActions: [
            {
                actionType: 'NOTIFY_RIDER',
                priority: 'HIGH',
                description: 'Send immediate route correction to rider',
            },
            {
                actionType: 'ESCALATE_TO_OPS',
                priority: 'HIGH',
                description: 'Escalate to operations manager',
            },
            {
                actionType: 'CREATE_INCIDENT_REVIEW',
                priority: 'HIGH',
                description: 'Auto-create incident review for investigation',
            },
        ],
        criticalOrderEscalation: true,
        coldChainImmediateAlert: true,
        repeatOffenderEscalation: true,
        repeatOffenderThreshold: 3,
        autoIncidentReviewThreshold: 75,
    };

    constructor(
        @InjectRepository(RouteDeviationIncidentEntity)
        private readonly deviationRepo: Repository<RouteDeviationIncidentEntity>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    /**
     * Execute triage automation for a deviation
     */
    async executeTriage(
        incident: RouteDeviationIncidentEntity,
        classification: SeverityClassificationResult,
        context: {
            orderPriority?: 'CRITICAL' | 'URGENT' | 'STANDARD';
            hasColdChainRequirement?: boolean;
            riderDeviationHistory?: number;
        } = {},
        policy: Partial<TriagePolicy> = {},
    ): Promise<TriageResult> {
        const triagePolicy = { ...this.defaultPolicy, ...policy };

        // Determine base actions from severity
        let actions = this.getBaseActions(classification.severity, triagePolicy);

        // Apply contextual overrides
        actions = this.applyContextualOverrides(
            actions,
            classification,
            context,
            triagePolicy,
        );

        // Execute actions
        await this.executeActions(incident, actions, classification);

        // Build result
        const result: TriageResult = {
            deviationId: incident.id,
            severity: classification.severity,
            riskScore: classification.riskScore,
            actions,
            explanation: this.buildTriageExplanation(
                classification,
                actions,
                context,
            ),
            timestamp: new Date(),
        };

        this.logger.log(
            `Triage completed for deviation ${incident.id}: ${actions.length} actions triggered`,
        );

        return result;
    }

    /**
     * Get base actions for severity level
     */
    private getBaseActions(
        severity: DeviationSeverity,
        policy: TriagePolicy,
    ): TriageAction[] {
        switch (severity) {
            case DeviationSeverity.SEVERE:
                return [...policy.severeActions];
            case DeviationSeverity.MODERATE:
                return [...policy.moderateActions];
            case DeviationSeverity.MINOR:
                return [...policy.minorActions];
            default:
                return [];
        }
    }

    /**
     * Apply contextual overrides to actions
     */
    private applyContextualOverrides(
        baseActions: TriageAction[],
        classification: SeverityClassificationResult,
        context: {
            orderPriority?: 'CRITICAL' | 'URGENT' | 'STANDARD';
            hasColdChainRequirement?: boolean;
            riderDeviationHistory?: number;
        },
        policy: TriagePolicy,
    ): TriageAction[] {
        const actions = [...baseActions];

        // Critical order escalation
        if (
            context.orderPriority === 'CRITICAL' &&
            policy.criticalOrderEscalation
        ) {
            if (!actions.find((a) => a.actionType === 'ALERT_HOSPITAL')) {
                actions.push({
                    actionType: 'ALERT_HOSPITAL',
                    priority: 'CRITICAL',
                    description: 'Alert hospital of critical order delay',
                    metadata: { reason: 'Critical order deviation' },
                });
            }
            if (!actions.find((a) => a.actionType === 'ESCALATE_TO_OPS')) {
                actions.push({
                    actionType: 'ESCALATE_TO_OPS',
                    priority: 'CRITICAL',
                    description: 'Immediate ops escalation for critical order',
                    metadata: { reason: 'Critical order deviation' },
                });
            }
        }

        // Cold chain immediate alert
        if (
            context.hasColdChainRequirement &&
            policy.coldChainImmediateAlert &&
            classification.riskScore > 50
        ) {
            if (!actions.find((a) => a.actionType === 'ALERT_HOSPITAL')) {
                actions.push({
                    actionType: 'ALERT_HOSPITAL',
                    priority: 'HIGH',
                    description: 'Alert hospital of cold chain risk',
                    metadata: { reason: 'Cold chain deviation' },
                });
            }
            if (!actions.find((a) => a.actionType === 'CREATE_INCIDENT_REVIEW')) {
                actions.push({
                    actionType: 'CREATE_INCIDENT_REVIEW',
                    priority: 'HIGH',
                    description: 'Create incident review for cold chain breach',
                    metadata: { reason: 'Cold chain deviation' },
                });
            }
        }

        // Repeat offender escalation
        if (
            context.riderDeviationHistory &&
            context.riderDeviationHistory >= policy.repeatOffenderThreshold &&
            policy.repeatOffenderEscalation
        ) {
            if (!actions.find((a) => a.actionType === 'CREATE_INCIDENT_REVIEW')) {
                actions.push({
                    actionType: 'CREATE_INCIDENT_REVIEW',
                    priority: 'MEDIUM',
                    description: 'Create incident review for repeat offender',
                    metadata: {
                        reason: 'Repeat offender',
                        deviationCount: context.riderDeviationHistory,
                    },
                });
            }
        }

        // Auto incident review for high risk
        if (
            classification.riskScore >= policy.autoIncidentReviewThreshold &&
            !actions.find((a) => a.actionType === 'CREATE_INCIDENT_REVIEW')
        ) {
            actions.push({
                actionType: 'CREATE_INCIDENT_REVIEW',
                priority: 'HIGH',
                description: 'Auto-create incident review for high-risk deviation',
                metadata: { riskScore: classification.riskScore },
            });
        }

        return actions;
    }

    /**
     * Execute triage actions
     */
    private async executeActions(
        incident: RouteDeviationIncidentEntity,
        actions: TriageAction[],
        classification: SeverityClassificationResult,
    ): Promise<void> {
        for (const action of actions) {
            try {
                await this.executeAction(incident, action, classification);
            } catch (error) {
                this.logger.error(
                    `Failed to execute action ${action.actionType} for deviation ${incident.id}`,
                    error,
                );
            }
        }
    }

    /**
     * Execute a single triage action
     */
    private async executeAction(
        incident: RouteDeviationIncidentEntity,
        action: TriageAction,
        classification: SeverityClassificationResult,
    ): Promise<void> {
        switch (action.actionType) {
            case 'NOTIFY_RIDER':
                this.eventEmitter.emit('route-deviation.notify-rider', {
                    deviationId: incident.id,
                    riderId: incident.riderId,
                    orderId: incident.orderId,
                    severity: classification.severity,
                    message: action.description,
                    priority: action.priority,
                });
                break;

            case 'NOTIFY_SUPERVISOR':
                this.eventEmitter.emit('route-deviation.notify-supervisor', {
                    deviationId: incident.id,
                    riderId: incident.riderId,
                    orderId: incident.orderId,
                    severity: classification.severity,
                    riskScore: classification.riskScore,
                    explanation: classification.explanation,
                });
                break;

            case 'ESCALATE_TO_OPS':
                this.eventEmitter.emit('route-deviation.escalate', {
                    deviationId: incident.id,
                    riderId: incident.riderId,
                    orderId: incident.orderId,
                    severity: classification.severity,
                    riskScore: classification.riskScore,
                    explanation: classification.explanation,
                    priority: action.priority,
                });
                break;

            case 'CREATE_INCIDENT_REVIEW':
                this.eventEmitter.emit('route-deviation.create-incident-review', {
                    deviationId: incident.id,
                    orderId: incident.orderId,
                    riderId: incident.riderId,
                    severity: classification.severity,
                    riskScore: classification.riskScore,
                    explanation: classification.explanation,
                    metadata: action.metadata,
                });
                break;

            case 'TRIGGER_REROUTE':
                this.eventEmitter.emit('route-deviation.trigger-reroute', {
                    deviationId: incident.id,
                    riderId: incident.riderId,
                    orderId: incident.orderId,
                    currentLocation: {
                        latitude: incident.lastKnownLatitude,
                        longitude: incident.lastKnownLongitude,
                    },
                });
                break;

            case 'ALERT_HOSPITAL':
                this.eventEmitter.emit('route-deviation.alert-hospital', {
                    deviationId: incident.id,
                    orderId: incident.orderId,
                    severity: classification.severity,
                    riskScore: classification.riskScore,
                    explanation: classification.explanation,
                    metadata: action.metadata,
                });
                break;

            case 'LOG_ONLY':
                this.logger.log(
                    `Deviation ${incident.id}: ${action.description} (severity: ${classification.severity}, risk: ${classification.riskScore})`,
                );
                break;
        }
    }

    /**
     * Build triage explanation
     */
    private buildTriageExplanation(
        classification: SeverityClassificationResult,
        actions: TriageAction[],
        context: {
            orderPriority?: 'CRITICAL' | 'URGENT' | 'STANDARD';
            hasColdChainRequirement?: boolean;
            riderDeviationHistory?: number;
        },
    ): string {
        const parts: string[] = [];

        parts.push(
            `Severity: ${classification.severity} (risk score: ${classification.riskScore}/100)`,
        );

        if (context.orderPriority && context.orderPriority !== 'STANDARD') {
            parts.push(`Order priority: ${context.orderPriority}`);
        }

        if (context.hasColdChainRequirement) {
            parts.push('Cold chain requirement detected');
        }

        if (context.riderDeviationHistory && context.riderDeviationHistory > 0) {
            parts.push(`Rider history: ${context.riderDeviationHistory} deviations`);
        }

        parts.push(`Actions triggered: ${actions.map((a) => a.actionType).join(', ')}`);

        return parts.join('. ');
    }

    /**
     * Allow operator override with mandatory rationale
     */
    async overrideSeverity(
        deviationId: string,
        newSeverity: DeviationSeverity,
        operatorId: string,
        rationale: string,
    ): Promise<void> {
        if (!rationale || rationale.trim().length < 10) {
            throw new Error('Rationale must be at least 10 characters');
        }

        const incident = await this.deviationRepo.findOne({
            where: { id: deviationId },
        });

        if (!incident) {
            throw new Error(`Deviation ${deviationId} not found`);
        }

        const originalSeverity = incident.severity;

        await this.deviationRepo.update(deviationId, {
            severity: newSeverity,
            metadata: {
                ...incident.metadata,
                severityOverride: {
                    originalSeverity,
                    newSeverity,
                    operatorId,
                    rationale,
                    timestamp: new Date().toISOString(),
                },
            },
        });

        this.eventEmitter.emit('route-deviation.severity-overridden', {
            deviationId,
            originalSeverity,
            newSeverity,
            operatorId,
            rationale,
        });

        this.logger.log(
            `Severity overridden for deviation ${deviationId}: ${originalSeverity} -> ${newSeverity} by ${operatorId}`,
        );
    }

    /**
     * Get triage statistics
     */
    async getTriageStatistics(params: {
        startDate?: Date;
        endDate?: Date;
    }): Promise<{
        totalDeviations: number;
        bySeverity: Record<DeviationSeverity, number>;
        overrideCount: number;
        overrideRate: number;
    }> {
        const qb = this.deviationRepo.createQueryBuilder('d');

        if (params.startDate) {
            qb.andWhere('d.created_at >= :startDate', {
                startDate: params.startDate,
            });
        }
        if (params.endDate) {
            qb.andWhere('d.created_at <= :endDate', { endDate: params.endDate });
        }

        const deviations = await qb.getMany();
        const totalDeviations = deviations.length;

        const bySeverity: Record<DeviationSeverity, number> = {
            [DeviationSeverity.MINOR]: 0,
            [DeviationSeverity.MODERATE]: 0,
            [DeviationSeverity.SEVERE]: 0,
        };

        let overrideCount = 0;

        for (const deviation of deviations) {
            bySeverity[deviation.severity]++;
            if (deviation.metadata?.severityOverride) {
                overrideCount++;
            }
        }

        const overrideRate =
            totalDeviations > 0 ? (overrideCount / totalDeviations) * 100 : 0;

        return {
            totalDeviations,
            bySeverity,
            overrideCount,
            overrideRate: Math.round(overrideRate * 10) / 10,
        };
    }
}
