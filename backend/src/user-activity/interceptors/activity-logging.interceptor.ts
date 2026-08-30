import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Observable, catchError, tap, throwError } from 'rxjs';

import { ActivityType } from '../enums/activity-type.enum';
import { UserActivityService } from '../user-activity.service';

@Injectable()
export class ActivityLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly userActivityService: UserActivityService,
    private readonly configService: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{
      method: string;
      path?: string;
      route?: { path?: string };
      originalUrl?: string;
      user?: { id?: string };
      headers?: Record<string, string | string[]>;
      ip?: string;
    }>();

    const path =
      request.route?.path ?? request.path ?? request.originalUrl ?? '';
    const activityType = this.mapSuccessActivity(request.method, path);
    const baseContext = this.getRequestContext(request);

    return next.handle().pipe(
      tap(() => {
        if (!activityType) {
          return;
        }
        void this.userActivityService.logActivity({
          userId: request.user?.id ?? null,
          activityType,
          description: this.describeActivity(activityType, path),
          ipAddress: baseContext.ipAddress,
          userAgent: baseContext.userAgent,
        });
      }),
      catchError((error: unknown) => {
        if (
          request.method === 'POST' &&
          (path === '/login' || path.includes('/auth/login'))
        ) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : 'Unknown authentication error';
          void this.userActivityService.logActivity({
            userId: null,
            activityType: ActivityType.AUTH_LOGIN_FAILED,
            description: 'Failed login attempt',
            ipAddress: baseContext.ipAddress,
            userAgent: baseContext.userAgent,
            metadata: { error: errorMessage },
          });
        }
        return throwError(() => error);
      }),
    );
  }

  private mapSuccessActivity(
    method: string,
    path: string,
  ): ActivityType | undefined {
    if (
      method === 'POST' &&
      (path === '/login' || path.includes('/auth/login'))
    ) {
      return ActivityType.AUTH_LOGIN_SUCCESS;
    }
    if (
      method === 'POST' &&
      (path === '/logout' || path.includes('/auth/logout'))
    ) {
      return ActivityType.AUTH_LOGOUT;
    }
    if (
      method === 'POST' &&
      (path === '/change-password' || path.includes('/auth/change-password'))
    ) {
      return ActivityType.AUTH_PASSWORD_CHANGED;
    }

    return undefined;
  }

  private describeActivity(activityType: ActivityType, path: string): string {
    switch (activityType) {
      case ActivityType.AUTH_LOGIN_SUCCESS:
        return 'User logged in successfully';
      case ActivityType.AUTH_LOGOUT:
        return 'User logged out';
      case ActivityType.AUTH_PASSWORD_CHANGED:
        return 'User changed account password';
      default:
        return `User activity captured for ${path}`;
    }
  }

  private getRequestContext(request: {
    headers?: Record<string, string | string[]>;
    ip?: string;
  }): { ipAddress: string | null; userAgent: string | null } {
    const trustProxy = this.configService.get<boolean>('TRUST_PROXY', false);
    const userAgent = request.headers?.['user-agent'];

    let resolvedIp = request.ip;
    if (trustProxy) {
      const forwardedFor = request.headers?.['x-forwarded-for'];
      resolvedIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : (forwardedFor?.split(',')[0]?.trim() ?? request.ip);
    }

    return {
      ipAddress: resolvedIp ?? null,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : (userAgent ?? null),
    };
  }
}
