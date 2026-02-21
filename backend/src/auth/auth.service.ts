import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<unknown> {
    // TODO: Query user from DB and verify hashed password
    void email;
    void password;
    return null;
  }

  async login(loginDto: { email: string; password: string; role?: string }) {
    // TODO: Replace with real user lookup + bcrypt comparison
    const payload: JwtPayload = {
      sub: 'placeholder-user-id',
      email: loginDto.email,
      role: loginDto.role ?? 'donor',
    };

    const accessToken = this.jwtService.sign(payload as unknown as Record<string, unknown>);
    const refreshRefreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const refreshToken = this.jwtService.sign(
      payload as unknown as Record<string, unknown>,
      {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ?? 'refresh-secret',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expiresIn: refreshRefreshExpiresIn as any,
      },
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  async register(registerDto: {
    email: string;
    password: string;
    role?: string;
    name?: string;
  }) {
    // TODO: Hash password and persist user in DB; check for duplicate emails
    void registerDto;
    throw new ConflictException('Registration not yet implemented');
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>(
          'JWT_REFRESH_SECRET',
          'refresh-secret',
        ),
      });

      const newPayload: JwtPayload = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      return {
        access_token: this.jwtService.sign(newPayload),
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userId: string) {
    // TODO: Blacklist the token / clear refresh token from DB
    void userId;
    return { message: 'Logged out successfully' };
  }
}
