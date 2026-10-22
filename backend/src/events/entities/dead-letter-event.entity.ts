import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import {
    CanonicalEventEnvelope,
    DeadLetterReason,
    ErrorCategory,
} from '../canonical-event.envelope';

@Entity('dead_letter_events')
@Index(['eventType'])
@Index(['deadLetterReason'])
@Index(['errorCategory'])
@Index(['deadLetteredAt'])
@Index(['isReplayable'])
@Index(['replayedAt'])
@Index(['correlationId'])
export class DeadLetterEventEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** Original event ID */
    @Column({ name: 'event_id', type: 'varchar' })
    eventId: string;

    /** Event type */
    @Column({ name: 'event_type', type: 'varchar' })
    eventType: string;

    /** Schema version */
    @Column({ name: 'schema_version', type: 'varchar' })
    schemaVersion: string;

    /** Correlation ID for tracing */
    @Column({ name: 'correlation_id', type: 'varchar' })
    correlationId: string;

    /** Original event envelope (full) */
    @Column({ name: 'original_event', type: 'jsonb' })
    originalEvent: CanonicalEventEnvelope;

    /** When the event was dead-lettered */
    @Column({ name: 'dead_lettered_at', type: 'timestamptz' })
    deadLetteredAt: Date;

    /** Reason for dead-lettering */
    @Column({
        name: 'dead_letter_reason',
        type: 'enum',
        enum: DeadLetterReason,
    })
    deadLetterReason: DeadLetterReason;

    /** Error category */
    @Column({
        name: 'error_category',
        type: 'enum',
        enum: ErrorCategory,
    })
    errorCategory: ErrorCategory;

    /** Error message */
    @Column({ name: 'error_message', type: 'text' })
    errorMessage: string;

    /** Error stack trace */
    @Column({ name: 'error_stack', type: 'text', nullable: true })
    errorStack: string | null;

    /** Consumer that failed to process */
    @Column({ name: 'failed_consumer', type: 'varchar' })
    failedConsumer: string;

    /** Number of processing attempts before dead-lettering */
    @Column({ name: 'attempt_count', type: 'int', default: 1 })
    attemptCount: number;

    /** Whether this event is replayable */
    @Column({ name: 'is_replayable', type: 'boolean', default: true })
    isReplayable: boolean;

    /** Whether this is a poison message (repeated failures) */
    @Column({ name: 'is_poison_message', type: 'boolean', default: false })
    isPoisonMessage: boolean;

    /** Diagnostic metadata */
    @Column({ name: 'diagnostics', type: 'jsonb', nullable: true })
    diagnostics: Record<string, unknown> | null;

    /** Whether this event has been replayed */
    @Column({ name: 'replayed', type: 'boolean', default: false })
    replayed: boolean;

    /** When the event was replayed */
    @Column({ name: 'replayed_at', type: 'timestamptz', nullable: true })
    replayedAt: Date | null;

    /** Replay result */
    @Column({ name: 'replay_result', type: 'varchar', nullable: true })
    replayResult: 'SUCCESS' | 'FAILURE' | null;

    /** Replay error message if replay failed */
    @Column({ name: 'replay_error', type: 'text', nullable: true })
    replayError: string | null;

    /** Number of replay attempts */
    @Column({ name: 'replay_attempt_count', type: 'int', default: 0 })
    replayAttemptCount: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
