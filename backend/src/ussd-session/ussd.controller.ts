import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';

import { Public } from '../auth/decorators/public.decorator';

import { UssdService } from './ussd.service';

/**
 * Throttle tracker for the USSD gateway callback.
 *
 * Every USSD request arrives from the Africa's Talking gateway's egress IPs,
 * not from the end user's phone, so keying by IP would put the entire user
 * base into a single bucket. Key per phone number (falling back to the
 * session id) so each user gets their own allowance.
 */
export function ussdThrottleTracker(req: {
  body?: Record<string, string>;
  ip?: string;
}): string {
  const phoneNumber = req.body?.phoneNumber;
  if (phoneNumber) {
    return `ussd:phone:${phoneNumber}`;
  }
  const sessionId = req.body?.sessionId;
  if (sessionId) {
    return `ussd:session:${sessionId}`;
  }
  return `ussd:ip:${req.ip ?? 'unknown'}`;
}

/**
 * Africa's Talking USSD gateway callback.
 *
 * The gateway posts a form-encoded body with no Authorization header, so the
 * route is marked @Public() to bypass the global JwtAuthGuard. Instead of JWT
 * we authenticate the gateway via an allow-list of source IPs and/or a shared
 * secret in the callback URL (compared in constant time). The per-user PIN
 * check remains inside the USSD state machine.
 */
@ApiTags('USSD')
@Throttle({
  default: {
    limit: 30,
    ttl: 60_000,
    getTracker: ussdThrottleTracker,
  },
  gateway: {
    limit: 600,
    ttl: 60_000,
    getTracker: (req: { ip?: string }) => `ussd:gateway:${req.ip ?? 'unknown'}`,
  },
})
@Controller('ussd')
export class UssdController {
  constructor(private readonly ussdService: UssdService) {}

  @Public()
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Africa's Talking USSD session callback" })
  async handleSession(
    @Body() body: Record<string, string>,
    @Ip() ip: string,
    @Headers('x-ussd-secret') headerSecret?: string,
  ): Promise<string> {
    this.assertGatewayAuthenticated(ip, body, headerSecret);
    return this.ussdService.handleSession(body);
  }

  private assertGatewayAuthenticated(
    ip: string,
    body: Record<string, string>,
    headerSecret?: string,
  ): void {
    const allowedIps = (process.env.USSD_ALLOWED_IPS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const sharedSecret = process.env.USSD_CALLBACK_SECRET;

    const ipAllowed = allowedIps.length > 0 && allowedIps.includes(ip);
    const providedSecret = headerSecret ?? body?.secret;
    const secretValid =
      !!sharedSecret &&
      !!providedSecret &&
      this.safeEqual(sharedSecret, providedSecret);

    if (!ipAllowed && !secretValid) {
      throw new UnauthorizedException('Invalid USSD gateway credentials');
    }
  }

  private safeEqual(expected: string, provided: string): boolean {
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, providedBuf);
  }
}
