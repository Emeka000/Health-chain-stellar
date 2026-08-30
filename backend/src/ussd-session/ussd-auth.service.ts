import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  dummyVerify,
  verifyPassword,
} from '../auth/utils/password.util';
import { UserEntity } from '../users/entities/user.entity';
import { UserRepository } from '../users/user.repository';

export type UssdPinVerificationResult =
  | { success: true; userId: string }
  | { success: false; reason: 'not_found' | 'locked' | 'invalid_pin' };

@Injectable()
export class UssdAuthService {
  private readonly maxFailedPinAttempts: number;
  private readonly pinLockMinutes: number;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly configService: ConfigService,
  ) {
    this.maxFailedPinAttempts = this.configService.get<number>(
      'MAX_FAILED_USSD_PIN_ATTEMPTS',
      5,
    );
    this.pinLockMinutes = this.configService.get<number>(
      'USSD_PIN_LOCK_MINUTES',
      15,
    );
  }

  async findUserByPhoneNumber(
    phoneNumber: string,
  ): Promise<UserEntity | null> {
    return this.userRepository.findByPhoneNumber(phoneNumber);
  }

  async verifyPin(
    phoneNumber: string,
    pin: string,
  ): Promise<UssdPinVerificationResult> {
    const user = await this.userRepository.findByPhoneNumber(phoneNumber);

    if (!user || !user.ussdPinHash) {
      await dummyVerify(pin);
      return { success: false, reason: 'not_found' };
    }

    if (user.ussdPinLockedUntil) {
      if (user.ussdPinLockedUntil.getTime() > Date.now()) {
        return { success: false, reason: 'locked' };
      }
      user.ussdPinFailedAttempts = 0;
      user.ussdPinLockedUntil = null;
    }

    const valid = await verifyPassword(pin, user.ussdPinHash);
    if (!valid) {
      await this.recordFailedPinAttempt(user);
      return { success: false, reason: 'invalid_pin' };
    }

    if (user.ussdPinFailedAttempts || user.ussdPinLockedUntil) {
      user.ussdPinFailedAttempts = 0;
      user.ussdPinLockedUntil = null;
      await this.userRepository.save(user);
    }

    return { success: true, userId: user.id };
  }

  private async recordFailedPinAttempt(user: UserEntity): Promise<void> {
    user.ussdPinFailedAttempts = (user.ussdPinFailedAttempts ?? 0) + 1;
    if (user.ussdPinFailedAttempts >= this.maxFailedPinAttempts) {
      const lockedUntil = new Date();
      lockedUntil.setMinutes(lockedUntil.getMinutes() + this.pinLockMinutes);
      user.ussdPinLockedUntil = lockedUntil;
    }
    await this.userRepository.save(user);
  }
}
