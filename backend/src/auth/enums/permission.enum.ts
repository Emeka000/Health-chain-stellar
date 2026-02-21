export enum Permission {
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

  // ── Blood Units ──────────────────────────────────────────────────────
  VIEW_BLOODUNIT_TRAIL = 'view:bloodunit:trail',
  REGISTER_BLOOD_UNIT = 'register:bloodunit',
  TRANSFER_CUSTODY = 'transfer:custody',
  LOG_TEMPERATURE = 'log:temperature',

  // ── Dispatch ─────────────────────────────────────────────────────────
  VIEW_DISPATCH = 'view:dispatch',
  CREATE_DISPATCH = 'create:dispatch',
  UPDATE_DISPATCH = 'update:dispatch',
  DELETE_DISPATCH = 'delete:dispatch',
  MANAGE_DISPATCH = 'manage:dispatch',

  // ── Users ─────────────────────────────────────────────────────────────
  VIEW_USERS = 'view:users',
  MANAGE_USERS = 'manage:users',
  DELETE_USER = 'delete:user',

  // ── Notifications ────────────────────────────────────────────────────
  VIEW_NOTIFICATIONS = 'view:notifications',
  MANAGE_NOTIFICATIONS = 'manage:notifications',

  // ── Maps ─────────────────────────────────────────────────────────────
  VIEW_MAPS = 'view:maps',

  // ── Blockchain / Soroban ──────────────────────────────────────────────
  MANAGE_SOROBAN = 'manage:soroban',
  VIEW_BLOCKCHAIN = 'view:blockchain',

  // ── Admin ─────────────────────────────────────────────────────────────
  ADMIN_ACCESS = 'admin:access',
  MANAGE_ROLES = 'manage:roles',
}
