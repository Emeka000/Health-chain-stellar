import { Test, TestingModule } from '@nestjs/testing';

import { UssdController } from './ussd.controller';
import { UssdSessionDto } from './ussd.dto';
import { UssdService } from './ussd.service';

describe('UssdController', () => {
  let controller: UssdController;
  let ussdService: jest.Mocked<UssdService>;

  const mockResponse = () => {
    const res: any = {};
    res.setHeader = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(async () => {
    ussdService = {
      handleSession: jest.fn(),
    } as unknown as jest.Mocked<UssdService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UssdController],
      providers: [{ provide: UssdService, useValue: ussdService }],
    }).compile();

    controller = module.get<UssdController>(UssdController);
  });

  it('returns CON plain-text response for continuing sessions', async () => {
    ussdService.handleSession.mockResolvedValue({
      type: 'CON',
      message: 'Select blood type',
    });
    const dto: UssdSessionDto = {
      sessionId: 'sess-001',
      serviceCode: '*123#',
      phoneNumber: '+2348012345678',
      text: '',
    };
    const res = mockResponse();

    await controller.handleSession(dto, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
    expect(res.send).toHaveBeenCalledWith('CON Select blood type');
  });

  it('returns END plain-text response for terminal sessions', async () => {
    ussdService.handleSession.mockResolvedValue({
      type: 'END',
      message: 'Order placed!',
    });
    const dto: UssdSessionDto = {
      sessionId: 'sess-001',
      serviceCode: '*123#',
      phoneNumber: '+2348012345678',
      text: 'phone*1234*1*1*1*1',
    };
    const res = mockResponse();

    await controller.handleSession(dto, res);

    expect(res.send).toHaveBeenCalledWith('END Order placed!');
  });

  it('forwards all DTO fields to UssdService', async () => {
    ussdService.handleSession.mockResolvedValue({
      type: 'CON',
      message: 'Welcome',
    });
    const dto: UssdSessionDto = {
      sessionId: 'sess-abc',
      serviceCode: '*321#',
      phoneNumber: '+2341234567890',
      text: 'some*input',
      networkCode: '62120',
      operator: 'MTN',
    };
    const res = mockResponse();

    await controller.handleSession(dto, res);

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

  it('is marked @Public() so the global JWT guard skips the gateway callback', () => {
    const isPublic = Reflect.getMetadata('isPublic', UssdController.prototype.handleSession);
    expect(isPublic).toBe(true);
  });

  describe('throttle tracker', () => {
    const getTracker = (): ((req: any) => string) => {
      const tracker = Reflect.getMetadata(
        'THROTTLER:TRACKERhandleSession',
        UssdController.prototype.handleSession,
      );
      expect(typeof tracker).toBe('function');
      return tracker;
    };

    it('keys by phoneNumber so the gateway IP is not shared across users', () => {
      const tracker = getTracker();
      const req = {
        ip: '197.210.0.1',
        body: { phoneNumber: '+2348012345678', sessionId: 'sess-1' },
      };

      expect(tracker(req)).toBe('phone:+2348012345678');
    });

    it('falls back to sessionId when phoneNumber is missing', () => {
      const tracker = getTracker();
      const req = { ip: '197.210.0.1', body: { sessionId: 'sess-42' } };

      expect(tracker(req)).toBe('session:sess-42');
    });

    it('falls back to IP when neither phoneNumber nor sessionId is present', () => {
      const tracker = getTracker();
      const req = { ip: '197.210.0.1', body: {} };

      expect(tracker(req)).toBe('ip:197.210.0.1');
    });

    it('allows 10 concurrent sessions from different phone numbers through the same source IP', async () => {
      const tracker = getTracker();
      const gatewayIp = '197.210.0.1';
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
          ip: gatewayIp,
          body: { phoneNumber, sessionId: `sess-${i}` },
        }),
      );

      // Each phone gets its own bucket, so the shared gateway IP does not
      // collapse all users into a single 5 req/min limit.
      expect(new Set(keys).size).toBe(10);

      await Promise.all(
        phones.map(async (phoneNumber, i) => {
          const dto: UssdSessionDto = {
            sessionId: `sess-${i}`,
            serviceCode: '*123#',
            phoneNumber,
            text: '',
          };
          const res = mockResponse();
          await controller.handleSession(dto, res);
          expect(res.send).toHaveBeenCalledWith('CON Select blood type');
        }),
      );

      expect(ussdService.handleSession).toHaveBeenCalledTimes(10);
    });
  });
});
