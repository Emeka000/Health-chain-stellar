import { ForbiddenException } from '@nestjs/common';

export interface TenantActorContext {
  userId: string;
  role?: string | null;
  organizationId?: string | null;
}

export interface ResourceTenantBinding {
  resourceType: string;
  resourceId: string;
  ownerIds: Array<string | null | undefined>;
}

export function hasTenantAccess(
  actor: TenantActorContext,
  ownerIds: Array<string | null | undefined>,
): boolean {
  const role = (actor.role ?? '').toLowerCase();
  if (role === 'admin') return true;
  if (!actor.organizationId) return false;
  return ownerIds.some((ownerId) => ownerId === actor.organizationId);
}

export function assertTenantAccess(
  actor: TenantActorContext,
  binding: ResourceTenantBinding,
): void {
  if (hasTenantAccess(actor, binding.ownerIds)) return;
  throw new ForbiddenException(
    `Cross-tenant access denied for ${binding.resourceType} '${binding.resourceId}'`,
  );
}
