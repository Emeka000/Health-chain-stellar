export type LifebankContractDomain =
  | 'inventory'
  | 'requests'
  | 'payments'
  | 'custody';

export const LIFEBANK_CONTRACT_BOUNDARIES = {
  inventory: {
    sourceOfTruth: 'lifebank-soroban/contracts/inventory',
    methods: {
      registerBlood: 'register_blood',
      reserveBlood: 'reserve_blood',
      releaseReservation: 'release_reservation',
      updateStatus: 'update_status',
    },
  },
  requests: {
    sourceOfTruth: 'lifebank-soroban/contracts/requests',
    methods: {
      createRequest: 'create_request',
      getRequest: 'get_request',
      getMetadata: 'get_metadata',
    },
  },
  payments: {
    sourceOfTruth: 'lifebank-soroban/contracts/payments',
    methods: {
      createPayment: 'create_payment',
      createEscrow: 'create_escrow',
      updateStatus: 'update_status',
      recordDispute: 'record_dispute',
      resolveDispute: 'resolve_dispute',
    },
  },
  custody: {
    sourceOfTruth: 'contracts/src/lib.rs',
    methods: {
      transferCustody: 'transfer_custody',
      logTemperature: 'log_temperature',
    },
  },
} as const;

export const LIFEBANK_REQUESTS_METHODS =
  LIFEBANK_CONTRACT_BOUNDARIES.requests.methods;
export const LIFEBANK_INVENTORY_METHODS =
  LIFEBANK_CONTRACT_BOUNDARIES.inventory.methods;
export const LIFEBANK_PAYMENTS_METHODS =
  LIFEBANK_CONTRACT_BOUNDARIES.payments.methods;
export const LEGACY_CONTRACT_METHOD_ALIASES: Record<string, string> = {
  create_blood_request: LIFEBANK_REQUESTS_METHODS.createRequest,
  order_payment: LIFEBANK_PAYMENTS_METHODS.createPayment,
};

const LIFEBANK_BLOOD_TYPE_INDEX: Record<string, number> = {
  'A+': 0,
  'A-': 1,
  'B+': 2,
  'B-': 3,
  'AB+': 4,
  'AB-': 5,
  'O+': 6,
  'O-': 7,
};

export function normalizeContractMethod(contractMethod: string): string {
  return LEGACY_CONTRACT_METHOD_ALIASES[contractMethod] ?? contractMethod;
}

export function mapBloodTypeToLifebankIndex(bloodType: string): number {
  const normalized = bloodType.trim().toUpperCase();
  const value = LIFEBANK_BLOOD_TYPE_INDEX[normalized];

  if (value === undefined) {
    throw new Error(`Invalid blood type: ${bloodType}`);
  }

  return value;
}
