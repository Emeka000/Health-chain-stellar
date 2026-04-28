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

/** Haversine distance in km between two lat/lon pairs */
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Parse a rough lat/lon from a geo-hint string like "37.77,-122.41" */
function parseGeoHint(hint: string | null): [number, number] | null {
  if (!hint) return null;
  const parts = hint.split(',');
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  return isNaN(lat) || isNaN(lon) ? null : [lat, lon];
}

@Injectable()
export class SessionRiskService {
  private readonly logger = new Logger(SessionRiskService.name);

  /** Max km/h considered physically possible between two sessions */
  private readonly MAX_TRAVEL_SPEED_KMH = 900; // commercial flight

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
      geoHint?: string | null;
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
    current: { geoHint?: string | null; createdAt?: Date },
    others: AuthSessionEntity[],
  ): boolean {
    const currentCoords = parseGeoHint(current.geoHint ?? null);
    if (!currentCoords) return false;

    const now = current.createdAt ?? new Date();

    for (const session of others) {
      const coords = parseGeoHint(session.geoHint);
      if (!coords) continue;

      const distKm = haversineKm(
        currentCoords[0], currentCoords[1],
        coords[0], coords[1],
      );
      const elapsedHours =
        Math.abs(now.getTime() - session.createdAt.getTime()) / 3_600_000;

      if (elapsedHours < 0.01) continue; // same-second sessions, skip

      const speedKmh = distKm / elapsedHours;
      if (speedKmh > this.MAX_TRAVEL_SPEED_KMH) {
        this.logger.warn(
          `Geo-velocity anomaly: ${distKm.toFixed(0)} km in ${elapsedHours.toFixed(2)} h (${speedKmh.toFixed(0)} km/h)`,
        );
        return true;
      }
    }
    return false;
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
