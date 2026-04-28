export enum Permission {
  MANAGE_FEE_POLICIES = 'MANAGE_FEE_POLICIES',
  VIEW_FEE_POLICIES = 'VIEW_FEE_POLICIES',
  // ── Orders ──────────────────────────────────────────────────────────
  CREATE_ORDER = 'create:order',
  VIEW_ORDER = 'view:order',
  UPDATE_ORDER = 'update:order',
  CANCEL_ORDER = 'cancel:order',
  DELETE_ORDER = 'delete:order',

  // ── Riders ──────────────────────────────────────────────────────────
  VIEW_RIDERS = 'view:riders',
  CREATE_RIDER = 'create:rider',
  UPDATE_RIDER = 'update:rider',
  DELETE_RIDER = 'delete:rider',
  MANAGE_RIDERS = 'manage:riders',

  // ── Hospitals ────────────────────────────────────────────────────────
  VIEW_HOSPITALS = 'view:hospitals',
  CREATE_HOSPITAL = 'create:hospital',
  UPDATE_HOSPITAL = 'update:hospital',
  DELETE_HOSPITAL = 'delete:hospital',

  // ── Inventory ────────────────────────────────────────────────────────
  VIEW_INVENTORY = 'view:inventory',
  CREATE_INVENTORY = 'create:inventory',
  UPDATE_INVENTORY = 'update:inventory',
  DELETE_INVENTORY = 'delete:inventory',
  INVENTORY_WRITE = 'inventory:write',

  // ── Blood Units ──────────────────────────────────────────────────────
  VIEW_BLOODUNIT_TRAIL = 'view:bloodunit:trail',
  REGISTER_BLOOD_UNIT = 'register:bloodunit',
  TRANSFER_CUSTODY = 'transfer:custody',
  LOG_TEMPERATURE = 'log:temperature',
  UPDATE_BLOOD_STATUS = 'update:blood-status',
  VIEW_BLOOD_STATUS_HISTORY = 'view:blood-status-history',

  // ── Dispatch ─────────────────────────────────────────────────────────
  VIEW_DISPATCH = 'view:dispatch',
  CREATE_DISPATCH = 'create:dispatch',
  UPDATE_DISPATCH = 'update:dispatch',
  DELETE_DISPATCH = 'delete:dispatch',
  MANAGE_DISPATCH = 'manage:dispatch',
  DISPATCH_OVERRIDE = 'dispatch:override',

  // ── Users ─────────────────────────────────────────────────────────────
  VIEW_USERS = 'view:users',
  MANAGE_USERS = 'manage:users',
  DELETE_USER = 'delete:user',

  // ── Notifications ────────────────────────────────────────────────────
  VIEW_NOTIFICATIONS = 'view:notifications',
  MANAGE_NOTIFICATIONS = 'manage:notifications',

  // ── Location History ─────────────────────────────────────────────────
  RECORD_LOCATION = 'record:location',
  VIEW_LOCATION_HISTORY = 'view:location-history',

  // ── Maps ─────────────────────────────────────────────────────────────
  VIEW_MAPS = 'view:maps',

  // ── Blockchain / Soroban ──────────────────────────────────────────────
  MANAGE_SOROBAN = 'manage:soroban',
  VIEW_BLOCKCHAIN = 'view:blockchain',

  // ── Reputation ────────────────────────────────────────────────────────
  VIEW_REPUTATION = 'view:reputation',
  MANAGE_REPUTATION = 'manage:reputation',

  // ── Admin ─────────────────────────────────────────────────────────────
  ADMIN_ACCESS = 'admin:access',
  MANAGE_ROLES = 'manage:roles',
  READ_ANALYTICS = 'read:analytics',
  EXPORT_DISPUTES = 'export:disputes',

  // ── Fine-grained workflow scopes (Issue #374) ─────────────────────────
  REQUEST_APPROVE = 'request:approve',
  DISPUTE_RESOLVE = 'dispute:resolve',
  VERIFICATION_ADMIN = 'verification:admin',
  SETTLEMENT_RELEASE = 'settlement:release',
}
