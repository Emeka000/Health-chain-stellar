import { Logger } from '@nestjs/common';

export class DatabaseSyncGuard {
  private static readonly logger = new Logger(DatabaseSyncGuard.name);

  static validateSynchronizeConfig(
    nodeEnv: string,
    synchronize: boolean,
  ): void {
    const isLocalEnv = nodeEnv === 'development' || nodeEnv === 'test';

    if (synchronize && !isLocalEnv) {
      this.logger.warn(
        `⚠️  CRITICAL: TypeORM synchronize is ENABLED in ${nodeEnv} environment!`,
      );
      this.logger.warn(
        'This can cause accidental schema drift and data loss in staging/production.',
      );
      this.logger.warn(
        'Disabling synchronize to prevent schema modifications.',
      );
      throw new Error(
        `TypeORM synchronize must be disabled in ${nodeEnv} environment. Use migrations instead.`,
      );
    }

    if (!synchronize && isLocalEnv) {
      this.logger.debug(
        'TypeORM synchronize is disabled. Use migrations for schema changes.',
      );
    }
  }
}
