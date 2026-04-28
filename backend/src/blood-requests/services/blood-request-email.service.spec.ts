import { Test, TestingModule } from '@nestjs/testing';
import { EmailProvider } from '../../notifications/providers/email.provider';
import { BloodRequestEmailService } from './blood-request-email.service';
import { BloodRequestEntity } from '../entities/blood-request.entity';
import { BloodRequestStatus } from '../enums/blood-request-status.enum';

const makeRequest = (overrides: Partial<BloodRequestEntity> = {}): BloodRequestEntity =>
  ({
    id: 'req-1',
    requestNumber: 'BR-001',
    hospitalId: 'hosp-1',
    requiredByTimestamp: Math.floor((Date.now() + 86400000) / 1000),
    blockchainTxHash: 'tx-abc',
    status: BloodRequestStatus.PENDING,
    items: [
      { bloodType: 'A+', component: 'WHOLE_BLOOD', quantityMl: 450, priority: 'NORMAL' },
    ],
    ...overrides,
  } as BloodRequestEntity);

describe('BloodRequestEmailService', () => {
  let service: BloodRequestEmailService;
  const mockEmail = { send: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BloodRequestEmailService,
        { provide: EmailProvider, useValue: mockEmail },
      ],
    }).compile();
    service = module.get(BloodRequestEmailService);
  });

  it('sends to the correct recipient', async () => {
    await service.sendCreationConfirmation('nurse@hospital.com', makeRequest());
    expect(mockEmail.send).toHaveBeenCalledWith(
      'nurse@hospital.com',
      expect.any(String),
      expect.any(String),
    );
  });

  it('subject contains the request number', async () => {
    await service.sendCreationConfirmation('x@x.com', makeRequest());
    const [, subject] = mockEmail.send.mock.calls[0];
    expect(subject).toContain('BR-001');
  });

  it('HTML body contains blood type, component, quantity, and priority', async () => {
    await service.sendCreationConfirmation('x@x.com', makeRequest());
    const [, , html] = mockEmail.send.mock.calls[0];
    expect(html).toContain('A+');
    expect(html).toContain('WHOLE_BLOOD');
    expect(html).toContain('450ml');
    expect(html).toContain('NORMAL');
  });

  it('HTML body contains the on-chain tx hash', async () => {
    await service.sendCreationConfirmation('x@x.com', makeRequest());
    const [, , html] = mockEmail.send.mock.calls[0];
    expect(html).toContain('tx-abc');
  });

  it('shows n/a when blockchainTxHash is null', async () => {
    await service.sendCreationConfirmation('x@x.com', makeRequest({ blockchainTxHash: null }));
    const [, , html] = mockEmail.send.mock.calls[0];
    expect(html).toContain('n/a');
  });

  it('renders one list item per blood unit item', async () => {
    const request = makeRequest({
      items: [
        { bloodType: 'A+', component: 'WHOLE_BLOOD', quantityMl: 450, priority: 'NORMAL' },
        { bloodType: 'O-', component: 'PLASMA', quantityMl: 200, priority: 'HIGH' },
      ] as any,
    });
    await service.sendCreationConfirmation('x@x.com', request);
    const [, , html] = mockEmail.send.mock.calls[0];
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
  });
});
