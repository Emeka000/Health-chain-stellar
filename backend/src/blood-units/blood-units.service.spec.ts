import { BadRequestException, ForbiddenException } from '@nestjs/common';

import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';

import { NotificationsService } from '../notifications/notifications.service';
import { BloodUnitTrail } from '../soroban/entities/blood-unit-trail.entity';
import { SorobanService } from '../soroban/soroban.service';

import { BloodUnitsService } from './blood-units.service';
import { RegisterBloodUnitDto } from './dto/blood-units.dto';
import { BloodUnitEntity } from './entities/blood-unit.entity';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,MOCK_BARCODE'),
}));

describe('BloodUnitsService', () => {
  let service: BloodUnitsService;

  let trailRepository: jest.Mocked<Partial<Repository<BloodUnitTrail>>>;
  let bloodUnitRepository: jest.Mocked<Partial<Repository<BloodUnitEntity>>>;
  let sorobanService: jest.Mocked<Partial<SorobanService>>;
  let notificationsService: jest.Mocked<Partial<NotificationsService>>;

  beforeEach(() => {
    trailRepository = {
      findOne: jest.fn(),
    };

    bloodUnitRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    sorobanService = {
      isBloodBank: jest.fn(),
      registerBloodUnit: jest.fn(),
      transferCustody: jest.fn(),
      logTemperature: jest.fn(),
      getUnitTrail: jest.fn(),
    };

    notificationsService = {
      send: jest.fn(),
    };

    service = new BloodUnitsService(
      sorobanService as SorobanService,
      notificationsService as NotificationsService,
      trailRepository as Repository<BloodUnitTrail>,
      bloodUnitRepository as Repository<BloodUnitEntity>,
    );
    (QRCode.toDataURL as jest.Mock).mockResolvedValue(
      'data:image/png;base64,MOCK_BARCODE',
    );
  });

  const buildDto = (): RegisterBloodUnitDto => ({
    bloodType: 'A+',
    quantityMl: 450,
    donorId: 'DONOR123',
    bankId: 'GBZXN7PIRZGNMHGAW3DKM6S6Q2LQVCWKBDRTW2TCRG5G3T2MBJX4W7OE',
    expirationDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    metadata: { source: 'mobile' },
  });

  it('registers a blood unit and stores blockchain hash plus barcode', async () => {
    const dto = buildDto();
    const createdAt = new Date(dto.expirationDate);

    (sorobanService.isBloodBank as jest.Mock).mockResolvedValue(true);
    (sorobanService.registerBloodUnit as jest.Mock).mockResolvedValue({
      transactionHash: 'tx-hash-001',
      unitId: 101,
    });
    (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(null);
    (bloodUnitRepository.create as jest.Mock).mockImplementation(
      (input) => input as BloodUnitEntity,
    );
    (bloodUnitRepository.save as jest.Mock).mockImplementation(
      async (input) => ({
        id: 'db-unit-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...input,
      }),
    );
    (notificationsService.send as jest.Mock).mockResolvedValue([]);

    const result = await service.registerBloodUnit(dto, {
      id: 'bank-user-1',
      role: 'blood_bank',
    });

    expect(result.success).toBe(true);
    expect(result.blockchainTransactionHash).toBe('tx-hash-001');
    expect(result.barcodeData).toContain('data:image/png;base64');
    expect(result.unitNumber).toMatch(/^APOS-\d{13}-[A-Z0-9]{6}$/);

    expect(sorobanService.registerBloodUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        bankId: dto.bankId,
        serialNumber: result.unitNumber,
        bloodType: dto.bloodType,
        quantityMl: dto.quantityMl,
      }),
    );
    expect(sorobanService.registerBloodUnit).toHaveBeenCalledWith(
      expect.not.objectContaining({ expirationTimestamp: expect.anything() }),
    );
    expect(bloodUnitRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        blockchainTransactionHash: 'tx-hash-001',
        blockchainUnitId: 101,
        expirationDate: createdAt,
      }),
    );
    expect(notificationsService.send).toHaveBeenCalled();
  });

  it('rejects registration when expiration date is not in the future', async () => {
    const dto = buildDto();
    dto.expirationDate = new Date(Date.now() - 30_000).toISOString();

    await expect(service.registerBloodUnit(dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(sorobanService.registerBloodUnit).not.toHaveBeenCalled();
  });

  it('rejects registration when bank is not authorized on blockchain', async () => {
    const dto = buildDto();
    (sorobanService.isBloodBank as jest.Mock).mockResolvedValue(false);

    await expect(
      service.registerBloodUnit(dto, { id: 'user-1', role: 'blood_bank' }),
    ).rejects.toThrow(ForbiddenException);
    expect(sorobanService.registerBloodUnit).not.toHaveBeenCalled();
  });

  it('rejects non-blood-bank roles even for authorized banks', async () => {
    const dto = buildDto();
    (sorobanService.isBloodBank as jest.Mock).mockResolvedValue(true);

    await expect(
      service.registerBloodUnit(dto, { id: 'hospital-user', role: 'hospital' }),
    ).rejects.toThrow(ForbiddenException);
    expect(sorobanService.registerBloodUnit).not.toHaveBeenCalled();
  });

  it('handles bulk registration with mixed success/failure results', async () => {
    const dto = buildDto();
    const bulkPayload = { units: [dto, { ...dto, donorId: 'DONOR456' }] };

    const registerSpy = jest
      .spyOn(service, 'registerBloodUnit')
      .mockResolvedValueOnce({
        success: true,
        unitNumber: 'APOS-1-AAAAAA',
        blockchainUnitId: 1,
        blockchainTransactionHash: 'tx-1',
        barcodeData: 'barcode-1',
        message: 'Blood unit registered successfully',
      })
      .mockRejectedValueOnce(new Error('Blockchain failure'));

    const result = await service.registerBloodUnitsBulk(bulkPayload);

    expect(registerSpy).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(2);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].message).toBe('Blockchain failure');
  });
});
