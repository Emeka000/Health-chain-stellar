import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { BloodUnitEntity } from '../../blood-units/entities/blood-unit.entity';
import { BloodStatus } from '../../blood-units/enums/blood-status.enum';

/** Statuses that allow a unit to be reserved for fulfillment. */
const RESERVABLE_STATUSES: readonly string[] = [BloodStatus.AVAILABLE];

export interface UnitReservationCheck {
  unitNumber: string;
  expectedBloodType: string;
  expectedBankId: string;
}

/**
 * Enforces the three invariants that must hold before any blood unit
 * can be committed to a reservation:
 *
 *  1. Existence   — the unit record must be present in the database.
 *  2. Uniqueness  — no duplicate unitNumber may exist in the same request batch.
 *  3. Blood-type  — the unit's stored bloodType must match the requested type.
 *  4. Status      — the unit must be AVAILABLE (not RESERVED, IN_TRANSIT, etc.).
 *
 * All violations are rejected with a precise 4xx error before any write occurs.
 */
@Injectable()
export class ReservedUnitInvariantService {
  constructor(
    @InjectRepository(BloodUnitEntity)
    private readonly unitRepo: Repository<BloodUnitEntity>,
  ) {}

  /**
   * Validates a batch of units in a single DB round-trip.
   * Throws on the first invariant violation found.
   */
  async assertReservable(checks: UnitReservationCheck[]): Promise<void> {
    this.assertNoDuplicatesInBatch(checks);

    const unitNumbers = checks.map((c) => c.unitNumber);
    const found = await this.unitRepo.find({
      where: { unitNumber: In(unitNumbers) },
      select: ['unitNumber', 'bloodType', 'bankId'],
    });

    const foundMap = new Map(found.map((u) => [u.unitNumber, u]));

    for (const check of checks) {
      const unit = foundMap.get(check.unitNumber);

      // 1. Existence
      if (!unit) {
        throw new NotFoundException(
          `Blood unit '${check.unitNumber}' does not exist.`,
        );
      }

      // 3. Blood-type match
      if (unit.bloodType !== check.expectedBloodType) {
        throw new BadRequestException(
          `Blood unit '${check.unitNumber}' has blood type '${unit.bloodType}' ` +
            `but the request expects '${check.expectedBloodType}'.`,
        );
      }

      // Bank ownership
      if (unit.bankId !== check.expectedBankId) {
        throw new BadRequestException(
          `Blood unit '${check.unitNumber}' belongs to bank '${unit.bankId}' ` +
            `but the request targets bank '${check.expectedBankId}'.`,
        );
      }
    }
  }

  /**
   * Validates a single unit's status is AVAILABLE before reservation.
   * Call this after locking the row (e.g. inside a transaction).
   */
  assertUnitStatus(
    unitNumber: string,
    currentStatus: string,
    allowedStatuses: readonly string[] = RESERVABLE_STATUSES,
  ): void {
    if (!allowedStatuses.includes(currentStatus)) {
      throw new ConflictException(
        `Blood unit '${unitNumber}' cannot be reserved: ` +
          `current status is '${currentStatus}', expected one of [${allowedStatuses.join(', ')}].`,
      );
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  /** 2. Uniqueness — reject duplicate unitNumbers within the same request. */
  private assertNoDuplicatesInBatch(checks: UnitReservationCheck[]): void {
    const seen = new Set<string>();
    for (const { unitNumber } of checks) {
      if (seen.has(unitNumber)) {
        throw new BadRequestException(
          `Duplicate unit '${unitNumber}' in the same reservation request. ` +
            `Each unit may only appear once.`,
        );
      }
      seen.add(unitNumber);
    }
  }
}
