import { Test, TestingModule } from '@nestjs/testing';

import { FeePolicyController } from './fee-policy.controller';
import { FeeBreakdownDto, FeePolicyResponseDto } from './fee-policy.dto';
import { FeeRecipientType, FeePolicyStatus } from './fee-policy.entity';
import { FeePolicyService } from './fee-policy.service';

const mockResponse: FeePolicyResponseDto = {
  id: 'uuid-1',
  name: 'Standard',
  recipientType: FeeRecipientType.PROVIDER,
  platformFeeBp: 100,
  insuranceFeeBp: 50,
  flatFeeStroops: 500_000,
  stellarNetworkFeeStroops: 100,
  status: FeePolicyStatus.ACTIVE,
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockBreakdown: FeeBreakdownDto = {
  grossAmountStroops: 500_000_000,
  flatFeeStroops: 500_000,
  platformFeeStroops: 4_995_000,
  insuranceFeeStroops: 2_497_500,
  stellarNetworkFeeStroops: 100,
  totalFeeStroops: 7_992_600,
  netAmountStroops: 492_007_400,
  effectiveFeePercent: '1.5985%',
};

describe('FeePolicyController', () => {
  let controller: FeePolicyController;
  let service: jest.Mocked<FeePolicyService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeePolicyController],
      providers: [
        {
          provide: FeePolicyService,
          useValue: {
            create: jest.fn().mockResolvedValue(mockResponse),
            findAll: jest.fn().mockResolvedValue([mockResponse]),
            findOne: jest.fn().mockResolvedValue(mockResponse),
            update: jest.fn().mockResolvedValue(mockResponse),
            remove: jest.fn().mockResolvedValue(undefined),
            activate: jest.fn().mockResolvedValue(mockResponse),
            deactivate: jest.fn().mockResolvedValue(mockResponse),
            quotePayment: jest.fn().mockResolvedValue(mockBreakdown),
          },
        },
      ],
    }).compile();

    controller = module.get(FeePolicyController);
    service = module.get(FeePolicyService);
  });

  afterEach(() => jest.clearAllMocks());

  it('create delegates to service.create', async () => {
    const dto = {
      name: 'Standard',
      recipientType: FeeRecipientType.PROVIDER,
    };
    const result = await controller.create(dto as any);
    expect(service.create).toHaveBeenCalledWith(dto);
    expect(result).toBe(mockResponse);
  });

  it('findAll delegates to service.findAll', async () => {
    const result = await controller.findAll();
    expect(service.findAll).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('findOne delegates to service.findOne with the id', async () => {
    const result = await controller.findOne('uuid-1');
    expect(service.findOne).toHaveBeenCalledWith('uuid-1');
    expect(result).toBe(mockResponse);
  });

  it('update delegates to service.update', async () => {
    const result = await controller.update('uuid-1', { platformFeeBp: 200 });
    expect(service.update).toHaveBeenCalledWith('uuid-1', {
      platformFeeBp: 200,
    });
    expect(result).toBe(mockResponse);
  });

  it('remove delegates to service.remove', async () => {
    await controller.remove('uuid-1');
    expect(service.remove).toHaveBeenCalledWith('uuid-1');
  });

  it('activate delegates to service.activate', async () => {
    const result = await controller.activate('uuid-1');
    expect(service.activate).toHaveBeenCalledWith('uuid-1');
    expect(result).toBe(mockResponse);
  });

  it('deactivate delegates to service.deactivate', async () => {
    const result = await controller.deactivate('uuid-1');
    expect(service.deactivate).toHaveBeenCalledWith('uuid-1');
    expect(result).toBe(mockResponse);
  });

  it('quotePayment delegates to service.quotePayment', async () => {
    const dto = { grossAmountStroops: 500_000_000, feePolicyId: 'uuid-1' };
    const result = await controller.quotePayment(dto);
    expect(service.quotePayment).toHaveBeenCalledWith(dto);
    expect(result).toBe(mockBreakdown);
  });
});
