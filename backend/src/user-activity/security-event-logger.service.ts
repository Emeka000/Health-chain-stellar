import { Injectable, Logger } from '@nestjs/common';
import { ActivityType } from './enums/activity-type.enum';
import { UserActivityService } from './user-activity.service';

export enum SecurityEventType {
  AUTH_LOGIN_SUCCESS = 'AUTH_LOGIN_SUCCESS',
  AUTH_LOGIN_FAILED = 'AUTH_LOGIN_FAILED',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  AUTH_PASSWORD_CHANGED = 'AUTH_PASSWORD_CHANGED',
  AUTH_ACCOUNT_LOCKED = 'AUTH_ACCOUNT_LOCKED',
  AUTH_ACCOUNT_AUTO_UNLOCKED = 'AUTH_ACCOUNT_AUTO_UNLOCKED',
  AUTH_ACCOUNT_MANUALLY_UNLOCKED = 'AUTH_ACCOUNT_MANUALLY_UNLOCKED',
  AUTH_SESSION_REVOKED = 'AUTH_SESSION_REVOKED',
  AUTH_REFRESH_TOKEN_REPLAY = 'AUTH_REFRESH_TOKEN_REPLAY',
  AUTH_SESSION_RISK_ELEVATED = 'AUTH_SESSION_RISK_ELEVATED',
  AUTH_STEP_UP_REQUIRED = 'AUTH_STEP_UP_REQUIRED',
  TENANT_ACCESS_DENIED = 'TENANT_ACCESS_DENIED',
}

export interface SecurityEvent {
  eventType: SecurityEventType;
  userId?: string | null;
  email?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  description?: string;
  timestamp?: string;
  /** Session risk context — attached when risk scoring is available */
  riskScore?: number;
  riskLevel?: string;
  riskSignals?: Record<string, boolean>;
}

@Injectable()
export class SecurityEventLoggerService {
  private readonly logger = new Logger(SecurityEventLoggerService.name);

  constructor(private readonly userActivityService: UserActivityService) {}

  async logEvent(event: SecurityEvent): Promise<void> {
    const payload = {
      userId: event.userId ?? null,
      activityType: this.toActivityType(event.eventType),
      description:
        event.description ?? `Security event: ${event.eventType}`,
      metadata: {
        eventType: event.eventType,
        email: event.email,
        sessionId: event.sessionId,
        reason: event.reason,
        ...(event.riskScore !== undefined && { riskScore: event.riskScore }),
        ...(event.riskLevel !== undefined && { riskLevel: event.riskLevel }),
        ...(event.riskSignals !== undefined && { riskSignals: event.riskSignals }),
        ...event.metadata,
      },
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
    };

    this.logger.log(
      JSON.stringify({
        at: event.timestamp ?? new Date().toISOString(),
        ...event,
      }),
    );

    await this.userActivityService.logActivity(payload);
  }

  private toActivityType(eventType: SecurityEventType): ActivityType {
    switch (eventType) {
      case SecurityEventType.AUTH_LOGIN_SUCCESS:
        return ActivityType.AUTH_LOGIN_SUCCESS;
      case SecurityEventType.AUTH_LOGIN_FAILED:
        return ActivityType.AUTH_LOGIN_FAILED;
      case SecurityEventType.AUTH_LOGOUT:
        return ActivityType.AUTH_LOGOUT;
      case SecurityEventType.AUTH_PASSWORD_CHANGED:
        return ActivityType.AUTH_PASSWORD_CHANGED;
      case SecurityEventType.AUTH_ACCOUNT_LOCKED:
        return ActivityType.AUTH_ACCOUNT_LOCKED;
      case SecurityEventType.AUTH_ACCOUNT_AUTO_UNLOCKED:
        return ActivityType.AUTH_ACCOUNT_AUTO_UNLOCKED;
      case SecurityEventType.AUTH_ACCOUNT_MANUALLY_UNLOCKED:
        return ActivityType.AUTH_ACCOUNT_MANUALLY_UNLOCKED;
      case SecurityEventType.AUTH_SESSION_REVOKED:
        return ActivityType.AUTH_SESSION_REVOKED;
      case SecurityEventType.AUTH_REFRESH_TOKEN_REPLAY:
        return ActivityType.AUTH_REFRESH_TOKEN_REPLAY;
      case SecurityEventType.AUTH_SESSION_RISK_ELEVATED:
      case SecurityEventType.AUTH_STEP_UP_REQUIRED:
      case SecurityEventType.TENANT_ACCESS_DENIED:
        return ActivityType.AUTH_SESSION_RISK_ELEVATED;
      
      // WebSocket events map to existing activity types
      case SecurityEventType.WS_NO_TOKEN:
      case SecurityEventType.WS_INVALID_TOKEN:
      case SecurityEventType.WS_INVALID_CLAIMS:
      case SecurityEventType.WS_AUTH_ERROR:
        return ActivityType.AUTH_LOGIN_FAILED;
      
      case SecurityEventType.WS_AUTH_SUCCESS:
        return ActivityType.AUTH_LOGIN_SUCCESS;
      
      case SecurityEventType.WS_PRIVILEGE_VIOLATION:
      case SecurityEventType.WS_TENANT_ESCAPE_ATTEMPT:
      case SecurityEventType.WS_RATE_LIMITED:
      case SecurityEventType.WS_TOKEN_REFRESH_FAILED:
      case SecurityEventType.WS_HEARTBEAT_TIMEOUT:
        return ActivityType.AUTH_SESSION_RISK_ELEVATED;
      
      default:
        return ActivityType.AUTH_LOGIN_FAILED;
    }
  }
}
