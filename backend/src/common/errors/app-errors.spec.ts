import {
  AppError,
  BlockchainTxIrrecoverableError,
  BloodRequestIrrecoverableError,
  CompensationAction,
  DispatchIrrecoverableError,
  FailureDomain,
  IrrecoverableError,
  InventoryReservationIrrecoverableError,
  RecoverableError,
} from './app-errors';

describe('AppError hierarchy', () => {
  it('RecoverableError is recoverable', () => {
    const err = new RecoverableError('timeout', { attempt: 1 });
    expect(err.isRecoverable).toBe(true);
    expect(err.message).toBe('timeout');
    expect(err.context).toEqual({ attempt: 1 });
  });

  it('IrrecoverableError is not recoverable', () => {
    const err = new IrrecoverableError(
      'permanent failure',
      FailureDomain.BLOCKCHAIN,
      [CompensationAction.NOTIFY_ADMIN],
      { jobId: 'abc' },
    );
    expect(err.isRecoverable).toBe(false);
    expect(err.domain).toBe(FailureDomain.BLOCKCHAIN);
    expect(err.compensations).toContain(CompensationAction.NOTIFY_ADMIN);
  });

  it('preserves cause stack', () => {
    const cause = new Error('root cause');
    const err = new RecoverableError('wrapped', {}, cause);
    expect(err.stack).toContain('Caused by:');
  });

  describe('BlockchainTxIrrecoverableError', () => {
    it('has correct domain and compensations', () => {
      const err = new BlockchainTxIrrecoverableError('tx failed', {
        jobId: '1',
      });
      expect(err.domain).toBe(FailureDomain.BLOCKCHAIN);
      expect(err.compensations).toContain(CompensationAction.PERSIST_DLQ);
      expect(err.compensations).toContain(CompensationAction.NOTIFY_ADMIN);
      expect(err.compensations).toContain(CompensationAction.FLAG_FOR_REVIEW);
      expect(err.isRecoverable).toBe(false);
    });
  });

  describe('BloodRequestIrrecoverableError', () => {
    it('includes inventory revert and user notification', () => {
      const err = new BloodRequestIrrecoverableError('chain fail', {
        requestNumber: 'BR-1',
      });
      expect(err.domain).toBe(FailureDomain.BLOOD_REQUEST);
      expect(err.compensations).toContain(CompensationAction.REVERT_INVENTORY);
      expect(err.compensations).toContain(CompensationAction.NOTIFY_USER);
      expect(err.compensations).toContain(
        CompensationAction.CANCEL_BLOOD_REQUEST,
      );
    });
  });

  describe('InventoryReservationIrrecoverableError', () => {
    it('has inventory domain', () => {
      const err = new InventoryReservationIrrecoverableError(
        'corrupt stock',
        {},
      );
      expect(err.domain).toBe(FailureDomain.INVENTORY);
      expect(err.compensations).toContain(CompensationAction.REVERT_INVENTORY);
    });
  });

  describe('DispatchIrrecoverableError', () => {
    it('has dispatch domain and cancel order', () => {
      const err = new DispatchIrrecoverableError('no riders', {
        orderId: 'o1',
      });
      expect(err.domain).toBe(FailureDomain.DISPATCH);
      expect(err.compensations).toContain(CompensationAction.CANCEL_ORDER);
    });
  });

  it('all concrete errors extend AppError', () => {
    const errors: AppError[] = [
      new BlockchainTxIrrecoverableError('a', {}),
      new BloodRequestIrrecoverableError('b', {}),
      new InventoryReservationIrrecoverableError('c', {}),
      new DispatchIrrecoverableError('d', {}),
      new RecoverableError('e'),
    ];
    errors.forEach((e) => expect(e).toBeInstanceOf(AppError));
  });
});
