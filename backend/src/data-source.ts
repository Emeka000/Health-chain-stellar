/**
 * TypeORM DataSource used exclusively by the TypeORM CLI for migrations.
 * Not imported by the NestJS application — the app uses TypeOrmModule.forRootAsync.
 *
 * Usage:
 *   npm run build
 *   npm run migration:run      # apply pending migrations
 *   npm run migration:revert   # roll back the last migration
 *   npm run migration:generate src/migrations/<Name>  # generate from entity diff
 *   npm run migration:create   src/migrations/<Name>  # empty migration scaffold
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USERNAME ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? '',
  database: process.env.DATABASE_NAME ?? 'health_chain',
  // Entities are loaded from compiled output so the CLI can resolve them
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/migrations/*.js'],
  synchronize: false,
  migrationsRun: false,
});

export default AppDataSource;
