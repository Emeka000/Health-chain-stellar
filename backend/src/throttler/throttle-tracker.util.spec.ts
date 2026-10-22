import { ExecutionContext } from '@nestjs/common';

import { throttleGetTracker } from './throttle-tracker.util';

describe('throttleGetTracker', () => {
  const ctx = {} as ExecutionContext;

  it('uses user id when authenticated', async () => {
    await expect(
      throttleGetTracker({ user: { id: 'user-1' } }, ctx),
    ).resolves.toBe('user:user-1');
  });

  it('uses IP when anonymous', async () => {
    await expect(
      throttleGetTracker({ ip: '203.0.113.1', user: undefined }, ctx),
    ).resolves.toBe('ip:203.0.113.1');
  });

  it('falls back to socket remoteAddress', async () => {
    await expect(
      throttleGetTracker(
        { ip: undefined, user: undefined, socket: { remoteAddress: '::1' } },
        ctx,
      ),
    ).resolves.toBe('ip:::1');
  });

  it('does not use a spoofed forwarded-for header over the resolved IP', async () => {
    await expect(
      throttleGetTracker(
        {
          ip: '::1',
          headers: { 'x-forwarded-for': '203.0.113.99' },
          socket: { remoteAddress: '::1' },
        },
        ctx,
      ),
    ).resolves.toBe('ip:::1');
  });
});
