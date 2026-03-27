import { BadRequestException } from '@nestjs/common';

/**
 * Stellar public key: G + 55 base-32 characters (uppercase A-Z, 2-7), total 56 chars.
 * This is the strkey encoding of an Ed25519 public key.
 */
const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;

/**
 * Idempotency key: printable ASCII, 1–128 characters, no whitespace.
 * Keeps Bull job IDs safe and deterministic.
 */
const IDEMPOTENCY_KEY_RE = /^[\x21-\x7E]{1,128}$/;

/**
 * Contract method name: lowercase letters, digits, underscores, 1–64 chars.
 * Matches Soroban Rust function naming conventions.
 */
const CONTRACT_METHOD_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Donor ID (optional symbol passed to the contract): alphanumeric + hyphen/underscore,
 * 1–64 chars. Symbols in Soroban are limited to 32 bytes but we enforce 64 to be safe.
 */
const DONOR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ─── Individual validators ────────────────────────────────────────────────────

/**
 * Asserts that `value` is a valid Stellar public key (G-address).
 * Throws BadRequestException with an explicit message on failure.
 */
export function assertStellarPublicKey(value: string, field: string): void {
  if (!value || typeof value !== 'string') {
    throw new BadRequestException(
      `'${field}' must be a non-empty string; received ${JSON.stringify(value)}.`,
    );
  }
  if (!STELLAR_PUBLIC_KEY_RE.test(value)) {
    throw new BadRequestException(
      `'${field}' is not a valid Stellar public key. ` +
        `Expected a 56-character G-address (G + 55 base-32 chars); received '${value}'.`,
    );
  }
}

/**
 * Asserts that `value` is a safe, non-empty idempotency key.
 */
export function assertIdempotencyKey(
  value: string,
  field = 'idempotencyKey',
): void {
  if (!value || typeof value !== 'string') {
    throw new BadRequestException(
      `'${field}' must be a non-empty string; received ${JSON.stringify(value)}.`,
    );
  }
  if (!IDEMPOTENCY_KEY_RE.test(value)) {
    throw new BadRequestException(
      `'${field}' contains invalid characters or exceeds 128 characters. ` +
        `Only printable ASCII (no whitespace) is allowed; received '${value}'.`,
    );
  }
}

/**
 * Asserts that `value` is a valid Soroban contract method name.
 */
export function assertContractMethod(
  value: string,
  field = 'contractMethod',
): void {
  if (!value || typeof value !== 'string') {
    throw new BadRequestException(
      `'${field}' must be a non-empty string; received ${JSON.stringify(value)}.`,
    );
  }
  if (!CONTRACT_METHOD_RE.test(value)) {
    throw new BadRequestException(
      `'${field}' is not a valid contract method name. ` +
        `Expected lowercase letters/digits/underscores (1–64 chars); received '${value}'.`,
    );
  }
}

/**
 * Asserts that `value` is a positive safe integer suitable as a blockchain unit ID.
 */
export function assertBlockchainUnitId(value: number, field = 'unitId'): void {
  if (!Number.isInteger(value) || value <= 0 || !Number.isSafeInteger(value)) {
    throw new BadRequestException(
      `'${field}' must be a positive safe integer; received ${JSON.stringify(value)}.`,
    );
  }
}

/**
 * Asserts that an optional donor ID is safe to pass as a Soroban symbol.
 */
export function assertDonorId(
  value: string | undefined,
  field = 'donorId',
): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !DONOR_ID_RE.test(value)) {
    throw new BadRequestException(
      `'${field}' must be alphanumeric with hyphens/underscores, 1–64 chars; ` +
        `received '${value}'.`,
    );
  }
}

// ─── Composite validators ─────────────────────────────────────────────────────

/**
 * Validates all IDs required for a `registerBloodUnit` on-chain call.
 */
export function assertRegisterBloodUnitIds(params: {
  bankId: string;
  donorId?: string;
}): void {
  assertStellarPublicKey(params.bankId, 'bankId');
  assertDonorId(params.donorId, 'donorId');
}

/**
 * Validates all IDs required for a `transferCustody` on-chain call.
 */
export function assertTransferCustodyIds(params: {
  unitId: number;
  fromAccount: string;
  toAccount: string;
}): void {
  assertBlockchainUnitId(params.unitId, 'unitId');
  assertStellarPublicKey(params.fromAccount, 'fromAccount');
  assertStellarPublicKey(params.toAccount, 'toAccount');

  if (params.fromAccount === params.toAccount) {
    throw new BadRequestException(
      `'fromAccount' and 'toAccount' must be different addresses; ` +
        `both are '${params.fromAccount}'.`,
    );
  }
}

/**
 * Validates all IDs required for a `logTemperature` on-chain call.
 */
export function assertLogTemperatureIds(params: { unitId: number }): void {
  assertBlockchainUnitId(params.unitId, 'unitId');
}

/**
 * Validates the fields of a SorobanTxJob before it is enqueued.
 */
export function assertSorobanTxJob(job: {
  contractMethod: string;
  idempotencyKey: string;
}): void {
  assertContractMethod(job.contractMethod, 'contractMethod');
  assertIdempotencyKey(job.idempotencyKey, 'idempotencyKey');
}
