import { Repository, SelectQueryBuilder, UpdateResult } from 'typeorm';

export class SoftDeleteRepository<Entity extends { deletedAt?: Date | null }> extends Repository<Entity> {
  async findActiveMany(options?: any): Promise<Entity[]> {
    return this.find({
      ...options,
      where: {
        ...options?.where,
        deletedAt: null,
      },
    });
  }

  async findActiveOne(options?: any): Promise<Entity | null> {
    return this.findOne({
      ...options,
      where: {
        ...options?.where,
        deletedAt: null,
      },
    });
  }

  createActiveQueryBuilder(alias: string): SelectQueryBuilder<Entity> {
    return this.createQueryBuilder(alias).where(`${alias}.deletedAt IS NULL`);
  }

  override async softDelete(id: any): Promise<UpdateResult> {
    const ids = Array.isArray(id) ? id : [id];
    return this.update({ id: ids } as any, { deletedAt: new Date() } as any);
  }

  override async restore(id: any): Promise<UpdateResult> {
    const ids = Array.isArray(id) ? id : [id];
    return this.update({ id: ids } as any, { deletedAt: null } as any);
  }
}
