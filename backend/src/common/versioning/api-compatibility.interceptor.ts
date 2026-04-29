import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';

import {
  API_COMPATIBILITY_CLASS_KEY,
  API_DEPRECATION_KEY,
  API_LEGACY_ADAPTER_KEY,
  ApiCompatibilityClass,
  ApiDeprecationMetadata,
  LegacyAdapterFn,
} from './api-compatibility.decorator';

@Injectable()
export class ApiCompatibilityInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{
      headers: Record<string, string | undefined>;
      query: Record<string, string | undefined>;
    }>();
    const res = http.getResponse<{
      setHeader: (name: string, value: string) => void;
      getHeader: (name: string) => string | number | string[] | undefined;
    }>();

    const compatibilityClass =
      this.reflector.get<ApiCompatibilityClass>(
        API_COMPATIBILITY_CLASS_KEY,
        context.getHandler(),
      ) ?? ApiCompatibilityClass.STRICT;

    const deprecation = this.reflector.get<ApiDeprecationMetadata>(
      API_DEPRECATION_KEY,
      context.getHandler(),
    );
    const adapter = this.reflector.get<LegacyAdapterFn>(
      API_LEGACY_ADAPTER_KEY,
      context.getHandler(),
    );

    res.setHeader('X-API-Compatibility-Class', compatibilityClass);

    const legacyRequested =
      req.query?.compat === 'legacy' ||
      String(req.headers?.['x-api-client-shape'] ?? '').toLowerCase() ===
        'legacy';

    if (deprecation?.deprecation) {
      this.applyDeprecationHeaders(res, deprecation);
    }

    if (legacyRequested && adapter) {
      const vary = res.getHeader('Vary');
      res.setHeader('Vary', vary ? `${String(vary)}, X-API-Client-Shape` : 'X-API-Client-Shape');
      res.setHeader('X-API-Response-Shape', 'legacy');
      // Legacy mode is maintained for backward compatibility and should be sunset.
      res.setHeader('Deprecation', 'true');
      if (!deprecation?.sunset) {
        res.setHeader('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');
      }
      return next.handle().pipe(map((payload) => adapter(payload)));
    }

    res.setHeader('X-API-Response-Shape', 'canonical');
    return next.handle();
  }

  private applyDeprecationHeaders(
    res: { setHeader: (name: string, value: string) => void },
    deprecation: ApiDeprecationMetadata,
  ): void {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', deprecation.sunset);
    if (deprecation.successorPath) {
      res.setHeader('Link', `<${deprecation.successorPath}>; rel="successor-version"`);
    }
  }
}
