import { EventSchemaDefinition } from '../canonical-event.envelope';

/**
 * Common event schemas for the system
 * 
 * Register these schemas on application startup
 */

export const ORDER_CREATED_SCHEMA_V1: EventSchemaDefinition = {
    eventType: 'order.created',
    schemaVersion: '1.0.0',
    description: 'Emitted when a new order is created',
    payloadSchema: {
        type: 'object',
        required: ['orderId', 'hospitalId', 'bloodType', 'units'],
        properties: {
            orderId: { type: 'string', format: 'uuid' },
            hospitalId: { type: 'string' },
            bloodType: { type: 'string', enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
            units: { type: 'number', minimum: 1 },
            urgency: { type: 'string', enum: ['CRITICAL', 'URGENT', 'STANDARD'] },
            metadata: { type: 'object' },
        },
    },
    examples: [
        {
            orderId: '123e4567-e89b-12d3-a456-426614174000',
            hospitalId: 'hospital-001',
            bloodType: 'O+',
            units: 2,
            urgency: 'URGENT',
        },
    ],
};

export const SLA_BREACHED_SCHEMA_V1: EventSchemaDefinition = {
    eventType: 'sla.breached',
    schemaVersion: '1.0.0',
    description: 'Emitted when an SLA is breached',
    payloadSchema: {
        type: 'object',
        required: ['slaRecordId', 'orderId', 'stage', 'elapsedSeconds', 'budgetSeconds'],
        properties: {
            slaRecordId: { type: 'string', format: 'uuid' },
            orderId: { type: 'string', format: 'uuid' },
            hospitalId: { type: 'string' },
            bloodBankId: { type: 'string' },
            riderId: { type: 'string' },
            stage: { type: 'string' },
            elapsedSeconds: { type: 'number', minimum: 0 },
            budgetSeconds: { type: 'number', minimum: 0 },
        },
    },
};

export const ANOMALY_DETECTED_SCHEMA_V1: EventSchemaDefinition = {
    eventType: 'anomaly.detected.high',
    schemaVersion: '1.0.0',
    description: 'Emitted when a high-severity anomaly is detected',
    payloadSchema: {
        type: 'object',
        required: ['anomalyId', 'type', 'severity', 'description'],
        properties: {
            anomalyId: { type: 'string', format: 'uuid' },
            type: { type: 'string' },
            severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
            orderId: { type: 'string' },
            riderId: { type: 'string' },
            hospitalId: { type: 'string' },
            bloodBankId: { type: 'string' },
            description: { type: 'string' },
            metadata: { type: 'object' },
        },
    },
};

export const ROUTE_DEVIATION_DETECTED_SCHEMA_V1: EventSchemaDefinition = {
    eventType: 'route.deviation.detected',
    schemaVersion: '1.0.0',
    description: 'Emitted when a route deviation is detected',
    payloadSchema: {
        type: 'object',
        required: ['deviationId', 'orderId', 'riderId', 'severity', 'distanceM'],
        properties: {
            deviationId: { type: 'string', format: 'uuid' },
            orderId: { type: 'string' },
            riderId: { type: 'string' },
            severity: { type: 'string', enum: ['MINOR', 'MODERATE', 'SEVERE'] },
            distanceM: { type: 'number', minimum: 0 },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            recommendedAction: { type: 'string' },
        },
    },
};

export const COMPLIANCE_VIOLATION_DETECTED_SCHEMA_V1: EventSchemaDefinition = {
    eventType: 'compliance.violation.detected',
    schemaVersion: '1.0.0',
    description: 'Emitted when a compliance violation is detected',
    payloadSchema: {
        type: 'object',
        required: ['violationId', 'violationType', 'severity', 'description'],
        properties: {
            violationId: { type: 'string', format: 'uuid' },
            orderId: { type: 'string' },
            riderId: { type: 'string' },
            hospitalId: { type: 'string' },
            bloodBankId: { type: 'string' },
            policyId: { type: 'string' },
            violationType: { type: 'string' },
            severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            description: { type: 'string' },
            metadata: { type: 'object' },
        },
    },
};

export const INCIDENT_REVIEW_CREATED_SCHEMA_V1: EventSchemaDefinition = {
    eventType: 'incident-review.auto-created',
    schemaVersion: '1.0.0',
    description: 'Emitted when an incident review is auto-created',
    payloadSchema: {
        type: 'object',
        required: ['incidentReviewId', 'rootCause', 'severity'],
        properties: {
            incidentReviewId: { type: 'string', format: 'uuid' },
            rootCause: { type: 'string' },
            severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        },
    },
};

export const ESCALATION_TRIGGERED_SCHEMA_V1: EventSchemaDefinition = {
    eventType: 'escalation.triggered',
    schemaVersion: '1.0.0',
    description: 'Emitted when an escalation is triggered',
    payloadSchema: {
        type: 'object',
        required: ['requestId', 'tier', 'hospitalId', 'slaDeadlineMs'],
        properties: {
            requestId: { type: 'string' },
            orderId: { type: 'string' },
            tier: { type: 'string' },
            hospitalId: { type: 'string' },
            slaDeadlineMs: { type: 'number' },
            riderId: { type: 'string' },
        },
    },
};

/**
 * All common schemas
 */
export const COMMON_EVENT_SCHEMAS: EventSchemaDefinition[] = [
    ORDER_CREATED_SCHEMA_V1,
    SLA_BREACHED_SCHEMA_V1,
    ANOMALY_DETECTED_SCHEMA_V1,
    ROUTE_DEVIATION_DETECTED_SCHEMA_V1,
    COMPLIANCE_VIOLATION_DETECTED_SCHEMA_V1,
    INCIDENT_REVIEW_CREATED_SCHEMA_V1,
    ESCALATION_TRIGGERED_SCHEMA_V1,
];
