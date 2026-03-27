import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { InventoryEntity } from '../entities/inventory.entity';

export interface StockAggregation {
  bloodType: string;
  totalQuantity: number;
  totalReserved: number;
  totalAvailable: number;
  hospitalCount: number;
}

export interface LowStockItem {
  id: string;
  hospitalId: string;
  bloodType: string;
  quantity: number;
  availableQuantity: number;
  reorderLevel: number;
  deficit: number;
}

export interface InventoryStats {
  totalItems: number;
  totalQuantity: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  criticalStockCount: number;
}

@Injectable()
export class InventoryRepository {
  constructor(
    @InjectRepository(InventoryEntity)
    private readonly repository: Repository<InventoryEntity>,
  ) {}

  /**
   * Get aggregated stock levels by blood type across all hospitals
   * Replaces: SELECT blood_type, SUM(quantity), SUM(reserved_quantity), COUNT(DISTINCT hospital_id) FROM inventory GROUP BY blood_type
   */
  async getStockAggregationByBloodType(): Promise<StockAggregation[]> {
    const results = await this.repository
      .createQueryBuilder('inventory')
      .select('inventory.bloodType', 'bloodType')
      .addSelect('SUM(inventory.quantity)', 'totalQuantity')
      .addSelect('SUM(inventory.reservedQuantity)', 'totalReserved')
      .addSelect(
        'SUM(inventory.quantity - inventory.reservedQuantity)',
        'totalAvailable',
      )
      .addSelect('COUNT(DISTINCT inventory.hospitalId)', 'hospitalCount')
      .groupBy('inventory.bloodType')
      .orderBy('inventory.bloodType', 'ASC')
      .getRawMany();

    return results.map((row) => ({
      bloodType: row.bloodType,
      totalQuantity: parseInt(row.totalQuantity, 10) || 0,
      totalReserved: parseInt(row.totalReserved, 10) || 0,
      totalAvailable: parseInt(row.totalAvailable, 10) || 0,
      hospitalCount: parseInt(row.hospitalCount, 10) || 0,
    }));
  }

  /**
   * Get low stock items below reorder level
   * Replaces: SELECT * FROM inventory WHERE quantity <= reorder_level ORDER BY (quantity - reorder_level) ASC
   */
  async getLowStockItems(threshold?: number): Promise<LowStockItem[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('inventory')
      .select(['inventory.id', 'inventory.bloodType', 'inventory.quantity']);

    if (threshold !== undefined) {
      queryBuilder.where('inventory.quantity <= :threshold', { threshold });
    }

    const items = await queryBuilder
      .orderBy('inventory.quantity', 'ASC')
      .getMany();

    return items.map((item) => ({
      id: item.id,
      hospitalId: '',
      bloodType: item.bloodType,
      quantity: item.quantity,
      availableQuantity: item.quantity,
      reorderLevel: threshold || 10,
      deficit: (threshold || 10) - item.quantity,
    }));
  }

  /**
   * Get critical stock items (below 50% of reorder level)
   * Replaces: SELECT * FROM inventory WHERE quantity < (reorder_level * 0.5)
   */
  async getCriticalStockItems(): Promise<InventoryEntity[]> {
    return this.repository
      .createQueryBuilder('inventory')
      .where('inventory.quantity < (inventory.reorderLevel * 0.5)')
      .orderBy('inventory.quantity', 'ASC')
      .getMany();
  }

  /**
   * Get inventory statistics for a hospital
   * Replaces: Complex multi-query aggregation with raw SQL
   */
  async getInventoryStats(hospitalId?: string): Promise<InventoryStats> {
    const queryBuilder = this.repository.createQueryBuilder('inventory');

    if (hospitalId) {
      queryBuilder.where('inventory.hospitalId = :hospitalId', { hospitalId });
    }

    const result = await queryBuilder
      .select('COUNT(*)', 'totalItems')
      .addSelect('SUM(inventory.quantity)', 'totalQuantity')
      .addSelect('SUM(inventory.reservedQuantity)', 'totalReserved')
      .addSelect(
        'SUM(inventory.quantity - inventory.reservedQuantity)',
        'totalAvailable',
      )
      .addSelect(
        'COUNT(CASE WHEN inventory.quantity <= inventory.reorderLevel THEN 1 END)',
        'lowStockCount',
      )
      .addSelect(
        'COUNT(CASE WHEN inventory.quantity < (inventory.reorderLevel * 0.5) THEN 1 END)',
        'criticalStockCount',
      )
      .getRawOne();

    return {
      totalItems: parseInt(result.totalItems, 10) || 0,
      totalQuantity: parseInt(result.totalQuantity, 10) || 0,
      totalReserved: parseInt(result.totalReserved, 10) || 0,
      totalAvailable: parseInt(result.totalAvailable, 10) || 0,
      lowStockCount: parseInt(result.lowStockCount, 10) || 0,
      criticalStockCount: parseInt(result.criticalStockCount, 10) || 0,
    };
  }

  /**
   * Find inventory by hospital and blood type
   * Replaces: SELECT * FROM inventory WHERE hospital_id = ? AND blood_type = ?
   */
  async findByHospitalAndBloodType(
    hospitalId: string,
    bloodType: string,
  ): Promise<InventoryEntity | null> {
    return this.repository
      .createQueryBuilder('inventory')
      .where('inventory.hospitalId = :hospitalId', { hospitalId })
      .andWhere('inventory.bloodType = :bloodType', { bloodType })
      .getOne();
  }

  /**
   * Get all inventory items for a hospital
   * Replaces: SELECT * FROM inventory WHERE hospital_id = ? ORDER BY blood_type
   */
  async findByHospital(hospitalId: string): Promise<InventoryEntity[]> {
    return this.repository
      .createQueryBuilder('inventory')
      .where('inventory.hospitalId = :hospitalId', { hospitalId })
      .orderBy('inventory.bloodType', 'ASC')
      .getMany();
  }

  /**
   * Update stock quantity atomically with optimistic locking
   */
  async adjustStock(id: string, delta: number): Promise<void> {
    const stock = await this.repository.findOne({ where: { id } });
    if (!stock) return;
    const result = await this.repository
      .createQueryBuilder()
      .update(InventoryEntity)
      .set({
        quantity: () => `quantity + ${delta}`,
        version: () => 'version + 1',
      })
      .where('id = :id AND version = :version', { id, version: stock.version })
      .execute();
    if ((result.affected ?? 0) === 0) {
      throw new Error(
        `Inventory '${id}' was modified concurrently. Please retry.`,
      );
    }
  }

  /**
   * Reserve stock for an order with optimistic locking
   */
  async reserveStock(id: string, quantity: number): Promise<boolean> {
    const stock = await this.repository.findOne({ where: { id } });
    if (!stock) return false;
    const result = await this.repository
      .createQueryBuilder()
      .update(InventoryEntity)
      .set({
        quantity: () => `quantity - ${quantity}`,
        version: () => 'version + 1',
      })
      .where('id = :id AND version = :version AND quantity >= :quantity', {
        id,
        version: stock.version,
        quantity,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * Release reserved stock with optimistic locking
   */
  async releaseStock(id: string, quantity: number): Promise<void> {
    const stock = await this.repository.findOne({ where: { id } });
    if (!stock) return;
    const result = await this.repository
      .createQueryBuilder()
      .update(InventoryEntity)
      .set({
        quantity: () => `quantity + ${quantity}`,
        version: () => 'version + 1',
      })
      .where('id = :id AND version = :version', { id, version: stock.version })
      .execute();
    if ((result.affected ?? 0) === 0) {
      throw new Error(
        `Inventory '${id}' was modified concurrently. Please retry.`,
      );
    }
  }

  /**
   * Get inventory items that need reordering grouped by blood type
   * Replaces: Complex GROUP BY query with HAVING clause
   */
  async getReorderSummary(): Promise<
    Array<{
      bloodType: string;
      totalDeficit: number;
      affectedHospitals: number;
    }>
  > {
    const results = await this.repository
      .createQueryBuilder('inventory')
      .select('inventory.bloodType', 'bloodType')
      .addSelect(
        'SUM(inventory.reorderLevel - inventory.quantity)',
        'totalDeficit',
      )
      .addSelect('COUNT(DISTINCT inventory.hospitalId)', 'affectedHospitals')
      .where('inventory.quantity < inventory.reorderLevel')
      .groupBy('inventory.bloodType')
      .having('SUM(inventory.reorderLevel - inventory.quantity) > 0')
      .orderBy('totalDeficit', 'DESC')
      .getRawMany();

    return results.map((row) => ({
      bloodType: row.bloodType,
      totalDeficit: parseInt(row.totalDeficit, 10) || 0,
      affectedHospitals: parseInt(row.affectedHospitals, 10) || 0,
    }));
  }
}
