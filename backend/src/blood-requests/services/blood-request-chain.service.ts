import { Injectable, Logger } from '@nestjs/common';
import { SorobanService } from '../../blockchain/services/soroban.service';
import { CompensationService } from '../../common/compensation/compensation.service';
import {
  BloodRequestIrrecoverableError,
  CompensationAction,
} from '../../common/errors/app-errors';
import { InventoryService } from '../../inventory/inventory.service';
import { EmailProvider } from '../../notifications/providers/email.provider';

export interface ReservedItem {
  bloodBankId: string;
  bloodType: string;
  quantity: number;
}

/**
 * Blood type enum as expected by the requests contract `create_request`.
 * Values mirror the on-chain `BloodType` enum discriminants.
 */
export enum ChainBloodType {
  APositive = 0,
  ANegative = 1,
  BPositive = 2,
  BNegative = 3,
  ABPositive = 4,
  ABNegative = 5,
  OPositive = 6,
  ONegative = 7,
}

/**
 * Blood component enum as expected by the requests contract `create_request`.
 */
export enum ChainBloodComponent {
  WholeBlood = 0,
  RedCells = 1,
  Plasma = 2,
  Platelets = 3,
}

/**
 * Urgency enum as expected by the requests contract `create_request`.
 */
export enum ChainUrgency {
  Routine = 0,
  Urgent = 1,
  Critical = 2,
}

export interface SubmitToChainOptions {
  /** Stellar address (G.../C...) of the requesting hospital. */
  hospitalAddress: string;
  /** Blood component requested; defaults to whole blood. */
  component?: ChainBloodComponent;
  /** Request urgency; defaults to routine. */
  urgency?: ChainUrgency;
  /** Unix timestamp (seconds) by which the request must be fulfilled. */
  requiredByTimestamp: number;
}

const BLOOD_TYPE_MAP: Record<string, ChainBloodType> = {
  'A+': ChainBloodType.APositive,
  'A-': ChainBloodType.ANegative,
  'B+': ChainBloodType.BPositive,
  'B-': ChainBloodType.BNegative,
  'AB+': ChainBloodType.ABPositive,
  'AB-': ChainBloodType.ABNegative,
  'O+': ChainBloodType.OPositive,
  'O-': ChainBloodType.ONegative,
};

@Injectable()
export class BloodRequestChainService {
  private readonly logger = new Logger(BloodRequestChainService.name);

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly compensationService: CompensationService,
    private readonly inventoryService: InventoryService,
    private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * Submit the blood request to Soroban.
   * On failure, runs compensation (inventory rollback + notifications) and
   * re-throws a BloodRequestIrrecoverableError so the caller never sees a
   * partial state.
   */
  async submitToChain(
    requestNumber: string,
    hospitalId: string,
    items: ReservedItem[],
    userEmail: string,
    options: SubmitToChainOptions,
  ): Promise<string> {
    try {
      const args = this.buildCreateRequestArgs(items, options);
      const result = await this.sorobanService.submitTransactionAndWait({
        contractMethod: 'create_request',
        args,
        idempotencyKey: `blood-request:${requestNumber}`,
        metadata: { requestNumber, hospitalId },
      });
      return result.transactionHash;
    } catch (cause) {
      await this.compensate(requestNumber, hospitalId, items, userEmail, cause);
    }
  }

  /**
   * Build the positional argument list for the requests contract entrypoint
   * `create_request(hospital, blood_type, component, quantity_ml, urgency,
   * required_by_timestamp)`.
   */
  private buildCreateRequestArgs(
    items: ReservedItem[],
    options: SubmitToChainOptions,
  ): unknown[] {
    if (!options.hospitalAddress) {
      throw new BloodRequestIrrecoverableError(
        'Missing hospital Stellar address for create_request',
        { hospitalAddress: options.hospitalAddress },
      );
    }

    const bloodType = this.resolveBloodType(items);
    const quantityMl = items.reduce((sum, item) => sum + Math.round(item.quantity), 0);
    if (quantityMl <= 0) {
      throw new BloodRequestIrrecoverableError(
        'Cannot submit create_request with zero quantity',
        { items },
      );
    }

    return [
      options.hospitalAddress,
      bloodType,
      options.component ?? ChainBloodComponent.WholeBlood,
      quantityMl,
      options.urgency ?? ChainUrgency.Routine,
      Math.floor(options.requiredByTimestamp),
    ];
  }

  /**
   * All reserved items in a single request must share one blood type, since
   * the contract accepts a single `blood_type` per request.
   */
  private resolveBloodType(items: ReservedItem[]): ChainBloodType {
    if (items.length === 0) {
      throw new BloodRequestIrrecoverableError(
        'Cannot submit create_request without reserved items',
        { items },
      );
    }

    const types = new Set(items.map((item) => item.bloodType));
    if (types.size !== 1) {
      throw new BloodRequestIrrecoverableError(
        'Reserved items span multiple blood types; split into separate requests',
        { bloodTypes: [...types] },
      );
    }

    const [rawType] = [...types];
    const mapped = BLOOD_TYPE_MAP[rawType.trim().toUpperCase()];
    if (mapped === undefined) {
      throw new BloodRequestIrrecoverableError(
        `Unsupported blood type for create_request: ${rawType}`,
        { bloodType: rawType },
      );
    }
    return mapped;
  }

  private async compensate(
    requestNumber: string,
    hospitalId: string,
    reserved: ReservedItem[],
    userEmail: string,
    cause: unknown,
  ): Promise<never> {
    const err = new BloodRequestIrrecoverableError(
      `Soroban create_request failed for ${requestNumber}`,
      { requestNumber, hospitalId, reservedItems: reserved },
      cause,
    );

    const handlers = [
      ...reserved.map((r) => ({
        action: CompensationAction.REVERT_INVENTORY,
        execute: async () => {
          await this.inventoryService.releaseStockByBankAndType(
            r.bloodBankId,
            r.bloodType,
            r.quantity,
          );
          return true;
        },
      })),
      {
        action: CompensationAction.NOTIFY_USER,
        execute: async () => {
          try {
            await this.emailProvider.send(
              userEmail,
              `Blood request ${requestNumber} could not be processed`,
              `<p>Your blood request <strong>${requestNumber}</strong> could not be registered on-chain and has been cancelled.</p>`,
            );
            return true;
          } catch {
            return false;
          }
        },
      },
      {
        action: CompensationAction.NOTIFY_ADMIN,
        execute: async () => {
          this.logger.error('[ADMIN ALERT] Blood request on-chain failure', {
            requestNumber,
            hospitalId,
          });
          return true;
        },
      },
      {
        action: CompensationAction.FLAG_FOR_REVIEW,
        execute: async () => true,
      },
    ];

    const result = await this.compensationService.compensate(
      err,
      handlers,
      `blood-request:${requestNumber}`,
    );
    err.context['failureRecordId'] = result.failureRecordId;
    throw err;
  }
}
