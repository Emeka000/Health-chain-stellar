/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { UssdController } from './ussd.controller';
import { UssdService } from './ussd.service';

describe('UssdController', () => {
  let controller: UssdController;
  let ussdService: jest.Mocked<UssdService>;

  const GATEWAY_IP = '197.210.0.1';
  const SECRET = 'test-callback-secret';
  const originalAllowedIps = process.env.USSD_ALLOWED_IPS;
  const originalSecret = process.env.USSD_CALLBACK_SECRET;

  beforeEach(async () => {
    process.env.USSD_ALLOWED_IPS = GATEWAY_IP;
    process.env.USSD_CALLBACK_SECRET = SECRET;

    ussdService = {
      handleSession: jest.fn(),
    } as unknown as jest.Mocked<UssdService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UssdController],
      providers: [{ provide: UssdService, useValue: ussdService }],
    }).compile();

    controller = module.get<UssdController>(UssdController);
  });

  afterEach(() => {
    if (originalAllowedIps === undefined) {
      delete process.env.USSD_ALLOWED_IPS;
    } else {
      process.env.USSD_ALLOWED_IPS = originalAllowedIps;
    }
    if (originalSecret === undefined) {
      delete process.env.USSD_CALLBACK_SECRET;
    } else {
      process.env.USSD_CALLBACK_SECRET = originalSecret;
    }
  });

  it('returns CON plain-text response for continuing sessions', async () => {
    ussdService.handleSession.mockResolvedValue({
      type: 'CON',
      message: 'Select blood type',
    });
    const body: Record<string, string> = {
      sessionId: 'sess-001',
      serviceCode: '*123#',
      phoneNumber: '+2348012345678',
      text: '',
    };

    await expect(controller.handleSession(body, GATEWAY_IP)).resolves.toBe(
      'CON Select blood type',
    );
  });

  it('returns END plain-text response for terminal sessions', async () => {
    ussdService.handleSession.mockResolvedValue({
      type: 'END',
      message: 'Order placed!',
    });
    const body: Record<string, string> = {
      sessionId: 'sess-001',
      serviceCode: '*123#',
      phoneNumber: '+2348012345678',
      text: 'phone*1234*1*1*1*1',
    };

    await expect(controller.handleSession(body, GATEWAY_IP)).resolves.toBe(
      'END Order placed!',
    );
  });

  it('sends the reply as text/plain', () => {
    const headers = Reflect.getMetadata(
      '__headers__',
      UssdController.prototype.handleSession,
    );
    expect(headers).toEqual([{ name: 'Content-Type', value: 'text/plain' }]);
  });

  it('forwards all body fields to UssdService', async () => {
    ussdService.handleSession.mockResolvedValue({
      type: 'CON',
      message: 'Welcome',
    });
    const body: Record<string, string> = {
      sessionId: 'sess-abc',
      serviceCode: '*321#',
      phoneNumber: '+2341234567890',
      text: 'some*input',
      networkCode: '62120',
      operator: 'MTN',
    };

    await controller.handleSession(body, GATEWAY_IP);

    expect(ussdService.handleSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-abc',
        serviceCode: '*321#',
        phoneNumber: '+2341234567890',
        text: 'some*input',
        networkCode: '62120',
        operator: 'MTN',
      }),
    );
  });

  describe('gateway authentication', () => {
    const body: Record<string, string> = {
      sessionId: 'sess-auth',
      serviceCode: '*123#',
      phoneNumber: '+2348012345678',
      text: '',
    };

    beforeEach(() => {
      ussdService.handleSession.mockResolvedValue({
        type: 'CON',
        message: 'Welcome',
      });
    });

    it('accepts requests from an allowed source IP', async () => {
      await expect(controller.handleSession(body, GATEWAY_IP)).resolves.toBe(
        'CON Welcome',
      );
    });

    it('accepts requests from an unknown IP that present the shared secret', async () => {
      await expect(
        controller.handleSession(body, '10.0.0.9', SECRET),
      ).resolves.toBe('CON Welcome');
    });

    it('accepts the shared secret from the body when the header is absent', async () => {
      await expect(
        controller.handleSession({ ...body, secret: SECRET }, '10.0.0.9'),
      ).resolves.toBe('CON Welcome');
    });

    it('rejects unknown IPs without a valid secret', async () => {
      await expect(
        controller.handleSession(body, '10.0.0.9', 'wrong-secret'),
      ).rejects.toThrow(UnauthorizedException);
      expect(ussdService.handleSession).not.toHaveBeenCalled();
    });

    it('rejects unknown IPs when no secret is configured', async () => {
      delete process.env.USSD_CALLBACK_SECRET;
      await expect(
        controller.handleSession(body, '10.0.0.9', SECRET),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  it('is marked @Public() so the global JWT guard skips the gateway callback', () => {
    const isPublic = Reflect.getMetadata(
      'isPublic',
      UssdController.prototype.handleSession,
    );
    expect(isPublic).toBe(true);
  });

  describe('throttle tracker', () => {
    const getTracker = (): ((req: any) => string) => {
      // @nestjs/throttler stores each named limit's tracker on the class.
      const tracker = Reflect.getMetadata(
        'THROTTLER:TRACKERdefault',
        UssdController,
      );
      expect(typeof tracker).toBe('function');
      return tracker;
    };

    it('keys by phoneNumber so the gateway IP is not shared across users', () => {
      const tracker = getTracker();
      const req = {
        ip: GATEWAY_IP,
        body: { phoneNumber: '+2348012345678', sessionId: 'sess-1' },
      };

      expect(tracker(req)).toBe('ussd:phone:+2348012345678');
    });

    it('falls back to sessionId when phoneNumber is missing', () => {
      const tracker = getTracker();
      const req = { ip: GATEWAY_IP, body: { sessionId: 'sess-42' } };

      expect(tracker(req)).toBe('ussd:session:sess-42');
    });

    it('falls back to IP when neither phoneNumber nor sessionId is present', () => {
      const tracker = getTracker();
      const req = { ip: GATEWAY_IP, body: {} };

      expect(tracker(req)).toBe(`ussd:ip:${GATEWAY_IP}`);
    });

    it('allows 10 concurrent sessions from different phone numbers through the same source IP', async () => {
      const tracker = getTracker();
      const phones = Array.from(
        { length: 10 },
        (_, i) => `+23480123456${String(i).padStart(2, '0')}`,
      );

      ussdService.handleSession.mockResolvedValue({
        type: 'CON',
        message: 'Select blood type',
      });

      const keys = phones.map((phoneNumber, i) =>
        tracker({
          ip: GATEWAY_IP,
          body: { phoneNumber, sessionId: `sess-${i}` },
        }),
      );

      // Each phone gets its own bucket, so the shared gateway IP does not
      // collapse all users into a single limit.
      expect(new Set(keys).size).toBe(10);

      const replies = await Promise.all(
        phones.map((phoneNumber, i) =>
          controller.handleSession(
            {
              sessionId: `sess-${i}`,
              serviceCode: '*123#',
              phoneNumber,
              text: '',
            },
            GATEWAY_IP,
          ),
        ),
      );

      expect(replies.every((r) => r === 'CON Select blood type')).toBe(true);
      expect(ussdService.handleSession).toHaveBeenCalledTimes(10);
    });
  });
});
