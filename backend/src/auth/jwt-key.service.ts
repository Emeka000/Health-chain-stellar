import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SigningKey {
  kid: string;
  secret: string;
}

/**
 * Holds the active signing key and an optional previous key for grace-period
 * validation. New tokens are always signed with the active key. Tokens signed
 * with the previous key are still accepted until they expire naturally.
 */
@Injectable()
export class JwtKeyService {
  private readonly activeKey: SigningKey;
  private readonly previousKey: SigningKey | null;

  constructor(private readonly configService: ConfigService) {
    this.activeKey = {
      kid: configService.get<string>('JWT_SECRET_KID', 'key-1'),
      secret: configService.getOrThrow<string>('JWT_SECRET'),
    };

    const prevSecret = configService.get<string>('JWT_PREVIOUS_SECRET');
    this.previousKey = prevSecret
      ? {
          kid: configService.get<string>('JWT_PREVIOUS_SECRET_KID', 'key-0'),
          secret: prevSecret,
        }
      : null;
  }

  getActiveKey(): SigningKey {
    return this.activeKey;
  }

  /** Returns the secret for the given kid, or null if unknown. */
  resolveSecret(kid: string): string | null {
    if (kid === this.activeKey.kid) return this.activeKey.secret;
    if (this.previousKey && kid === this.previousKey.kid)
      return this.previousKey.secret;
    return null;
  }
}
