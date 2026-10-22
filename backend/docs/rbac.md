# Role-Based Access Control (RBAC)

This document describes the permission model used by the backend and the
permissions granted to each role. Permissions are declared in
`src/auth/enums/permission.enum.ts` and enforced by `PermissionsGuard` via the
`@RequirePermissions(...)` decorator.

## Permission format

Permissions follow the `resource:action` convention (for example
`blood-unit:allocate`). The enum member name is the upper-snake-case form of
the permission string.

## Roles and permissions

### `admin`

- `admin:access` (`ADMIN_ACCESS`, including detailed health access)
- `blood-unit:allocate` (`ALLOCATE_BLOOD_UNITS`)
- `rider:assign` (`ASSIGN_RIDER`)
- `incident-review:create` (`CREATE_INCIDENT_REVIEW`)
- `incident-review:view` (`VIEW_INCIDENT_REVIEWS`)
- `incident-review:manage` (`MANAGE_INCIDENT_REVIEWS`)
- `hospital-override:view` (`VIEW_HOSPITAL_OVERRIDES`)
- `hospital-override:manage` (`MANAGE_HOSPITAL_OVERRIDES`)
- `inventory:manage` (`MANAGE_INVENTORY`)
- `region:view` (`VIEW_REGIONS`)
- `region:manage` (`MANAGE_REGIONS`)

### `hospital_admin`

- `blood-unit:allocate` (`ALLOCATE_BLOOD_UNITS`)
- `incident-review:create` (`CREATE_INCIDENT_REVIEW`)
- `incident-review:view` (`VIEW_INCIDENT_REVIEWS`)
- `hospital-override:view` (`VIEW_HOSPITAL_OVERRIDES`)
- `inventory:manage` (`MANAGE_INVENTORY`)
- `region:view` (`VIEW_REGIONS`)

### `coordinator`

- `rider:assign` (`ASSIGN_RIDER`)
- `incident-review:create` (`CREATE_INCIDENT_REVIEW`)
- `incident-review:view` (`VIEW_INCIDENT_REVIEWS`)
- `incident-review:manage` (`MANAGE_INCIDENT_REVIEWS`)
- `hospital-override:view` (`VIEW_HOSPITAL_OVERRIDES`)
- `inventory:manage` (`MANAGE_INVENTORY`)
- `region:view` (`VIEW_REGIONS`)
- `region:manage` (`MANAGE_REGIONS`)

### `rider`

- `region:view` (`VIEW_REGIONS`)

### `donor`

- `region:view` (`VIEW_REGIONS`)

## Coverage

`rbac-coverage.spec.ts` asserts that every `Permission` enum member is granted
to at least one role and documented above. When adding a permission, update the
enum, seed it for the appropriate roles in a migration, and add it to this file.
