export enum Permission {
  // ─── Orders ────────────────────────────────────────────────────────
  CREATE_ORDER = 'CREATE_ORDER',
  READ_ORDER = 'READ_ORDER',
  UPDATE_ORDER = 'UPDATE_ORDER',
  CANCEL_ORDER = 'CANCEL_ORDER',

  // ─── Hospitals ──────────────────────────────────────────────────────
  CREATE_HOSPITAL = 'CREATE_HOSPITAL',
  READ_HOSPITAL = 'READ_HOSPITAL',
  UPDATE_HOSPITAL = 'UPDATE_HOSPITAL',
  DELETE_HOSPITAL = 'DELETE_HOSPITAL',

  // ─── Riders ─────────────────────────────────────────────────────────
  CREATE_RIDER = 'CREATE_RIDER',
  READ_RIDER = 'READ_RIDER',
  UPDATE_RIDER = 'UPDATE_RIDER',
  DELETE_RIDER = 'DELETE_RIDER',
  MANAGE_RIDERS = 'MANAGE_RIDERS',

  // ─── Inventory ──────────────────────────────────────────────────────
  CREATE_INVENTORY = 'CREATE_INVENTORY',
  READ_INVENTORY = 'READ_INVENTORY',
  UPDATE_INVENTORY = 'UPDATE_INVENTORY',
  DELETE_INVENTORY = 'DELETE_INVENTORY',

  // ─── Blood Units ────────────────────────────────────────────────────
  REGISTER_BLOOD_UNIT = 'REGISTER_BLOOD_UNIT',
  TRANSFER_BLOOD_CUSTODY = 'TRANSFER_BLOOD_CUSTODY',
  VIEW_BLOODUNIT_TRAIL = 'VIEW_BLOODUNIT_TRAIL',

  // ─── Users ──────────────────────────────────────────────────────────
  CREATE_USER = 'CREATE_USER',
  READ_USER = 'READ_USER',
  UPDATE_USER = 'UPDATE_USER',
  DELETE_USER = 'DELETE_USER',
  MANAGE_USERS = 'MANAGE_USERS',

  // ─── Dispatch ───────────────────────────────────────────────────────
  CREATE_DISPATCH = 'CREATE_DISPATCH',
  READ_DISPATCH = 'READ_DISPATCH',
  UPDATE_DISPATCH = 'UPDATE_DISPATCH',
  ASSIGN_DISPATCH = 'ASSIGN_DISPATCH',

  // ─── Admin ──────────────────────────────────────────────────────────
  MANAGE_ROLES = 'MANAGE_ROLES',
  VIEW_ANALYTICS = 'VIEW_ANALYTICS',
  MANAGE_SYSTEM = 'MANAGE_SYSTEM',
}
