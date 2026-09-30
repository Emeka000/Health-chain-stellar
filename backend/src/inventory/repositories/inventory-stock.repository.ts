import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, UpdateResult } from 'typeorm';
import { InventoryStockEntity } from '../entities/inventory-stock.entity';
import { BloodComponent } from '../../blood-units/enums/blood-component.enum';
import { BloodType } from '../../blood-units/enums/blood-type.enum';

@Injectable()
export class InventoryStockRepository {
  constructor(
    @InjectRepository(InventoryStockEntity)
    private readonly repo: Repository<InventoryStockEntity>,
  ) {}

  findById(id: string, bloodBankId: string): Promise<InventoryStockEntity | null> {
    return this.repo.findOne({ where: { id, bloodBankId } });
  }

  findByBankAndType(
    bloodBankId: string,
    bloodType: string,
    component: BloodComponent | string = BloodComponent.WHOLE_BLOOD,
  ): Promise<InventoryStockEntity | null> {
    return this.repo.findOne({
      where: {
        bloodBankId,
        bloodType: bloodType as BloodType,
        component: component as BloodComponent,
      },
    });
  }

  findAndCount(
    where: Partial<InventoryStockEntity>,
    skip: number,
    take: number,
  ): Promise<[InventoryStockEntity[], number]> {
    return this.repo.findAndCount({ where, skip, take });
  }

  save(entity: InventoryStockEntity): Promise<InventoryStockEntity> {
    return this.repo.save(entity);
  }

  create(data: Partial<InventoryStockEntity>): InventoryStockEntity {
    return this.repo.create(data);
  }

  merge(
    entity: InventoryStockEntity,
    data: Partial<InventoryStockEntity>,
  ): InventoryStockEntity {
    return this.repo.merge(entity, data);
  }

  async remove(entity: InventoryStockEntity): Promise<void> {
    await this.repo.remove(entity);
  }

  getLowStock(threshold: number): Promise<InventoryStockEntity[]> {
    return this.repo
      .createQueryBuilder('inventory')
      .where('inventory.availableUnitsMl <= :threshold', { threshold })
      .getMany();
  }

  atomicDecrement(
    id: string,
    version: number,
    quantity: number,
  ): Promise<UpdateResult> {
    return this.repo
      .createQueryBuilder()
      .update(InventoryStockEntity)
      .set({
        availableUnitsMl: () => `"available_units_ml" - ${quantity}`,
        version: () => '"version" + 1',
      })
      .where('id = :id', { id })
      .andWhere('"version" = :version', { version })
      .andWhere('"available_units_ml" >= :quantity', { quantity })
      .execute();
  }

  atomicIncrement(
    id: string,
    version: number,
    quantity: number,
  ): Promise<UpdateResult> {
    return this.repo
      .createQueryBuilder()
      .update(InventoryStockEntity)
      .set({
        availableUnitsMl: () => `"available_units_ml" + ${quantity}`,
        version: () => '"version" + 1',
      })
      .where('id = :id', { id })
      .andWhere('"version" = :version', { version })
      .execute();
  }

  bumpVersion(id: string): Promise<UpdateResult> {
    return this.repo
      .createQueryBuilder()
      .update(InventoryStockEntity)
      .set({ version: () => '"version" + 1' })
      .where('id = :id', { id })
      .execute();
  }
}
