import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';

import { ExtractJwt, Strategy } from 'passport-jwt';
import { decode } from 'jsonwebtoken';

import { JwtKeyService } from './jwt-key.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  sid?: string;
  organizationId?: string | null;
  jti?: string;
  kid?: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  sid?: string;
  organizationId?: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly jwtKeyService: JwtKeyService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: (
        _req: unknown,
        rawToken: string,
        done: (err: Error | null, secret?: string) => void,
      ) => {
        const decoded = decode(rawToken, { complete: true });
        const kid: string =
          (decoded?.header as Record<string, string>)?.kid ?? 'key-1';
        const secret = jwtKeyService.resolveSecret(kid);
        if (!secret) {
          return done(new UnauthorizedException('Unknown signing key'));
        }
        done(null, secret);
      },
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      sid: payload.sid,
      organizationId: payload.organizationId ?? null,
    };
  }
}
