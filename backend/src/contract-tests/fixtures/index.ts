/**
 * Contract Fixtures Index
 *
 * All pact-style contracts between critical module boundaries.
 * Serves as the source of truth for API boundary contracts.
 *
 * Each fixture carries:
 *  - schemaVersion: explicit version tag for drift detection
 *  - generatedAt: timestamp for provenance tracking
 *  - provenance: source definition reference
 */

export {
  BloodRequestsInventoryContract,
  ReserveStockRequestInteraction,
  ReleaseStockRequestInteraction,
  InsufficientStockErrorInteraction,
} from './blood-requests-inventory.fixture';

export {
  BloodRequestsSorobanContract,
  SubmitBloodRequestBlockchainInteraction,
  DuplicateSubmissionErrorInteraction,
  GetTransactionStatusInteraction,
} from './blood-requests-soroban.fixture';

export {
  DispatchRidersContract,
  AssignOrderToRiderInteraction,
  RiderAlreadyBusyErrorInteraction,
  ReleaseRiderFromOrderInteraction,
} from './dispatch-riders.fixture';

export {
  AuthContract,
  MissingAuthHeaderErrorInteraction,
  InvalidJWTTokenErrorInteraction,
  InsufficientPermissionsErrorInteraction,
  ValidAuthorizationInteraction,
} from './auth.fixture';

import { BloodRequestsInventoryContract } from './blood-requests-inventory.fixture';
import { BloodRequestsSorobanContract } from './blood-requests-soroban.fixture';
import { DispatchRidersContract } from './dispatch-riders.fixture';
import { AuthContract } from './auth.fixture';

/**
 * Get contract by name
 */
export function getContractByName(name: string) {
  const contracts = [
    BloodRequestsInventoryContract,
    BloodRequestsSorobanContract,
    DispatchRidersContract,
    AuthContract,
    DonationContract,
    DonationAttributionContract,
  ];
  return contracts.find((c) => c.name === name);
}

// Re-export for convenience
import { BloodRequestsInventoryContract } from './blood-requests-inventory.fixture';
import { BloodRequestsSorobanContract } from './blood-requests-soroban.fixture';
import { DispatchRidersContract } from './dispatch-riders.fixture';
import { AuthContract } from './auth.fixture';
import { DonationContract } from './donation.fixture';
import { DonationAttributionContract } from './donation-attribution.fixture';
