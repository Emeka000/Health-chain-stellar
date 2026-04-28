import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { AUDITABLE_KEY, AuditableOptions } from './auditable.decorator';
import { AuditLogService } from './audit-log.service';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditableOptions | undefined>(
      AUDITABLE_KEY,
      context.getHandler(),
    );

    if (!options) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<any>();
    const user = req.user as { id?: string; role?: string } | undefined;
    const actorId = user?.id ?? 'anonymous';
    const actorRole = user?.role ?? 'unknown';

    // Extract request metadata
    const ipAddress: string | null =
      (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip ??
      null;

    const userAgent: string | null = req.headers?.['user-agent'] ?? null;
    const correlationId: string | null = req.correlationId ?? null;

    const paramKey = options.resourceIdParam ?? 'id';
    const resourceId: string =
      req.params?.[paramKey] ?? req.body?.id ?? 'unknown';

    // Capture request body as "previous intent" — actual before/after state
    // is captured from the handler response.
    const requestBody = req.body ? { ...req.body } : null;

    // Extract metadata from options or request
    const metadata = {
      ...(options.metadata ?? {}),
      endpoint: `${req.method} ${req.url}`,
      ...(req.body?.reason && { reason: req.body.reason }),
      ...(req.body?.comment && { comment: req.body.comment }),
      ...(req.body?.note && { note: req.body.note }),
    };

    return next.handle().pipe(
      tap({
        next: (responseBody: unknown) => {
          // Extract the actual resource from the response (handles { data: ... } wrappers)
          const nextValue =
            responseBody && typeof responseBody === 'object'
              ? ((responseBody as any).data ?? responseBody)
              : responseBody;

          void this.auditLogService.insert({
            actorId,
            actorRole,
            action: options.action,
            resourceType: options.resourceType,
            resourceId,
            previousValue: requestBody,
            nextValue: nextValue as Record<string, unknown> | null,
            ipAddress,
            userAgent,
            correlationId,
            metadata: Object.keys(metadata).length > 0 ? metadata : null,
          });
        },
      }),
    );
  }
}
