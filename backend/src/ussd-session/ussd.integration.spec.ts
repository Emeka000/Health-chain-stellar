/**
 * Integration tests that simulate complete end-to-end USSD session flows.
 *
 * These tests use a real UssdStateMachine with an in-memory session store
 * (Redis mock) to verify multi-step navigation works correctly end-to-end.
 */
import { Test, TestingModule } from '@nestjs/testing';

import { UssdSessionStore, REDIS_CLIENT } from './ussd-session.store';
import {
  UssdStateMachine,
  BLOOD_TYPES,
  VALID_QUANTITIES,
  BLOOD_BANKS,
} from './ussd-state-machine.service';
import { UssdSession, UssdStep } from './ussd.types';

/** In-memory Redis shim so integration tests don't need a real Redis instance */
class InMemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<string> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  clear(): void {
    this.store.clear();
  }
}

describe('USSD Integration Tests', () => {
  let machine: UssdStateMachine;
  let redis: InMemoryRedis;
  const createOrder = jest.fn().mockResolvedValue(undefined);

  const SESSION_ID = 'integ-sess-001';
  const PHONE = '+2348012345678';

  // Helper: builds the accumulated text string that Africa's Talking sends
  const buildText = (...inputs: string[]) => inputs.join('*');

  // Helper: drive the state machine one step
  const step = (text: string) =>
    machine.process(SESSION_ID, PHONE, text, createOrder);

  beforeEach(async () => {
    redis = new InMemoryRedis();
    createOrder.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UssdStateMachine,
        UssdSessionStore,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    machine = module.get<UssdStateMachine>(UssdStateMachine);
  });

  describe('Happy path – complete order placement', () => {
    it('completes a full blood order via USSD', async () => {
      // Step 0: new session → welcome screen
      let res = await step('');
      expect(res.type).toBe('CON');
      expect(res.message).toContain('Welcome');

      // Step 1: enter phone number
      res = await step('+2348012345678');
      expect(res.type).toBe('CON');
      expect(res.message.toLowerCase()).toContain('pin');

      // Step 2: enter PIN
      res = await step(buildText('+2348012345678', '1234'));
      expect(res.type).toBe('CON');
      expect(res.message).toContain('blood type');

      // Step 3: select blood type (1 = A+)
      res = await step(buildText('+2348012345678', '1234', '1'));
      expect(res.type).toBe('CON');
      expect(res.message).toContain('quantity');

      // Step 4: select quantity (2 = 2 units)
      res = await step(buildText('+2348012345678', '1234', '1', '2'));
      expect(res.type).toBe('CON');
      expect(res.message).toContain('blood bank');

      // Step 5: select blood bank (1 = Central Blood Bank)
      res = await step(buildText('+2348012345678', '1234', '1', '2', '1'));
      expect(res.type).toBe('CON');
      expect(res.message).toContain('Confirm');
      expect(res.message).toContain(BLOOD_TYPES[0]); // A+
      expect(res.message).toContain(String(VALID_QUANTITIES[1])); // 2 units
      expect(res.message).toContain(BLOOD_BANKS[0].name);

      // Step 6: confirm order
      res = await step(buildText('+2348012345678', '1234', '1', '2', '1', '1'));
      expect(res.type).toBe('END');
      expect(res.message).toContain('Order placed');
      expect(createOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe('Back navigation', () => {
    it('navigates back from blood type selection to PIN entry', async () => {
      await step('');
      await step('+2348012345678');
      let res = await step(buildText('+2348012345678', '1234'));
      expect(res.message).toContain('blood type');

      // Go back
      res = await step(buildText('+2348012345678', '1234', '0'));
      expect(res.type).toBe('CON');
      expect(res.message.toLowerCase()).toContain('pin');
    });

    it('navigates back from quantity to blood type', async () => {
      await step('');
      await step('+2348012345678');
      await step(buildText('+2348012345678', '1234'));
      let res = await step(buildText('+2348012345678', '1234', '1'));
      expect(res.message).toContain('quantity');

      res = await step(buildText('+2348012345678', '1234', '1', '0'));
      expect(res.type).toBe('CON');
      expect(res.message).toContain('blood type');
    });
  });

  describe('Cancel with #', () => {
    it('terminates session immediately on # at any step', async () => {
      await step('');
      await step('+2348012345678');

      const res = await step(buildText('+2348012345678', '#'));
      expect(res.type).toBe('END');
      expect(res.message).toContain('cancelled');

      // Verify terminal state is retained until TTL expiry
      const sessionKey = 'ussd:session:' + SESSION_ID;
      const rawSession = await redis.get(sessionKey);
      expect(rawSession).not.toBeNull();
    });
  });

  describe('Duplicate callbacks', () => {
    it('returns the same response when a callback is replayed', async () => {
      await step('');
      const first = await step('+2348012345678');
      const duplicate = await step('+2348012345678');

      expect(duplicate).toEqual(first);
    });
  });

  describe('Invalid inputs – re-prompt without crashing', () => {
    it('re-prompts for invalid phone number', async () => {
      await step('');
      const res = await step('not-a-phone');
      expect(res.type).toBe('CON');
      expect(res.message).toContain('Invalid phone');
    });

    it('re-prompts for invalid PIN', async () => {
      await step('');
      await step('+2348012345678');
      const res = await step(buildText('+2348012345678', 'xx'));
      expect(res.type).toBe('CON');
      expect(res.message).toContain('Invalid PIN');
    });

    it('re-prompts for out-of-range blood type', async () => {
      await step('');
      await step('+2348012345678');
      await step(buildText('+2348012345678', '1234'));
      const res = await step(buildText('+2348012345678', '1234', '99'));
      expect(res.type).toBe('CON');
      expect(res.message).toContain('Invalid choice');
    });

    it('re-prompts for out-of-range quantity', async () => {
      await step('');
      await step('+2348012345678');
      await step(buildText('+2348012345678', '1234'));
      await step(buildText('+2348012345678', '1234', '1'));
      const res = await step(buildText('+2348012345678', '1234', '1', '999'));
      expect(res.type).toBe('CON');
      expect(res.message).toContain('Invalid choice');
    });

    it('re-prompts for invalid bank selection', async () => {
      await step('');
      await step('+2348012345678');
      await step(buildText('+2348012345678', '1234'));
      await step(buildText('+2348012345678', '1234', '1'));
      await step(buildText('+2348012345678', '1234', '1', '1'));
      const res = await step(
        buildText('+2348012345678', '1234', '1', '1', 'xyz'),
      );
      expect(res.type).toBe('CON');
      expect(res.message).toContain('Invalid choice');
    });

    it('re-prompts for invalid confirmation input', async () => {
      await step('');
      await step('+2348012345678');
      await step(buildText('+2348012345678', '1234'));
      await step(buildText('+2348012345678', '1234', '1'));
      await step(buildText('+2348012345678', '1234', '1', '1'));
      await step(buildText('+2348012345678', '1234', '1', '1', '1'));
      const res = await step(
        buildText('+2348012345678', '1234', '1', '1', '1', '9'),
      );
      expect(res.type).toBe('CON');
      expect(res.message).toContain('Invalid choice');
    });
  });

  describe('Change order (input 2 at confirmation)', () => {
    it('restarts selection from blood type when user chooses to change', async () => {
      await step('');
      await step('+2348012345678');
      await step(buildText('+2348012345678', '1234'));
      await step(buildText('+2348012345678', '1234', '1'));
      await step(buildText('+2348012345678', '1234', '1', '1'));
      await step(buildText('+2348012345678', '1234', '1', '1', '1'));
      const res = await step(
        buildText('+2348012345678', '1234', '1', '1', '1', '2'),
      );
      expect(res.type).toBe('CON');
      expect(res.message).toContain('blood type');
    });
  });

  describe('Response time', () => {
    it('each step responds within 2 seconds', async () => {
      const steps = [
        () => step(''),
        () => step('+2348012345678'),
        () => step(buildText('+2348012345678', '1234')),
        () => step(buildText('+2348012345678', '1234', '1')),
        () => step(buildText('+2348012345678', '1234', '1', '1')),
        () => step(buildText('+2348012345678', '1234', '1', '1', '1')),
        () => step(buildText('+2348012345678', '1234', '1', '1', '1', '1')),
      ];

      // fresh session for each timing sub-test (reset redis)
      for (const fn of steps) {
        const start = Date.now();
        await fn();
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
      }
    }, 15_000);
  });
});
