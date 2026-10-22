import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';

describe('AuthController - Idempotency (Issue 1685)', () => {
  let controller: AuthController;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
            refreshToken: jest.fn(),
            logout: jest.fn(),
            changePassword: jest.fn(),
            register: jest.fn(),
            getActiveSessions: jest.fn(),
            revokeSession: jest.fn(),
            revokeIfRisky: jest.fn(),
            manualUnlockByAdmin: jest.fn(),
            revokeAllUserSessionsByAdmin: jest.fn(),
            exchangeMfaToken: jest.fn(),
          },
        },
        {
          provide: PasswordResetService,
          useValue: {
            verifyEmail: jest.fn(),
            resendVerificationEmail: jest.fn(),
            requestPasswordReset: jest.fn(),
            resetPassword: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  describe('Idempotency Interceptor Removal', () => {
    it('login endpoint should not use IdempotencyInterceptor', async () => {
      // Check that the login method has no IdempotencyInterceptor
      const loginMetadata = Reflect.getMetadata('__decorators__', AuthController.prototype.login);

      // Verify no UseInterceptors decorator with IdempotencyInterceptor
      const hasIdempotencyInterceptor = loginMetadata?.some((decorator: any) =>
        decorator.name === 'UseInterceptors' &&
        decorator.args?.[0]?.name === 'IdempotencyInterceptor'
      );

      expect(hasIdempotencyInterceptor).toBeFalsy();
    });

    it('refresh endpoint should not use IdempotencyInterceptor', async () => {
      const refreshMetadata = Reflect.getMetadata('__decorators__', AuthController.prototype.refresh);

      const hasIdempotencyInterceptor = refreshMetadata?.some((decorator: any) =>
        decorator.name === 'UseInterceptors' &&
        decorator.args?.[0]?.name === 'IdempotencyInterceptor'
      );

      expect(hasIdempotencyInterceptor).toBeFalsy();
    });

    it('logout endpoint should not use IdempotencyInterceptor', async () => {
      const logoutMetadata = Reflect.getMetadata('__decorators__', AuthController.prototype.logout);

      const hasIdempotencyInterceptor = logoutMetadata?.some((decorator: any) =>
        decorator.name === 'UseInterceptors' &&
        decorator.args?.[0]?.name === 'IdempotencyInterceptor'
      );

      expect(hasIdempotencyInterceptor).toBeFalsy();
    });

    it('changePassword endpoint should not use IdempotencyInterceptor', async () => {
      const changePasswordMetadata = Reflect.getMetadata('__decorators__', AuthController.prototype.changePassword);

      const hasIdempotencyInterceptor = changePasswordMetadata?.some((decorator: any) =>
        decorator.name === 'UseInterceptors' &&
        decorator.args?.[0]?.name === 'IdempotencyInterceptor'
      );

      expect(hasIdempotencyInterceptor).toBeFalsy();
    });

    it('register endpoint should not use IdempotencyInterceptor', async () => {
      const registerMetadata = Reflect.getMetadata('__decorators__', AuthController.prototype.register);

      const hasIdempotencyInterceptor = registerMetadata?.some((decorator: any) =>
        decorator.name === 'UseInterceptors' &&
        decorator.args?.[0]?.name === 'IdempotencyInterceptor'
      );

      expect(hasIdempotencyInterceptor).toBeFalsy();
    });
  });

  describe('Login with wrong credentials and idempotency key', () => {
    it('should return 401 on second attempt with wrong credentials', async () => {
      // The removal of IdempotencyInterceptor means each request is processed independently
      // Even if the same idempotency key is used, a login with wrong credentials
      // will be attempted fresh and should return 401

      const loginDto1 = { email: 'user@example.com', password: 'wrong' };
      const loginError = new Error('Invalid credentials');

      jest.spyOn(authService, 'login').mockRejectedValue(loginError);

      const req1 = {
        headers: { 'user-agent': 'test' }
      };

      // First attempt with wrong credentials should fail
      await expect(
        controller.login(loginDto1, req1)
      ).rejects.toThrow();

      // Attempting the same request again should also fail
      // (not return cached success from a previous correct login)
      await expect(
        controller.login(loginDto1, req1)
      ).rejects.toThrow();

      expect(authService.login).toHaveBeenCalledTimes(2);
    });
  });
});
