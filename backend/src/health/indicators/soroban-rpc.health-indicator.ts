import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

/**
 * Custom health indicator for the Soroban RPC endpoint.
 * Performs a lightweight HTTP GET to the configured RPC URL and
 * expects a 200 response within the timeout window.
 */
@Injectable()
export class SorobanRpcHealthIndicator extends HealthIndicator {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const rpcUrl = this.config.get<string>('SOROBAN_RPC_URL', 'http://localhost:8000');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(rpcUrl, { signal: controller.signal });
      clearTimeout(timeout);

      // Soroban RPC returns 200 or 405 on the root path — both mean it's alive
      if (res.status < 500) {
        return this.getStatus(key, true);
      }
      throw new Error(`Unexpected status ${res.status}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HealthCheckError(
        'Soroban RPC check failed',
        this.getStatus(key, false, { message }),
      );
    }
  }
}
