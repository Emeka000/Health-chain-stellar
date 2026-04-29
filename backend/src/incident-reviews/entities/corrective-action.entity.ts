import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

import { IncidentReviewEntity } from './incident-review.entity';

export enum CorrectiveActionStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    VERIFIED = 'verified',
    FAILED = 'failed',
}

/**
 * Tracks individual corrective actions required to close an incident review.
 * Multiple actions can be linked to a single review.
 */
@Entity('corrective_actions')
@Index('IDX_CORRECTIVE_ACTION_REVIEW', ['reviewId'])
@Index('IDX_CORRECTIVE_ACTION_STATUS', ['status'])
@Index('IDX_CORRECTIVE_ACTION_DUE_DATE', ['dueDate'])
export class CorrectiveActionEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => IncidentReviewEntity)
    review: IncidentReviewEntity;

    @Column({ name: 'review_id', type: 'uuid' })
    reviewId: string;

    @Column({ type: 'text' })
    description: string;

    @Column({
        type: 'varchar',
        length: 32,
        default: CorrectiveActionStatus.PENDING,
    })
    status: CorrectiveActionStatus;

    /** User assigned to complete this action */
    @Column({ name: 'assigned_to', type: 'varchar', nullable: true })
    assignedTo: string | null;

    /** Deadline for completion */
    @Column({ name: 'due_date', type: 'timestamptz' })
    dueDate: Date;

    /** Evidence of completion (e.g., document IDs, screenshots, logs) */
    @Column({ name: 'completion_evidence', type: 'jsonb', nullable: true })
    completionEvidence: Record<string, unknown> | null;

    /** Notes from the person who completed the action */
    @Column({ name: 'completion_notes', type: 'text', nullable: true })
    completionNotes: string | null;

    /** User who verified the action was completed correctly */
    @Column({ name: 'verified_by', type: 'varchar', nullable: true })
    verifiedBy: string | null;

    /** Verification notes */
    @Column({ name: 'verification_notes', type: 'text', nullable: true })
    verificationNotes: string | null;

    @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
    completedAt: Date | null;

    @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
    verifiedAt: Date | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
