import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('auth_sessions')
@Index('IDX_AUTH_SESSION_USER_ID_ACTIVE', ['userId', 'isActive'])
@Index('IDX_AUTH_SESSION_USER_CREATED_AT', ['userId', 'createdAt'])
export class AuthSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  sessionId: string;

  @Column({ type: 'varchar', length: 120 })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 50 })
  role: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  userAgent: string;

  @Column({ name: 'geo_hint', type: 'varchar', length: 128, nullable: true })
  geoHint: string;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', default: () => 'now()' })
  lastActivityAt: Date;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  revocationReason: string;

  // ── Risk scoring fields ──────────────────────────────────────────────

  /** Risk score 0–100 at session creation */
  @Column({ name: 'risk_score', type: 'int', nullable: true })
  riskScore: number | null;

  /** Risk level: low | medium | high | critical */
  @Column({ name: 'risk_level', type: 'varchar', length: 16, nullable: true })
  riskLevel: string | null;

  /** Signals that contributed to the risk score */
  @Column({ name: 'risk_signals', type: 'jsonb', nullable: true })
  riskSignals: Record<string, boolean> | null;

  /** Timestamp when step-up authentication was completed for this session */
  @Column({ name: 'step_up_at', type: 'timestamp', nullable: true })
  stepUpAt: Date | null;
}
