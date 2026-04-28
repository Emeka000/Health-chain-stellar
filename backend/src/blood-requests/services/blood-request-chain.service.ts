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
  ): Promise<string> {
    try {
      const result = await this.sorobanService.submitTransactionAndWait({
        contractMethod: 'create_blood_request',
        args: [requestNumber, hospitalId, JSON.stringify(items)],
        idempotencyKey: `blood-request:${requestNumber}`,
        metadata: { requestNumber, hospitalId },
      });
      return result.transactionHash;
    } catch (cause) {
      await this.compensate(requestNumber, hospitalId, items, userEmail, cause);
    }
  }

  private async compensate(
    requestNumber: string,
    hospitalId: string,
    reserved: ReservedItem[],
    userEmail: string,
    cause: unknown,
  ): Promise<never> {
    const err = new BloodRequestIrrecoverableError(
      `Soroban create_blood_request failed for ${requestNumber}`,
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
