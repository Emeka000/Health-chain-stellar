import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { EscalationGateway } from './escalation.gateway';
import { EscalationTriggeredEvent } from '../events/escalation-triggered.event';
import { EscalationAcknowledgedEvent } from '../events/escalation-acknowledged.event';

describe('EscalationGateway', () => {
  let gateway: EscalationGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [EscalationGateway],
    }).compile();

    gateway = module.get<EscalationGateway>(EscalationGateway);

    // Stub the WebSocket server so emit calls don't throw without a live socket
    (gateway as any).server = { emit: jest.fn() };
  });

  it('is defined and can be resolved from the DI container', () => {
    expect(gateway).toBeDefined();
  });

  it('afterInit logs the gateway initialisation message', () => {
    const logSpy = jest
      .spyOn((gateway as any).logger, 'log')
      .mockImplementation(() => undefined);
    gateway.afterInit();
    expect(logSpy).toHaveBeenCalledWith('EscalationGateway initialised');
  });

  it('handleTriggered emits escalation.triggered event to all WebSocket clients', () => {
    const event = new EscalationTriggeredEvent(
      'req-1',
      'order-1',
      'TIER_2',
      'hospital-1',
      Date.now() + 60_000,
      'rider-1',
    );

    gateway.handleTriggered(event);

    expect((gateway as any).server.emit).toHaveBeenCalledWith(
      'escalation.triggered',
      event,
    );
  });

  it('handleAcknowledged emits escalation.acknowledged event to all WebSocket clients', () => {
    const event = new EscalationAcknowledgedEvent('esc-1', 'user-42');

    gateway.handleAcknowledged(event);

    expect((gateway as any).server.emit).toHaveBeenCalledWith(
      'escalation.acknowledged',
      event,
    );
  });

  it('EscalationModule providers array includes EscalationGateway (regression guard)', async () => {
    // Verify the module metadata directly — no heavy module bootstrap needed
    const { EscalationModule } = await import('./escalation.module');
    const providers = Reflect.getMetadata('providers', EscalationModule) as unknown[];
    expect(providers).toContain(EscalationGateway);
  });
});
