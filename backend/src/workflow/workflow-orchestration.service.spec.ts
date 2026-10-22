/**
 * Tests for WorkflowOrchestrationService
 *
 * Covers issue #1186: rollback() must use a stable idempotency key
 * (`rollback:${requestId}`) rather than a timestamp-suffixed key, so that
 * SorobanService.submitTransaction's idempotency check can correctly catch
 * duplicate rollback submissions for the same order.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { SorobanService } from '../blockchain/services/soroban.service';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { ActorRegistryService } from '../registry/actor-registry.service';

import { WorkflowOrchestrationService } from './workflow-orchestration.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<OrderEntity> = {}): OrderEntity {
  return {
    id: 'req-abc',
    status: OrderStatus.PENDING,
    ...overrides,
  } as OrderEntity;
}

function makeService(
  opts: {
    order?: OrderEntity | null;
    isVerified?: boolean;
  } = {},
) {
  const submitTransaction = jest.fn().mockResolvedValue('job-123');

  const soroban = {
    submitTransaction,
  } as unknown as SorobanService;

  const resolvedOrder = opts.order !== undefined ? opts.order : makeOrder();

  const orderRepo = {
    findOne: jest.fn().mockResolvedValue(resolvedOrder),
  };

  const actorRegistry = {
    isVerifiedActor: jest.fn().mockResolvedValue(opts.isVerified ?? true),
  } as unknown as ActorRegistryService;

  const configService = {
    get: jest.fn().mockReturnValue('COORDINATOR-CONTRACT'),
  };

  const service = new WorkflowOrchestrationService(
    soroban,
    configService as never,
    actorRegistry,
    orderRepo as never,
  );

  return { service, submitTransaction, orderRepo };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkflowOrchestrationService', () => {
  describe('#1186 — rollback() idempotency key', () => {
    it('uses a stable idempotency key (rollback:<requestId>) without a timestamp', async () => {
      const { service, submitTransaction } = makeService({
        order: makeOrder({ status: OrderStatus.PENDING }),
      });

      await service.rollback({ requestId: 'req-abc' });

      expect(submitTransaction).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const rawFirst = submitTransaction.mock.calls[0][0];
      const call = rawFirst as { idempotencyKey: string };
      expect(call.idempotencyKey).toBe('rollback:req-abc');
    });

    it('does NOT include Date.now() or any timestamp in the idempotency key', async () => {
      const { service, submitTransaction } = makeService({
        order: makeOrder({ status: OrderStatus.IN_TRANSIT }),
      });

      await service.rollback({ requestId: 'order-xyz' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const rawCall = submitTransaction.mock.calls[0][0];
      const key: string = (rawCall as { idempotencyKey: string })
        .idempotencyKey;
      // Key must be exactly `rollback:<requestId>` — no colon-separated suffix
      expect(key).toMatch(/^rollback:[^:]+$/);
    });

    it('produces the same idempotency key on consecutive calls for the same requestId', async () => {
      const { service, submitTransaction } = makeService({
        order: makeOrder({ status: OrderStatus.CONFIRMED }),
      });

      // Call rollback twice; without the fix the keys would differ (timestamp)
      await service.rollback({ requestId: 'req-42' });
      await service.rollback({ requestId: 'req-42' });

      const keys = submitTransaction.mock.calls.map((c) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
        const raw = c[0];
        return (raw as { idempotencyKey: string }).idempotencyKey;
      });
      expect(keys[0]).toBe(keys[1]);
    });

    it('returns the job ID returned by soroban.submitTransaction', async () => {
      const { service } = makeService({
        order: makeOrder({ status: OrderStatus.DISPATCHED }),
      });

      const result = await service.rollback({ requestId: 'req-abc' });
      expect(result).toEqual({ jobId: 'job-123' });
    });

    it('throws BadRequestException when the order is not found', async () => {
      const { service } = makeService({ order: null });

      await expect(service.rollback({ requestId: 'missing' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for a DELIVERED order (non-rollbackable)', async () => {
      const { service } = makeService({
        order: makeOrder({ status: OrderStatus.DELIVERED }),
      });

      await expect(service.rollback({ requestId: 'req-abc' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('allocateUnits()', () => {
    it('uses stable idempotency key allocate:<requestId>', async () => {
      const { service, submitTransaction } = makeService();

      await service.allocateUnits({
        requestId: 'req-abc',
        unitIds: ['u1'],
        paymentId: 'pay-1',
        callerAddress: 'addr-1',
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const rawCall = submitTransaction.mock.calls[0][0];
      const key = (rawCall as { idempotencyKey: string }).idempotencyKey;
      expect(key).toBe('allocate:req-abc');
    });

    it('throws ForbiddenException for unregistered caller', async () => {
      const { service } = makeService({ isVerified: false });

      await expect(
        service.allocateUnits({
          requestId: 'req-abc',
          unitIds: ['u1'],
          paymentId: 'pay-1',
          callerAddress: 'unknown-addr',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
