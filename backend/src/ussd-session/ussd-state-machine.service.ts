import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import {
  UssdSessionStore,
  USSD_SESSION_TTL_SECONDS,
} from './ussd-session.store';
import {
  UssdSession,
  UssdStep,
  UssdResponse,
  BloodType,
  BloodBank,
} from './ussd.types';

export const BLOOD_TYPES = Object.values(BloodType);
export const BLOOD_BANKS: BloodBank[] = [
  { id: 'bb-001', name: 'Central Blood Bank', available: true },
  { id: 'bb-002', name: 'Northern Regional Bank', available: true },
  { id: 'bb-003', name: 'Eastern Medical Center', available: true },
  { id: 'bb-004', name: 'City Hospital Bank', available: true },
];
export const VALID_QUANTITIES = [1, 2, 3, 4, 5, 10];
const CANCEL_INPUT = '#';
const BACK_INPUT = '0';
const MAX_RESPONSE_LENGTH = 182; // Africa's Talking character limit
const SESSION_TTL_MS = USSD_SESSION_TTL_SECONDS * 1000;

@Injectable()
export class UssdStateMachine {
  private readonly logger = new Logger(UssdStateMachine.name);

  constructor(private readonly sessionStore: UssdSessionStore) {}

  async process(
    sessionId: string,
    phoneNumber: string,
    textInput: string,
    createOrder: (session: UssdSession) => Promise<void>,
  ): Promise<UssdResponse> {
    // Normalise input – Africa's Talking sends full accumulated input separated by *
    const inputs = textInput ? textInput.split('*').filter((part) => part.length > 0) : [];
    const currentInput = inputs[inputs.length - 1] ?? '';
    const requestDepth = inputs.length;

    let session = await this.sessionStore.get(sessionId);

    if (!session) {
      session = await this.sessionStore.createInitial(sessionId, phoneNumber);
    }

    if (session.phoneNumber !== phoneNumber) {
      session.phoneNumber = phoneNumber;
    }

    if (session.expiresAt <= Date.now()) {
      await this.sessionStore.delete(sessionId);
      return this.end('Session expired. Please start again.');
    }

    const requestFingerprint = this.buildRequestFingerprint(
      session.sessionNonce,
      sessionId,
      phoneNumber,
      textInput,
    );

    if (
      session.lastRequestFingerprint === requestFingerprint &&
      session.lastResponse
    ) {
      return session.lastResponse;
    }

    if (session.step === UssdStep.CANCELLED) {
      return this.end('Session cancelled. Goodbye.');
    }

    if (session.step === UssdStep.ORDER_PLACED) {
      return this.end('Request already submitted. Thank you.');
    }

    if (requestDepth > 0) {
      const expectedDepth = session.history.length + 1;
      if (requestDepth < expectedDepth) {
        return this.end('Session out of sync. Please start again.');
      }
      if (requestDepth > expectedDepth) {
        return this.end('Session sequence invalid. Please start again.');
      }
    }

    // Handle cancel
    if (currentInput === CANCEL_INPUT) {
      session.step = UssdStep.CANCELLED;
      const response = this.end('Session cancelled. Goodbye.');
      await this.persistTurn(session, requestFingerprint, requestDepth, response);
      return response;
    }

    const response = await this.transition(session, currentInput, createOrder);
    await this.persistTurn(session, requestFingerprint, requestDepth, response);
    return response;
  }

  private buildRequestFingerprint(
    sessionNonce: string,
    sessionId: string,
    phoneNumber: string,
    textInput: string,
  ): string {
    return createHash('sha256')
      .update(`${sessionNonce}:${sessionId}:${phoneNumber}:${textInput}`)
      .digest('hex');
  }

  private async persistTurn(
    session: UssdSession,
    requestFingerprint: string,
    requestDepth: number,
    response: UssdResponse,
  ): Promise<void> {
    session.lastRequestFingerprint = requestFingerprint;
    session.lastRequestDepth = requestDepth;
    session.lastResponse = response;
    session.lastProcessedAt = Date.now();
    session.sequenceNumber = Math.max(session.sequenceNumber, requestDepth);
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    await this.sessionStore.set(session);
  }

  private async transition(
    session: UssdSession,
    input: string,
    createOrder: (session: UssdSession) => Promise<void>,
  ): Promise<UssdResponse> {
    // Handle back navigation (not on first step)
    if (input === BACK_INPUT && session.history.length > 0) {
      session.step = session.history.pop()!;
      await this.sessionStore.set(session);
      return this.promptForStep(session);
    }

    switch (session.step) {
      case UssdStep.LOGIN_PHONE:
        return this.handleLoginPhone(session, input);
      case UssdStep.LOGIN_PIN:
        return this.handleLoginPin(session, input);
      case UssdStep.SELECT_BLOOD_TYPE:
        return this.handleSelectBloodType(session, input);
      case UssdStep.SELECT_QUANTITY:
        return this.handleSelectQuantity(session, input);
      case UssdStep.SELECT_BLOOD_BANK:
        return this.handleSelectBloodBank(session, input);
      case UssdStep.CONFIRM_ORDER:
        return this.handleConfirmOrder(session, input, createOrder);
      case UssdStep.ORDER_PLACED:
        return this.end('Request already submitted. Thank you.');
      case UssdStep.CANCELLED:
        return this.end('Session cancelled. Goodbye.');
      default:
        await this.sessionStore.delete(session.sessionId);
        return this.end('An error occurred. Please try again.');
    }
  }

  // --- Step handlers ---

  private async handleLoginPhone(
    session: UssdSession,
    input: string,
  ): Promise<UssdResponse> {
    if (!input) {
      return this.promptForStep(session);
    }
    const phone = input.trim();
    if (!/^\+?[0-9]{7,15}$/.test(phone)) {
      return this.con(
        'Invalid phone number.\nEnter your registered phone number:',
      );
    }
    session.userId = phone; // placeholder – real impl would look up user by phone
    session.history.push(session.step);
    session.step = UssdStep.LOGIN_PIN;
    await this.sessionStore.set(session);
    return this.promptForStep(session);
  }

  private async handleLoginPin(
    session: UssdSession,
    input: string,
  ): Promise<UssdResponse> {
    if (!input) {
      return this.promptForStep(session);
    }
    if (!/^\d{4,6}$/.test(input.trim())) {
      return this.con('Invalid PIN. Enter your 4-6 digit PIN:\n(0 to go back)');
    }
    // TODO: replace stub with real auth service call
    const pinValid = input.trim().length >= 4; // stub
    if (!pinValid) {
      return this.con('Incorrect PIN. Try again:\n(0 to go back)');
    }
    session.history.push(session.step);
    session.step = UssdStep.SELECT_BLOOD_TYPE;
    await this.sessionStore.set(session);
    return this.promptForStep(session);
  }

  private async handleSelectBloodType(
    session: UssdSession,
    input: string,
  ): Promise<UssdResponse> {
    if (!input) {
      return this.promptForStep(session);
    }
    const idx = parseInt(input, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= BLOOD_TYPES.length) {
      return this.con(`Invalid choice.\n${this.buildBloodTypeMenu()}`);
    }
    session.selectedBloodType = BLOOD_TYPES[idx];
    session.history.push(session.step);
    session.step = UssdStep.SELECT_QUANTITY;
    await this.sessionStore.set(session);
    return this.promptForStep(session);
  }

  private async handleSelectQuantity(
    session: UssdSession,
    input: string,
  ): Promise<UssdResponse> {
    if (!input) {
      return this.promptForStep(session);
    }
    const idx = parseInt(input, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= VALID_QUANTITIES.length) {
      return this.con(`Invalid choice.\n${this.buildQuantityMenu()}`);
    }
    session.selectedQuantity = VALID_QUANTITIES[idx];
    session.history.push(session.step);
    session.step = UssdStep.SELECT_BLOOD_BANK;
    await this.sessionStore.set(session);
    return this.promptForStep(session);
  }

  private async handleSelectBloodBank(
    session: UssdSession,
    input: string,
  ): Promise<UssdResponse> {
    if (!input) {
      return this.promptForStep(session);
    }
    const available = BLOOD_BANKS.filter((b) => b.available);
    const idx = parseInt(input, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= available.length) {
      return this.con(`Invalid choice.\n${this.buildBloodBankMenu()}`);
    }
    const bank = available[idx];
    session.selectedBloodBankId = bank.id;
    session.selectedBloodBankName = bank.name;
    session.history.push(session.step);
    session.step = UssdStep.CONFIRM_ORDER;
    await this.sessionStore.set(session);
    return this.promptForStep(session);
  }

  private async handleConfirmOrder(
    session: UssdSession,
    input: string,
    createOrder: (s: UssdSession) => Promise<void>,
  ): Promise<UssdResponse> {
    if (!input) {
      return this.promptForStep(session);
    }
    if (input === '1') {
      try {
        await createOrder(session);
        session.step = UssdStep.ORDER_PLACED;
        await this.sessionStore.set(session);
        return this.end(
          `Order placed!\nBlood: ${session.selectedBloodType}\nUnits: ${session.selectedQuantity}\nBank: ${session.selectedBloodBankName}\nThank you.`,
        );
      } catch (err) {
        this.logger.error('Order creation failed', err);
        return this.end('Order failed. Please try again or call support.');
      }
    } else if (input === '2') {
      // Go back to blood type selection
      session.step = UssdStep.SELECT_BLOOD_TYPE;
      session.history = [];
      await this.sessionStore.set(session);
      return this.promptForStep(session);
    } else {
      return this.con(`Invalid choice.\n${this.buildConfirmMenu(session)}`);
    }
  }

  // --- Menu builders ---

  private promptForStep(session: UssdSession): UssdResponse {
    switch (session.step) {
      case UssdStep.LOGIN_PHONE:
        return this.con(
          'Welcome to DonorHub\nEnter your registered phone number:',
        );
      case UssdStep.LOGIN_PIN:
        return this.con('Enter your PIN:\n(0 to go back)');
      case UssdStep.SELECT_BLOOD_TYPE:
        return this.con(
          `Select blood type:\n${this.buildBloodTypeMenu()}\n0 Back`,
        );
      case UssdStep.SELECT_QUANTITY:
        return this.con(
          `Select quantity (units):\n${this.buildQuantityMenu()}\n0 Back`,
        );
      case UssdStep.SELECT_BLOOD_BANK:
        return this.con(
          `Select blood bank:\n${this.buildBloodBankMenu()}\n0 Back`,
        );
      case UssdStep.CONFIRM_ORDER:
        return this.con(this.buildConfirmMenu(session));
      case UssdStep.ORDER_PLACED:
        return this.end('Request already submitted. Thank you.');
      case UssdStep.CANCELLED:
        return this.end('Session cancelled. Goodbye.');
      default:
        return this.end('Session error. Please try again.');
    }
  }

  private buildBloodTypeMenu(): string {
    return BLOOD_TYPES.map((t, i) => `${i + 1}. ${t}`).join('\n');
  }

  private buildQuantityMenu(): string {
    return VALID_QUANTITIES.map(
      (q, i) => `${i + 1}. ${q} unit${q > 1 ? 's' : ''}`,
    ).join('\n');
  }

  private buildBloodBankMenu(): string {
    return BLOOD_BANKS.filter((b) => b.available)
      .map((b, i) => `${i + 1}. ${b.name}`)
      .join('\n');
  }

  private buildConfirmMenu(session: UssdSession): string {
    return (
      `Confirm order:\n` +
      `Blood: ${session.selectedBloodType}\n` +
      `Units: ${session.selectedQuantity}\n` +
      `Bank: ${session.selectedBloodBankName}\n` +
      `1. Confirm\n2. Change\n# Cancel`
    );
  }

  // --- Response helpers ---

  private con(message: string): UssdResponse {
    return { type: 'CON', message: this.truncate(message) };
  }

  private end(message: string): UssdResponse {
    return { type: 'END', message: this.truncate(message) };
  }

  private truncate(msg: string): string {
    return msg.length > MAX_RESPONSE_LENGTH
      ? msg.substring(0, MAX_RESPONSE_LENGTH - 3) + '...'
      : msg;
  }
}
