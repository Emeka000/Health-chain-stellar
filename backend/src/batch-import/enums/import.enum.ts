export enum ImportEntityType {
  ORGANIZATION = 'ORGANIZATION',
  RIDER = 'RIDER',
  INVENTORY = 'INVENTORY',
}

export enum ImportRowStatus {
  VALID = 'VALID',
  INVALID = 'INVALID',
}

export enum ImportBatchStatus {
  STAGED = 'STAGED',
  COMMITTED = 'COMMITTED',
  REJECTED = 'REJECTED',
}
