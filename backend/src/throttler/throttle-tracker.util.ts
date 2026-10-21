import { ExecutionContext } from '@nestjs/common';
import { getClientIp } from '../common/utils/client-ip.util';

/**
 * Anonymous clients are tracked by IP; authenticated clients by user id
 * (JWT runs before the throttler guard so `req.user` is set on protected routes).
 */
export function throttleGetTracker(
  req: Record<string, any>,
  _context: ExecutionContext,
): Promise<string> {
  const user = req.user as { id?: string } | undefined;
  if (user?.id) {
    return Promise.resolve(`user:${user.id}`);
  }
  const ip = getClientIp(req) ?? 'unknown';
  return Promise.resolve(`ip:${ip}`);
}
