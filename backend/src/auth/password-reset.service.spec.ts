import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Repository } from 'typeorm';

import { UserEntity } from '../users/entities/user.entity';

import { EmailVerificationEntity } from './entities/email-verification.entity';
import { PasswordResetTokenEntity } from './entities/password-reset-token.entity';
import { PasswordResetService } from './password-reset.service';
import { AuthSessionRepository } from './repositories/auth-session.repository';

const mockTransporter = { sendMail: jest.fn().mockResolvedValue({}) };
jest.mock('nodemailer', () => ({ createTransport: () => mockTransporter }));

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let userRepo: jest.Mocked<Partial<Repository<UserEntity>>>;
  let resetRepo: jest.Mocked<Partial<Repository<PasswordResetTokenEntity>>>;
  let verifyRepo: jest.Mocked<Partial<Repository<EmailVerificationEntity>>>;
  let configService: jest.Mocked<Partial<ConfigService>>;
  let authSessionRepo: { revokeUserSessions: jest.Mock };

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
      save: jest.fn(),
    };
    resetRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn((x) => x as PasswordResetTokenEntity),
    };
    verifyRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn((x) => x as EmailVerificationEntity),
    };
    configService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'PASSWORD_HISTORY_LENGTH') return 3;
        return defaultValue ?? 'http://localhost:3000';
      }),
    };
    authSessionRepo = {
      revokeUserSessions: jest.fn().mockResolvedValue(undefined),
    };

    service = new PasswordResetService(
      configService as ConfigService,
      userRepo as Repository<UserEntity>,
      resetRepo as Repository<PasswordResetTokenEntity>,
      verifyRepo as Repository<EmailVerificationEntity>,
      authSessionRepo as unknown as AuthSessionRepository,
    );
  });

  describe('requestPasswordReset', () => {
    it('returns success message even when user not found (prevents enumeration)', async () => {
      (userRepo.findOne as jest.Mock).mockResolvedValue(null);
      const result = await service.requestPasswordReset('unknown@example.com');
      expect(result.message).toContain('reset link was sent');
      expect(resetRepo.save).not.toHaveBeenCalled();
    });

    it('creates reset token and sends email for existing user', async () => {
      const user = { id: 'user-1', email: 'user@example.com' } as UserEntity;
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (resetRepo.findOne as jest.Mock).mockResolvedValue(null);
      (resetRepo.save as jest.Mock).mockResolvedValue({});

      const result = await service.requestPasswordReset('user@example.com');
      expect(result.message).toContain('reset link was sent');
      expect(resetRepo.save).toHaveBeenCalled();
      expect(mockTransporter.sendMail).toHaveBeenCalled();
    });

    it('rate limits repeated requests within 1 minute', async () => {
      const user = { id: 'user-1', email: 'user@example.com' } as UserEntity;
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (resetRepo.findOne as jest.Mock).mockResolvedValue({ id: 'existing-token' });

      const result = await service.requestPasswordReset('user@example.com');
      expect(result.message).toContain('reset link was sent');
      expect(resetRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('resets password with valid token', async () => {
      const record = { id: 'tok-1', userId: 'user-1' } as PasswordResetTokenEntity;
      const user = {
        id: 'user-1',
        passwordHash: 'old-hash',
        passwordHistory: [],
        failedLoginAttempts: 3,
        lockedUntil: new Date(Date.now() + 60_000),
      } as UserEntity;

      (resetRepo.findOne as jest.Mock).mockResolvedValue(record);
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (resetRepo.update as jest.Mock).mockResolvedValue({ affected: 1 });
      (userRepo.save as jest.Mock).mockResolvedValue(user);

      const result = await service.resetPassword('valid-token', 'NewPass123!');
      expect(result.message).toBe('Password reset successfully');
      expect(resetRepo.update).toHaveBeenCalledWith(
        { id: 'tok-1', used: false, expiresAt: expect.any(Object) },
        { used: true },
      );
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          passwordHash: expect.any(String),
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      );
      expect(authSessionRepo.revokeUserSessions).toHaveBeenCalledWith(
        'user-1',
        'Password reset',
      );
    });

    it('throws BadRequestException for invalid/expired token', async () => {
      (resetRepo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.resetPassword('bad-token', 'Weakpass1!'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyEmail', () => {
    it('marks email as verified with valid token', async () => {
      const record = { id: 'v-1', userId: 'user-1' } as EmailVerificationEntity;
      (verifyRepo.findOne as jest.Mock).mockResolvedValue(record);
      (userRepo.update as jest.Mock).mockResolvedValue({});
      (verifyRepo.update as jest.Mock).mockResolvedValue({});

      const result = await service.verifyEmail('valid-token');
      expect(result.message).toBe('Email verified successfully');
      expect(userRepo.update).toHaveBeenCalledWith('user-1', { emailVerified: true });
    });

    it('throws BadRequestException for invalid token', async () => {
      (verifyRepo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.verifyEmail('bad-token')).rejects.toThrow(BadRequestException);
    });
  });

  describe('resendVerificationEmail', () => {
    it('throws NotFoundException when user not found', async () => {
      (userRepo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.resendVerificationEmail('no-user')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when email already verified', async () => {
      (userRepo.findOne as jest.Mock).mockResolvedValue({ emailVerified: true } as UserEntity);
      await expect(service.resendVerificationEmail('user-1')).rejects.toThrow(BadRequestException);
    });

    it('sends verification email for unverified user', async () => {
      const user = { id: 'user-1', email: 'user@example.com', emailVerified: false } as UserEntity;
      (userRepo.findOne as jest.Mock).mockResolvedValue(user);
      (verifyRepo.save as jest.Mock).mockResolvedValue({});

      const result = await service.resendVerificationEmail('user-1');
      expect(result.message).toBe('Verification email sent');
    });
  });
});
