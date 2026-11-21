# Database Migration Policy

## Overview

This document outlines the database migration policy for HealthDonor Protocol. **CI/CD does NOT enforce migration file creation for schema changes.**

## Current Status

- **Migration Validation in CI**: ❌ DISABLED
- **Migration Files Required**: ❌ NO
- **Schema Synchronization**: Enabled in development mode via TypeORM `synchronize: true`

## Migration Strategy

### Development Environment

In development (`NODE_ENV=development`), TypeORM automatically synchronizes the database schema:

```typescript
// src/app.module.ts
synchronize: configService.get<string>('NODE_ENV', 'development') === 'development'
```

This means:
- Entity changes are automatically applied to the database
- No manual migration files are required for local development
- Schema changes are reflected immediately

### Production Environment

In production (`NODE_ENV=production`), schema synchronization is disabled:

```typescript
synchronize: false  // Production uses explicit migrations
```

For production deployments:
1. Create migration files for schema changes
2. Run migrations before deploying new code
3. Test migrations in staging environment first

## Creating Migrations

### When to Create Migrations

Create migration files when:
- Deploying to production
- Making breaking schema changes
- Adding new database columns or tables
- Modifying column constraints or types

### How to Create Migrations

Using TypeORM CLI:

```bash
# Generate migration from entity changes
npm run typeorm migration:generate -- -n <MigrationName>

# Create empty migration
npm run typeorm migration:create -- -n <MigrationName>

# Run migrations
npm run typeorm migration:run

# Revert last migration
npm run typeorm migration:revert
```

### Migration File Structure

```typescript
// src/migrations/1708000000000-CreateUsersTable.ts
import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateUsersTable1708000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'email',
            type: 'varchar',
            isUnique: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('users');
  }
}
```

## CI/CD Behavior

### What CI Does NOT Check

❌ Migration files are NOT required for PRs
❌ Schema changes are NOT validated against migrations
❌ Missing migration files do NOT block merges
❌ Entity changes do NOT trigger CI failures

### What CI DOES Check

✅ Code quality (ESLint, Prettier)
✅ Unit tests pass
✅ Contract tests pass (module boundaries)
✅ Security vulnerabilities
✅ Type safety (TypeScript)

## Development Workflow

### Local Development

1. Modify entity files in `src/**/*.entity.ts`
2. TypeORM automatically synchronizes schema
3. Test changes locally
4. Commit entity changes

### Before Deployment

1. Generate migration files for production
2. Test migrations in staging environment
3. Include migration files in deployment PR
4. Run migrations as part of deployment process

### Example Workflow

```bash
# 1. Modify entity
vim src/users/entities/user.entity.ts

# 2. Test locally (schema auto-syncs)
npm run start:dev

# 3. Before production deployment, generate migration
npm run typeorm migration:generate -- -n AddUserPhoneColumn

# 4. Test migration in staging
npm run typeorm migration:run

# 5. Commit migration file
git add src/migrations/1708000001000-AddUserPhoneColumn.ts
git commit -m "feat: add phone column to users table"
```

## Writing a Migration

This section describes the **only** approved way to create migration files. New contributors must follow these rules.

### Step 1: Use the npm Script (Required)

**Never hand-pick timestamps.** Always use the `migration:create` npm script:

```bash
cd backend
npm run migration:create -- -n DescribeYourChange
```

This generates a migration file with a unique, monotonically increasing timestamp:

```
src/migrations/1708012345678-DescribeYourChange.ts
```

Timestamps are managed by TypeORM and are guaranteed to be unique and sequentially ordered.

### Step 2: Implement `up()` and `down()`

Complete both the `up()` and `down()` methods. The migration must:

- **Only alter or create tables that existed in earlier migrations** — do not reference tables created by later migrations
- **Be reversible** — `down()` must undo every change made by `up()`
- **Include comments** explaining the purpose of the change
- **Follow existing patterns** in `src/migrations/`

**Example:**

```typescript
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPhoneToUsers1708012345678 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add phone column to users table (created in 1708000003000-CreateUserTable.ts)
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'phone',
        type: 'varchar',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the phone column
    await queryRunner.dropColumn('users', 'phone');
  }
}
```

### Step 3: Test on a Fresh Database (Required)

Before opening a PR, test the migration on an empty database:

```bash
# Drop and recreate the database (development only)
npm run typeorm query "DROP DATABASE health_chain"
npm run typeorm query "CREATE DATABASE health_chain"

# Run all migrations
npm run migration:run

# Verify all migrations succeeded
npm run typeorm migration:show
```

**Troubleshooting:** If the migration fails, it likely violates one of the rules above (referencing a non-existent table, incorrect `down()` method, etc.). Fix it before opening a PR.

### Step 4: Reference Other Migrations Correctly

When your migration depends on a table created by another migration, verify that migration runs first:

```typescript
// ✅ CORRECT: Reference a table created in an earlier migration
// (1708000003000-CreateUserTable.ts created 'users')
export class AddPhoneToUsers1708012345678 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('users', ...);
  }
}

// ❌ WRONG: Reference a table created in a later migration
// (1780000000000-CreateAuthSessionTable.ts does not exist yet when
// this migration runs)
export class UpdateAuthSession1708012000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('auth_sessions', ...); // FAILS if not yet created
  }
}
```

### Timestamp Uniqueness

The npm script generates timestamps that are **always unique and monotonically increasing**. You will never encounter duplicate timestamps if you follow this process.

**Why timestamps matter:**
- TypeORM executes migrations in timestamp order
- Timestamps determine which table exists when your migration runs
- Hand-picked timestamps cause conflicts and unpredictable behavior

## Best Practices

### For Developers

1. **Keep migrations simple**: One logical change per migration
2. **Test migrations on an empty database**: Always run `migration:run` on a clean database before opening a PR
3. **Document changes**: Add comments explaining the purpose of changes
4. **Reversibility**: Always implement `down()` method that fully reverses `up()`
5. **Naming**: Use descriptive migration names (e.g., `AddUserPhoneColumn`)
6. **Never hand-pick timestamps**: Use `npm run migration:create` — it generates unique timestamps automatically

### For Code Review

1. Review entity changes for correctness
2. Verify migrations are included for production changes
3. Check migration reversibility
4. Ensure backward compatibility when possible

### For Deployment

1. Run migrations before deploying new code
2. Have rollback plan ready
3. Monitor database during migration
4. Verify data integrity after migration

## Troubleshooting

### Migration Failed

```bash
# Check migration status
npm run typeorm migration:show

# Revert last migration
npm run typeorm migration:revert

# Fix migration file and retry
npm run typeorm migration:run
```

### Schema Out of Sync

In development, restart the application:

```bash
npm run start:dev
```

TypeORM will automatically synchronize the schema.

### Production Schema Issues

1. Check migration history: `npm run typeorm migration:show`
2. Review migration files for errors
3. Test migration in staging environment
4. Contact database administrator if needed

## FAQ

**Q: Do I need to create migration files for development?**
A: No. TypeORM automatically synchronizes the schema in development mode.

**Q: Will CI fail if I don't include migration files?**
A: No. CI does not validate migration files. However, production deployments require migrations.

**Q: Can I modify existing migration files?**
A: No. Never modify migration files that have been run in production. Create new migrations instead.

**Q: What if I need to rollback a migration?**
A: Use `npm run typeorm migration:revert` to rollback the last migration.

**Q: How do I handle data migrations?**
A: Create a migration file with custom SQL in the `up()` method to transform data.

## References

- [TypeORM Migrations Documentation](https://typeorm.io/migrations)
- [Database Migration Best Practices](https://www.liquibase.org/get-started/best-practices)
- [Entity Documentation](./ENTITY_GUIDE.md)

## Related Issues

- #256: Remove migration linter/check in CI
- #243: API versioning strategy
