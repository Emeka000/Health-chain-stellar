# RBAC — Role-to-Permission Matrix

> **Source of truth:** the seed data in
> [`1708000001000-CreateRbacTables.ts`](../backend/src/migrations/1708000001000-CreateRbacTables.ts)
> and
> [`1820000002000-AddFineGrainedPermissionScopes.ts`](../backend/src/migrations/1820000002000-AddFineGrainedPermissionScopes.ts).
>
> **How to stay in sync:** a Jest test at
> [`backend/src/auth/__tests__/rbac-coverage.spec.ts`](../backend/src/auth/__tests__/rbac-coverage.spec.ts)
> fails whenever a `Permission` enum value is not granted to at least one role,
> so the table below can never silently drift from the migrations.

---

## Roles

| Role | Description |
|------|-------------|
| `admin` | Full platform access |
| `hospital` | Hospital staff |
| `donor` | Blood donor |
| `rider` | Delivery rider |
| `vendor` | Blood bank / vendor |

---

## Permission Matrix

`✓` = granted by a migration seed · `—` = not granted (endpoint returns 403 for that role)

### Orders

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `CREATE_ORDER` | `create:order` | Submit a new blood / supply request | ✓ | ✓ | ✓ | — | — |
| `VIEW_ORDER` | `view:order` | Read order details and status | ✓ | ✓ | ✓ | ✓ | ✓ |
| `UPDATE_ORDER` | `update:order` | Modify an existing order | ✓ | — | — | ✓ | — |
| `CANCEL_ORDER` | `cancel:order` | Cancel an open order | ✓ | ✓ | ✓ | — | — |
| `DELETE_ORDER` | `delete:order` | Hard-delete an order record | ✓ | — | — | — | — |

### Riders

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `VIEW_RIDERS` | `view:riders` | List / view rider profiles | ✓ | — | — | ✓ | — |
| `CREATE_RIDER` | `create:rider` | Register a new rider account | ✓ | — | — | — | — |
| `UPDATE_RIDER` | `update:rider` | Update rider profile / details | ✓ | — | — | ✓ | — |
| `DELETE_RIDER` | `delete:rider` | Remove a rider account | ✓ | — | — | — | — |
| `MANAGE_RIDERS` | `manage:riders` | Bulk rider management operations | ✓ | — | — | — | — |

### Hospitals

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `VIEW_HOSPITALS` | `view:hospitals` | List / view hospital profiles | ✓ | ✓ | — | — | — |
| `CREATE_HOSPITAL` | `create:hospital` | Register a new hospital | ✓ | — | — | — | — |
| `UPDATE_HOSPITAL` | `update:hospital` | Update hospital details | ✓ | — | — | — | — |
| `DELETE_HOSPITAL` | `delete:hospital` | Remove a hospital record | ✓ | — | — | — | — |

### Inventory

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `VIEW_INVENTORY` | `view:inventory` | Read inventory records | ✓ | ✓ | — | — | ✓ |
| `CREATE_INVENTORY` | `create:inventory` | Add new inventory items | ✓ | — | — | — | ✓ |
| `UPDATE_INVENTORY` | `update:inventory` | Modify inventory quantities / metadata | ✓ | — | — | — | ✓ |
| `DELETE_INVENTORY` | `delete:inventory` | Remove inventory records | ✓ | — | — | — | — |
| `INVENTORY_WRITE` | `inventory:write` | Fine-grained create/update/delete scope (Issue #374) | ✓ | — | — | — | ✓ |

### Blood Units & Chain of Custody

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `VIEW_BLOODUNIT_TRAIL` | `view:bloodunit:trail` | Read the immutable audit trail for a blood unit | ✓ | ✓ | — | ✓ | ✓ |
| `REGISTER_BLOOD_UNIT` | `register:bloodunit` | Add a new blood unit to the system | ✓ | ✓ | — | — | ✓ |
| `TRANSFER_CUSTODY` | `transfer:custody` | Record a custody handoff on-chain | ✓ | — | — | ✓ | ✓ |
| `LOG_TEMPERATURE` | `log:temperature` | Record a cold-chain temperature event | ✓ | — | — | ✓ | ✓ |
| `UPDATE_BLOOD_STATUS` | `update:blood-status` | Change a unit's processing / viability status | — | — | — | — | — |
| `VIEW_BLOOD_STATUS_HISTORY` | `view:blood-status-history` | Read historical status changes for a unit | — | — | — | — | — |

> ⚠️ **Known gap:** `UPDATE_BLOOD_STATUS` and `VIEW_BLOOD_STATUS_HISTORY` exist in the
> `Permission` enum but are not granted to any role. Any endpoint guarded by these
> permissions returns `403` for all users. Tracked in
> [#1548](https://github.com/Emeka000/Health-chain-stellar/issues/1548).

### Dispatch

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `VIEW_DISPATCH` | `view:dispatch` | Read dispatch jobs and routes | ✓ | — | — | ✓ | — |
| `CREATE_DISPATCH` | `create:dispatch` | Create a new dispatch assignment | ✓ | — | — | — | — |
| `UPDATE_DISPATCH` | `update:dispatch` | Update dispatch status / routing | ✓ | — | — | ✓ | — |
| `DELETE_DISPATCH` | `delete:dispatch` | Remove a dispatch record | ✓ | — | — | — | — |
| `MANAGE_DISPATCH` | `manage:dispatch` | Bulk / supervisory dispatch operations | ✓ | — | — | ✓ | — |
| `DISPATCH_OVERRIDE` | `dispatch:override` | Force-assign or override a dispatch decision (Issue #374) | ✓ | — | — | ✓ | — |

### Location

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `RECORD_LOCATION` | `record:location` | Write a location ping for a rider / asset | — | — | — | — | — |
| `VIEW_LOCATION_HISTORY` | `view:location-history` | Read historical location data | — | — | — | — | — |

> ⚠️ **Known bug:** Both location permissions are ungranted. Rider location tracking
> endpoints return `403` for everyone, including the `rider` role. The expected fix is
> to grant `RECORD_LOCATION` to `rider` and `VIEW_LOCATION_HISTORY` to `admin` and
> `rider` in a new migration. Tracked in
> [#1548](https://github.com/Emeka000/Health-chain-stellar/issues/1548).

### Users & Administration

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `VIEW_USERS` | `view:users` | List / view user accounts | ✓ | — | — | — | — |
| `MANAGE_USERS` | `manage:users` | Create, update, lock user accounts | ✓ | — | — | — | — |
| `DELETE_USER` | `delete:user` | Permanently delete a user account | ✓ | — | — | — | — |
| `ADMIN_ACCESS` | `admin:access` | General admin-only flag used for admin-panel routes | ✓ | — | — | — | — |
| `MANAGE_ROLES` | `manage:roles` | Assign / revoke roles | ✓ | — | — | — | — |

### Notifications & Maps

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `VIEW_NOTIFICATIONS` | `view:notifications` | Read own notifications | ✓ | ✓ | ✓ | ✓ | ✓ |
| `MANAGE_NOTIFICATIONS` | `manage:notifications` | Send or manage system notifications | ✓ | — | — | — | — |
| `VIEW_MAPS` | `view:maps` | Access map / routing views | ✓ | ✓ | — | ✓ | — |

### Blockchain / Soroban

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `MANAGE_SOROBAN` | `manage:soroban` | Deploy / invoke Soroban contracts | ✓ | — | — | — | — |
| `VIEW_BLOCKCHAIN` | `view:blockchain` | Read on-chain data and transaction history | ✓ | — | — | — | — |

### Workflow Scopes (Issue #374)

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `REQUEST_APPROVE` | `request:approve` | Approve or reject blood-request workflows | ✓ | ✓ | — | — | — |
| `DISPUTE_RESOLVE` | `dispute:resolve` | Manage and close disputes | ✓ | — | — | — | — |
| `VERIFICATION_ADMIN` | `verification:admin` | Verify / unverify healthcare actors | ✓ | — | — | — | — |
| `SETTLEMENT_RELEASE` | `settlement:release` | Release escrowed settlement funds | ✓ | — | — | — | — |

### Analytics & Reporting

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `READ_ANALYTICS` | `read:analytics` | Access platform analytics dashboards | — | — | — | — | — |
| `EXPORT_DISPUTES` | `export:disputes` | Export dispute records as CSV / JSON | — | — | — | — | — |
| `VIEW_BLOOD_REQUESTS` | `view:blood-requests` | List all blood requests platform-wide | — | — | — | — | — |
| `DOWNLOAD_REPORTS` | `download:reports` | Download generated reports | — | — | — | — | — |

> ⚠️ **Known gap:** All four analytics/reporting permissions are ungranted. Tracked in
> [#1548](https://github.com/Emeka000/Health-chain-stellar/issues/1548).

### Fee Policies & Reputation

| Permission enum | Wire value | What it allows | admin | hospital | donor | rider | vendor |
|-----------------|------------|----------------|:-----:|:--------:|:-----:|:-----:|:------:|
| `MANAGE_FEE_POLICIES` | `MANAGE_FEE_POLICIES` | Create / update platform fee rules | — | — | — | — | — |
| `VIEW_FEE_POLICIES` | `VIEW_FEE_POLICIES` | Read current fee configuration | — | — | — | — | — |
| `VIEW_REPUTATION` | `view:reputation` | Read reputation scores | — | — | — | — | — |
| `MANAGE_REPUTATION` | `manage:reputation` | Adjust or reset reputation scores | — | — | — | — | — |

> ⚠️ **Known gap:** All four permissions are ungranted. Tracked in
> [#1548](https://github.com/Emeka000/Health-chain-stellar/issues/1548).

---

## How Permission Resolution Works

Permissions are resolved **from the role claim** in the JWT on every request. There is no
per-user override table.

```
HTTP request
  └─ JwtAuthGuard extracts { id, email, role } from the access token
       └─ PermissionsGuard calls PermissionsService.getPermissionsForRole(role)
            └─ SELECT permission FROM role_permissions
               JOIN roles ON role_permissions.role_id = roles.id
               WHERE roles.name = $role
                 └─ result set compared against @RequirePermissions(...) metadata
```

A route annotated with `@RequirePermissions(Permission.X, Permission.Y)` requires **all**
listed permissions; missing any one returns `403 Forbidden`.

---

## Adding or Changing a Grant

> Never edit existing migration files. Always write a new migration.

1. **Generate the migration file:**

   ```bash
   cd backend
   npm run migration:generate -- src/migrations/$(date +%s%3N)-DescribeChange
   ```

2. **Fill in `up` and `down`:**

   ```typescript
   // Grant a permission to an existing role
   await queryRunner.query(
     `INSERT INTO role_permissions (role_id, permission)
      SELECT id, $1 FROM roles WHERE name = $2
      ON CONFLICT DO NOTHING`,
     ['record:location', 'rider'],
   );

   // Revoke it in down()
   await queryRunner.query(
     `DELETE FROM role_permissions
      WHERE permission = $1
        AND role_id = (SELECT id FROM roles WHERE name = $2)`,
     ['record:location', 'rider'],
   );
   ```

3. **Update this document** — add or change the `✓` in the matrix above.

4. **Run the drift-detection test** to confirm no enum value is left ungranted:

   ```bash
   cd backend
   npm test -- --testPathPattern="rbac-coverage"
   ```

5. Apply: `npm run migration:run`

---

## Ungranted Permissions Summary

The following `Permission` enum values exist in code but are not yet seeded to any role.
Any endpoint guarded by these permissions returns `403` for **all users**. Each should
either receive a grant via a new migration or be removed from the enum if the feature is
not yet live.

| Permission enum | Wire value | Suggested grant |
|-----------------|------------|-----------------|
| `UPDATE_BLOOD_STATUS` | `update:blood-status` | `vendor`, `hospital` |
| `VIEW_BLOOD_STATUS_HISTORY` | `view:blood-status-history` | `admin`, `hospital`, `vendor` |
| `RECORD_LOCATION` | `record:location` | `rider` |
| `VIEW_LOCATION_HISTORY` | `view:location-history` | `admin`, `rider` |
| `READ_ANALYTICS` | `read:analytics` | `admin` |
| `EXPORT_DISPUTES` | `export:disputes` | `admin` |
| `VIEW_BLOOD_REQUESTS` | `view:blood-requests` | `admin`, `hospital` |
| `DOWNLOAD_REPORTS` | `download:reports` | `admin` |
| `MANAGE_FEE_POLICIES` | `MANAGE_FEE_POLICIES` | `admin` |
| `VIEW_FEE_POLICIES` | `VIEW_FEE_POLICIES` | `admin`, `hospital` |
| `VIEW_REPUTATION` | `view:reputation` | `admin`, `rider`, `hospital` |
| `MANAGE_REPUTATION` | `manage:reputation` | `admin` |
