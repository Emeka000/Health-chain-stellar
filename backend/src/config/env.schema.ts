import { Transform, Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsIn,
  IsUrl,
  Min,
  Max,
  IsNotEmpty,
  Matches,
  IsInt,
} from 'class-validator';

/**
 * Canonical schema for all environment variables.
 * Each field documents its type, requirement, and validation rules.
 * Validated at startup — app will not start if any required field is missing or invalid.
 */
export class EnvironmentVariables {
  // ─── App ──────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsIn(['development', 'staging', 'production', 'test'])
  NODE_ENV: string = 'development';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3001;

  @IsOptional()
  @IsString()
  API_PREFIX: string = 'api/v1';

  @IsOptional()
  @IsString()
  CORS_ORIGIN: string = '*';

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  TRUST_PROXY: boolean = false;

  // ─── Database ─────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  DATABASE_HOST: string = 'localhost';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DATABASE_PORT: number = 5432;

  @IsOptional()
  @IsString()
  DATABASE_USERNAME: string = 'postgres';

  @IsOptional()
  @IsString()
  DATABASE_PASSWORD: string = '';

  @IsString()
  @IsNotEmpty({ message: 'DATABASE_NAME is required' })
  DATABASE_NAME: string;

  // ─── JWT ──────────────────────────────────────────────────────────────────

  @IsString()
  @IsNotEmpty({ message: 'JWT_SECRET is required' })
  @Matches(/^(?!your-super-secret).{16,}$/, {
    message:
      'JWT_SECRET must be at least 16 characters and not the default placeholder',
  })
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_SECRET_KID: string = 'key-1';

  @IsOptional()
  @IsString()
  JWT_PREVIOUS_SECRET: string = '';

  @IsOptional()
  @IsString()
  JWT_PREVIOUS_SECRET_KID: string = 'key-0';

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN: string = '1h';

  @IsString()
  @IsNotEmpty({ message: 'JWT_REFRESH_SECRET is required' })
  @Matches(/^(?!your-super-secret).{16,}$/, {
    message:
      'JWT_REFRESH_SECRET must be at least 16 characters and not the default placeholder',
  })
  JWT_REFRESH_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  // ─── Redis ────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  REDIS_HOST: string = 'localhost';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  // ─── Maps ─────────────────────────────────────────────────────────────────

  @IsString()
  @IsNotEmpty({ message: 'MAPS_API_KEY is required' })
  MAPS_API_KEY: string;

  // ─── Soroban Blockchain ───────────────────────────────────────────────

  @IsUrl({}, { message: 'SOROBAN_RPC_URL must be a valid URL' })
  @IsNotEmpty({ message: 'SOROBAN_RPC_URL is required' })
  SOROBAN_RPC_URL: string;

  // ─── Per-contract addresses (all 10 deployed contracts) ─────────────────

  @IsOptional()
  @IsString()
  SOROBAN_COORDINATOR_CONTRACT_ID: string = '';

  @IsOptional()
  @IsString()
  SOROBAN_IDENTITY_CONTRACT_ID: string = '';

  @IsOptional()
  @IsString()
  SOROBAN_INVENTORY_CONTRACT_ID: string = '';

  @IsOptional()
  @IsString()
  SOROBAN_PAYMENTS_CONTRACT_ID: string = '';

  @IsOptional()
  @IsString()
  SOROBAN_REQUESTS_CONTRACT_ID: string = '';

  @IsOptional()
  @IsString()
  SOROBAN_TEMPERATURE_CONTRACT_ID: string = '';

  @IsOptional()
  @IsString()
  SOROBAN_MATCHING_CONTRACT_ID: string = '';

  @IsOptional()
  @IsString()
  SOROBAN_REPUTATION_CONTRACT_ID: string = '';

  @IsOptional()
  @IsString()
  SOROBAN_DELIVERY_CONTRACT_ID: string = '';

  @IsOptional()
  @IsString()
  SOROBAN_ANALYTICS_CONTRACT_ID: string = '';

  // ─── Legacy contract ID (kept for backward compatibility) ──────────────

  @IsOptional()
  @IsString()
  SOROBAN_CONTRACT_ID: string = '';

  @IsString()
  @IsNotEmpty({ message: 'SOROBAN_SECRET_KEY is required' })
  SOROBAN_SECRET_KEY: string;

  @IsOptional()
  @IsIn(['testnet', 'mainnet', 'futurenet'], {
    message: 'SOROBAN_NETWORK must be one of: testnet, mainnet, futurenet',
  })
  SOROBAN_NETWORK: string = 'testnet';

  @IsString()
  @IsNotEmpty({ message: 'BLOCKCHAIN_CALLBACK_SECRET is required' })
  BLOCKCHAIN_CALLBACK_SECRET: string;

  @IsString()
  @IsNotEmpty({ message: 'ADMIN_KEY is required' })
  ADMIN_KEY: string;

  // ─── Africa's Talking (SMS) ───────────────────────────────────────────────

  @IsString()
  @IsNotEmpty({ message: 'AT_API_KEY is required' })
  AT_API_KEY: string;

  @IsOptional()
  @IsString()
  AT_USERNAME: string = 'sandbox';

  // ─── Firebase (Push Notifications) ───────────────────────────────────────

  @IsString()
  @IsNotEmpty({ message: 'FIREBASE_SERVICE_ACCOUNT_JSON is required' })
  FIREBASE_SERVICE_ACCOUNT_JSON: string;

  // ─── SMTP ─────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  SMTP_HOST: string = 'smtp.gmail.com';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT: number = 587;

  @IsOptional()
  @IsString()
  SMTP_USER: string = '';

  @IsOptional()
  @IsString()
  SMTP_PASSWORD: string = '';

  @IsOptional()
  @IsString()
  SMTP_FROM: string = 'noreply@example.com';

  // ─── Account Lockout ─────────────────────────────────────────────────────

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(10)
  MAX_FAILED_LOGIN_ATTEMPTS: number = 5;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(60)
  ACCOUNT_LOCK_MINUTES: number = 15;

  // ─── Rate Limiting ────────────────────────────────────────────────────────


  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  THROTTLE_TTL: number = 60;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  THROTTLE_LIMIT: number = 100;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  THROTTLE_AUTH_TTL: number = 60;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  THROTTLE_AUTH_LIMIT: number = 10;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  THROTTLER_USE_REDIS: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  PASSWORD_HISTORY_LENGTH: number = 3;

  // ─── Inventory Forecasting ────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  INVENTORY_FORECAST_CRON: string = '0 */6 * * *';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  INVENTORY_FORECAST_THRESHOLD_DAYS: number = 3;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  INVENTORY_FORECAST_HISTORY_DAYS: number = 30;

  // ─── Data Retention ───────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  RETENTION_JOB_CRON: string = '0 2 * * *';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RETENTION_SESSION_TTL_DAYS: number = 30;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RETENTION_ACTIVITY_LOG_DAYS: number = 90;

  // ─── Email Verification ───────────────────────────────────────────────────

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  REQUIRE_EMAIL_VERIFICATION: boolean = false;

  // ─── Concurrent Session Limits ────────────────────────────────────────────

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  MAX_CONCURRENT_SESSIONS: number = 5;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  MAX_CONCURRENT_SESSIONS_DONOR: number = 3;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  MAX_CONCURRENT_SESSIONS_HOSPITAL: number = 5;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  MAX_CONCURRENT_SESSIONS_ADMIN: number = 2;

  @IsOptional()
  @IsString()
  STORAGE_PATH: string = './uploads';
}
