import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { AppModule } from './app.module';
import { AppErrorFilter } from './common/filters/irrecoverable-error.filter';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { validateEnv } from './config/validate-env';
import { ThrottlerExceptionFilter } from './throttler/throttler-exception.filter';

async function bootstrap() {
  // Validate env before NestJS initialises any module.
  // On failure, validateEnv writes a structured report to stderr and throws.
  try {
    validateEnv(process.env as Record<string, unknown>);
  } catch {
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Use Winston as the NestJS logger
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  if (configService.get<string>('TRUST_PROXY', 'false') === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  // Order matters: GlobalExceptionFilter runs last (catches everything)
  app.useGlobalFilters(
    new ThrottlerExceptionFilter(),
    new AppErrorFilter(),
    app.get(GlobalExceptionFilter),
  );

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // CORS configuration
  const corsOrigin = configService.get<string>('CORS_ORIGIN', '*');
  app.enableCors({
    origin: corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  // API prefix
  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  // Swagger/OpenAPI configuration
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Health-chain-stellar API')
    .setDescription(
      'HealthDonor Protocol - Transparent health donations on Stellar Soroban',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('Authentication', 'User authentication and session management')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(
    `Application is running on: http://localhost:${port}/${apiPrefix}`,
  );
  logger.log(
    `Swagger documentation available at: http://localhost:${port}/docs`,
  );
  logger.log(
    `Environment: ${configService.get<string>('NODE_ENV', 'development')}`,
  );
}
bootstrap();
