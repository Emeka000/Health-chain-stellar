import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './validate-env';

/**
 * Centralised configuration module.
 * Wraps @nestjs/config with environment validation at startup.
 * Import this instead of ConfigModule.forRoot() in AppModule.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
