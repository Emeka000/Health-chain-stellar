import { Server } from 'socket.io';

import { AuthenticatedSocket, WsAuthService } from '../../auth/ws-auth.service';

import { LiveOpsGateway, LiveRiderPosition } from './live-ops.gateway';

interface TestClient {
  client: AuthenticatedSocket;
  join: jest.Mock;
  emit: jest.Mock;
  disconnect: jest.Mock;
}

describe('LiveOpsGateway', () => {
  let gateway: LiveOpsGateway;
  let wsAuthService: { authenticate: jest.Mock };
  let middleware: jest.Mock;

  const makeClient = (
    user?: Partial<NonNullable<AuthenticatedSocket['user']>>,
  ): TestClient => {
    const join = jest.fn();
    const emit = jest.fn();
    const disconnect = jest.fn();

    const client = {
      id: 'socket-1',
      user: user ? { userId: 'user-1', tenantId: 't-1', ...user } : undefined,
      join,
      emit,
      disconnect,
      handshake: { address: '127.0.0.1' },
    } as unknown as AuthenticatedSocket;

    return { client, join, emit, disconnect };
  };

  const position = (
    over: Partial<LiveRiderPosition> = {},
  ): LiveRiderPosition => ({
    riderId: 'user-1',
    lat: 6.5244,
    lng: 3.3792,
    status: 'en_route',
    timestamp: new Date(),
    ...over,
  });

  beforeEach(() => {
    middleware = jest.fn();
    wsAuthService = { authenticate: jest.fn().mockReturnValue(middleware) };
    gateway = new LiveOpsGateway(wsAuthService as unknown as WsAuthService);
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as unknown as Server;
  });

  describe('authentication', () => {
    it('installs the JWT handshake middleware on init', () => {
      const use = jest.fn();
      gateway.afterInit({ use } as unknown as Server);

      expect(wsAuthService.authenticate).toHaveBeenCalled();
      expect(use).toHaveBeenCalledTimes(1);
    });

    it('routes handshakes through the auth middleware', () => {
      const use = jest.fn();
      gateway.afterInit({ use } as unknown as Server);

      const calls = use.mock.calls as Array<
        [(socket: unknown, next: () => void) => void]
      >;
      const registered = calls[0][0];
      const next = jest.fn();
      registered({ id: 'socket-1' }, next);

      expect(middleware).toHaveBeenCalledWith({ id: 'socket-1' }, next);
    });

    it('disconnects a socket that arrives without an authenticated user', () => {
      const { client, disconnect } = makeClient();

      gateway.handleConnection(client);

      expect(disconnect).toHaveBeenCalledWith(true);
    });

    it('keeps an authenticated socket connected', () => {
      const { client, disconnect } = makeClient({ role: 'admin' });

      gateway.handleConnection(client);

      expect(disconnect).not.toHaveBeenCalled();
    });
  });

  describe('ops.subscribe', () => {
    it('rejects a non-operator role', () => {
      const { client, join, emit } = makeClient({ role: 'donor' });

      gateway.handleSubscribe(client, {});

      expect(join).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        'auth_error',
        expect.stringContaining('Insufficient permissions'),
      );
    });

    it('rejects an unauthenticated client', () => {
      const { client, join } = makeClient();

      gateway.handleSubscribe(client, {});

      expect(join).not.toHaveBeenCalled();
    });

    it('admits an operator to the global room', () => {
      const { client, join, emit } = makeClient({ role: 'admin' });

      gateway.handleSubscribe(client, {});

      expect(join).toHaveBeenCalledWith('ops:global');
      expect(emit).toHaveBeenCalledWith('ops.subscribed', {
        room: 'ops:global',
      });
    });

    it('admits an operator to a region room', () => {
      const { client, join } = makeClient({ role: 'dispatcher' });

      gateway.handleSubscribe(client, { region: 'lagos' });

      expect(join).toHaveBeenCalledWith('ops:region:lagos');
    });
  });

  describe('ops.rider.location', () => {
    it('refuses to broadcast a position for another rider', () => {
      const { client, emit } = makeClient({ userId: 'rider-1', role: 'rider' });
      const broadcast = jest.spyOn(gateway, 'broadcastRiderPosition');

      gateway.handleRiderLocation(client, position({ riderId: 'rider-2' }));

      expect(broadcast).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        'auth_error',
        expect.stringContaining('cannot publish another rider position'),
      );
    });

    it('broadcasts a rider its own position', () => {
      const { client } = makeClient({ userId: 'rider-1', role: 'rider' });
      const broadcast = jest.spyOn(gateway, 'broadcastRiderPosition');

      gateway.handleRiderLocation(client, position({ riderId: 'rider-1' }));

      expect(broadcast).toHaveBeenCalled();
    });

    it('rejects an unauthenticated publisher', () => {
      const { client } = makeClient();
      const broadcast = jest.spyOn(gateway, 'broadcastRiderPosition');

      gateway.handleRiderLocation(client, position());

      expect(broadcast).not.toHaveBeenCalled();
    });

    it.each([
      ['latitude above range', { lat: 91 }],
      ['latitude below range', { lat: -91 }],
      ['longitude above range', { lng: 181 }],
      ['longitude below range', { lng: -181 }],
      ['non-numeric latitude', { lat: 'here' as unknown as number }],
      ['NaN longitude', { lng: Number.NaN }],
    ])('rejects %s', (_label, over) => {
      const { client, emit } = makeClient({ userId: 'rider-1', role: 'rider' });
      const broadcast = jest.spyOn(gateway, 'broadcastRiderPosition');

      gateway.handleRiderLocation(
        client,
        position({ riderId: 'rider-1', ...over }),
      );

      expect(broadcast).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith('ops.error', 'Invalid coordinates');
    });

    it('rejects a malformed payload', () => {
      const { client } = makeClient({ userId: 'rider-1', role: 'rider' });
      const broadcast = jest.spyOn(gateway, 'broadcastRiderPosition');

      gateway.handleRiderLocation(
        client,
        undefined as unknown as LiveRiderPosition,
      );

      expect(broadcast).not.toHaveBeenCalled();
    });
  });
});
