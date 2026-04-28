# Contract Alignment With Lifebank Model

## Source Of Truth

- `inventory`: `lifebank-soroban/contracts/inventory`
- `requests`: `lifebank-soroban/contracts/requests`
- `payments`: `lifebank-soroban/contracts/payments`
- `custody` and temperature orchestration: current root [`contracts/`](../../contracts) flow until equivalent Lifebank modules fully replace it

## Why This Exists

The repository currently has two contract trees:

- `contracts/` contains the original monolithic Health Chain contract surface
- `lifebank-soroban/contracts/*` contains the newer domain-sliced Lifebank packages

Backend integrations had drifted between the two naming schemes. The most visible mismatch was blood requests using the legacy `create_blood_request` method name even though the Lifebank requests contract exposes `create_request`.

## Alignment Applied In Backend

- Added `backend/src/blockchain/contracts/lifebank-contracts.ts` as the backend contract manifest
- Normalized deprecated method names at queue submission time to preserve backward compatibility
- Updated blood request submission to call the Lifebank requests method name directly
- Centralized blood type enum mapping against the Lifebank inventory contract ordering

## Migration Path

1. New backend code should import contract names from `lifebank-contracts.ts` instead of hardcoding method strings.
2. Existing queued or legacy callers may still submit deprecated names; the blockchain service normalizes them before enqueue.
3. Follow-up work should move any remaining request/payment/custody string literals into the shared manifest.
4. Once all callers are migrated, deprecated aliases can be removed in a dedicated cleanup PR.
