import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthSessionEntity } from './entities/auth-session.entity';

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface RiskSignals {
  geoVelocity: boolean;   // impossible travel between sessions
  deviceMismatch: boolean; // user-agent changed within same session family
  tokenAbuse: boolean;     // multiple refresh attempts in short window
}

export interface SessionRiskResult {
  score: number;           // 0–100
  level: RiskLevel;
  signals: RiskSignals;
  requiresStepUp: boolean;
}

@Injectable()
export class SessionRiskService {
  private readonly logger = new Logger(SessionRiskService.name);

  private readonly RAPID_IP_CHANGE_WINDOW_MS = 10 * 60 * 1000;

  constructor(
    @InjectRepository(AuthSessionEntity)
    private readonly sessionRepo: Repository<AuthSessionEntity>,
  ) {}

  /**
   * Score the risk of a new/existing session given its metadata and the
   * user's recent session history.
   */
  async scoreSession(
    userId: string,
    currentSessionId: string,
    currentMeta: {
      ipAddress?: string | null;
      userAgent?: string | null;
      createdAt?: Date;
    },
    refreshAbuseCount = 0,
  ): Promise<SessionRiskResult> {
    const recentSessions = await this.sessionRepo.find({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const otherSessions = recentSessions.filter(
      (s) => s.sessionId !== currentSessionId,
    );

    const signals: RiskSignals = {
      geoVelocity: this.detectGeoVelocity(currentMeta, otherSessions),
      deviceMismatch: this.detectDeviceMismatch(currentMeta, otherSessions),
      tokenAbuse: refreshAbuseCount >= 3,
    };

    let score = 0;
    if (signals.geoVelocity) score += 50;
    if (signals.deviceMismatch) score += 25;
    if (signals.tokenAbuse) score += 40;

    score = Math.min(score, 100);

    const level =
      score >= 80 ? RiskLevel.CRITICAL
      : score >= 50 ? RiskLevel.HIGH
      : score >= 25 ? RiskLevel.MEDIUM
      : RiskLevel.LOW;

    return {
      score,
      level,
      signals,
      requiresStepUp: score >= 50,
    };
  }

  private detectGeoVelocity(
    current: { ipAddress?: string | null; createdAt?: Date },
    others: AuthSessionEntity[],
  ): boolean {
    const now = current.createdAt ?? new Date();
    const currentIp = this.normalizeIpAddress(current.ipAddress);

    for (const session of others) {
      const elapsedMs = Math.abs(now.getTime() - session.createdAt.getTime());
      if (elapsedMs > this.RAPID_IP_CHANGE_WINDOW_MS) continue;

      const previousIp = this.normalizeIpAddress(session.ipAddress);
      if (!currentIp || !previousIp || currentIp !== previousIp) {
        this.logger.warn(
          'Rapid or unavailable IP change between active sessions',
        );
        return true;
      }
    }
    return false;
  }

  private normalizeIpAddress(ipAddress?: string | null): string | null {
    const normalized = ipAddress?.trim().replace(/^::ffff:/i, '').toLowerCase();
    return normalized || null;
  }

  private detectDeviceMismatch(
    current: { userAgent?: string | null },
    others: AuthSessionEntity[],
  ): boolean {
    if (!current.userAgent) return false;
    // Flag if the same user has an active session from a completely different UA family
    const currentFamily = this.uaFamily(current.userAgent);
    return others.some(
      (s) => s.userAgent && this.uaFamily(s.userAgent) !== currentFamily,
    );
  }

  /** Coarse UA family: mobile / desktop / bot / unknown */
  private uaFamily(ua: string): string {
    const lower = ua.toLowerCase();
    if (/mobile|android|iphone|ipad/.test(lower)) return 'mobile';
    if (/bot|crawler|spider/.test(lower)) return 'bot';
    if (/mozilla|chrome|safari|firefox|edge/.test(lower)) return 'desktop';
    return 'unknown';
  }
}
