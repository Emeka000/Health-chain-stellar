import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';

import { IncidentReviewEntity } from './incident-review.entity';

export enum EvidenceType {
    ANOMALY = 'anomaly',
    SLA_BREACH = 'sla_breach',
    ORDER = 'order',
    TELEMETRY = 'telemetry',
    POLICY = 'policy',
    COMPLIANCE_VIOLATION = 'compliance_violation',
    ESCROW_DISPUTE = 'escrow_dispute',
    COLD_CHAIN_LOG = 'cold_chain_log',
}

/**
 * Links correlated evidence to incident reviews for root-cause analysis.
 */
@Entity('incident_evidence_links')
@Index('IDX_EVIDENCE_LINK_REVIEW', ['reviewId'])
@Index('IDX_EVIDENCE_LINK_TYPE', ['evidenceType'])
export class IncidentEvidenceLinkEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => IncidentReviewEntity)
    review: IncidentReviewEntity;

    @Column({ name: 'review_id', type: 'uuid' })
    reviewId: string;

    @Column({
        name: 'evidence_type',
        type: 'varchar',
        length: 64,
    })
    evidenceType: EvidenceType;

    /** ID of the linked evidence entity */
    @Column({ name: 'evidence_id', type: 'varchar' })
    evidenceId: string;

    /** Optional description of how this evidence relates to the incident */
    @Column({ type: 'text', nullable: true })
    description: string | null;

    /** Snapshot of evidence metadata at time of linking */
    @Column({ type: 'jsonb', nullable: true })
    metadata: Record<string, unknown> | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
