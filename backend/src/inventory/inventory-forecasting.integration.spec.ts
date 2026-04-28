import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';

import {
  Repository,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { OrderEntity } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';

import { InventoryEntity } from './entities/inventory.entity';
import { InventoryForecastingService } from './inventory-forecasting.service';

// Test-specific entity to avoid enum issues with SQLite
@Entity('orders')
class TestOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'hospital_id' })
  hospitalId: string;

  @Column({ name: 'blood_type' })
  bloodType: string;

  @Column()
  quantity: number;

  @Column({ name: 'delivery_address' })
  deliveryAddress: string;

  @Column()
  status: string;

  @Column({ name: 'rider_id', nullable: true, type: 'varchar' })
  riderId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('blood_requests')
class TestBloodRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'delivery_address', nullable: true })
  deliveryAddress: string | null;

  @Column({ type: 'simple-json', nullable: true })
  items: Array<{ bloodType: string; quantityMl: number }>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('donations')
class TestDonationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

describe('InventoryForecasting Integration (SQLite)', () => {
  let service: InventoryForecastingService;
  let orderRepo: Repository<TestOrderEntity>;
  let inventoryRepo: Repository<InventoryEntity>;

  const configValues: Record<string, number> = {
    INVENTORY_FORECAST_THRESHOLD_DAYS: 3,
    INVENTORY_FORECAST_HISTORY_DAYS: 30,
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: number) => {
      const config: Record<string, number> = {
        INVENTORY_FORECAST_THRESHOLD_DAYS: 3,
        INVENTORY_FORECAST_HISTORY_DAYS: 30,
      };
      return config[key] ?? defaultValue;
    }),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [TestOrderEntity, InventoryEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([
          TestOrderEntity,
          TestBloodRequestEntity,
          TestDonationEntity,
          InventoryEntity,
        ]),
      ],
      providers: [
        InventoryForecastingService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: getQueueToken('donor-outreach'),
          useValue: mockQueue,
        },
        {
          provide: getRepositoryToken(OrderEntity),
          useExisting: getRepositoryToken(TestOrderEntity),
        },
        {
          provide: getRepositoryToken(BloodRequestEntity),
          useExisting: getRepositoryToken(TestBloodRequestEntity),
        },
        {
          provide: getRepositoryToken(DonationEntity),
          useExisting: getRepositoryToken(TestDonationEntity),
        },
      ],
    }).compile();

    service = module.get<InventoryForecastingService>(
      InventoryForecastingService,
    );
    orderRepo = module.get<Repository<TestOrderEntity>>(
      getRepositoryToken(TestOrderEntity),
    );
    inventoryRepo = module.get<Repository<InventoryEntity>>(
      getRepositoryToken(InventoryEntity),
    );
  });

  it('should forecast low inventory using real database queries', async () => {
    const now = new Date();
    const region = 'Nairobi';
    const address = `123 Main St, ${region}`;

    // Seed data
    for (let i = 0; i < 5; i++) {
      const orderDate = new Date();
      orderDate.setDate(now.getDate() - i);
      await orderRepo.save({
        hospitalId: 'hosp-1',
        bloodType: 'O-',
        quantity: 4, // 20 units total -> 0.66 per day
        deliveryAddress: address,
        status: OrderStatus.DELIVERED,
        createdAt: orderDate,
      });
    }

    // Stock = 1 unit
    // Projected supply = 1 / 0.666 = 1.5 days
    // Threshold = 3 -> Should ALERT
    await inventoryRepo.save({
      bloodType: 'O-',
      region: region,
      quantity: 1,
    });

    const forecasts = await service.calculateDemandForecasts();
    expect(forecasts).toHaveLength(1);
    expect(forecasts[0].projectedDaysOfSupply).toBeCloseTo(1.5, 1);

    await service.runForecast();

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'inventory.low',
      expect.anything(),
    );
    expect(mockQueue.add).toHaveBeenCalledWith(
      'recommend-donor-outreach',
      expect.objectContaining({
        bloodType: 'O-',
        region: region,
        urgency: 'high',
      }),
    );
  });
});
