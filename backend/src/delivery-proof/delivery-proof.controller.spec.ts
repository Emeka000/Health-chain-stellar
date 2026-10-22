import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { DeliveryProofController } from './delivery-proof.controller';
import { DeliveryProofService } from './delivery-proof.service';
import { Permission } from '../auth/enums/permission.enum';
import { PERMISSIONS_KEY } from '../auth/decorators/require-permissions.decorator';

describe('DeliveryProofController', () => {
  let controller: DeliveryProofController;
  let reflector: Reflector;

  const mockService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    uploadPhoto: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeliveryProofController],
      providers: [
        { provide: DeliveryProofService, useValue: mockService },
        Reflector,
      ],
    }).compile();

    controller = module.get<DeliveryProofController>(DeliveryProofController);
    reflector = module.get<Reflector>(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const getPermissions = (handler: (...args: any[]) => any): Permission[] | undefined =>
    reflector.get<Permission[]>(PERMISSIONS_KEY, handler);

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('@RequirePermissions metadata', () => {
    it('create requires DELIVERY_PROOF_CREATE', () => {
      expect(getPermissions(controller.create)).toEqual([
        Permission.DELIVERY_PROOF_CREATE,
      ]);
    });

    it('findAll requires DELIVERY_PROOF_READ', () => {
      expect(getPermissions(controller.findAll)).toEqual([
        Permission.DELIVERY_PROOF_READ,
      ]);
    });

    it('findOne requires DELIVERY_PROOF_READ', () => {
      expect(getPermissions(controller.findOne)).toEqual([
        Permission.DELIVERY_PROOF_READ,
      ]);
    });

    it('uploadPhoto requires DELIVERY_PROOF_UPLOAD', () => {
      expect(getPermissions(controller.uploadPhoto)).toEqual([
        Permission.DELIVERY_PROOF_UPLOAD,
      ]);
    });
  });
});
