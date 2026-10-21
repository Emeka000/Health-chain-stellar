export interface ClientIpRequest {
  ip?: string | null;
  socket?: { remoteAddress?: string | null };
}

export function getClientIp(request?: ClientIpRequest | null): string | null {
  const ipAddress = request?.ip?.trim() || request?.socket?.remoteAddress?.trim();
  return ipAddress || null;
}