import {
  InFlightConflictPolicy,
  OrgLifecycleStatus,
  RestrictionLevel,
  VerificationChangeReason,
} from '../enums/org-lifecycle.enum';

export class OrgVerificationStatusChangedEvent {
  constructor(
    public readonly organizationId: string,
    public readonly fromStatus: OrgLifecycleStatus | null,
    public readonly toStatus: OrgLifecycleStatus,
    public readonly actorId: string,
    public readonly reason: VerificationChangeReason,
    public readonly conflictPolicy: InFlightConflictPolicy | null,
    public readonly inFlightOrderIds: string[],
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrgGracePeriodStartedEvent {
  constructor(
    public readonly organizationId: string,
    public readonly expiresAt: Date,
    public readonly restrictionLevel: RestrictionLevel,
    public readonly actorId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrgGracePeriodEscalatedEvent {
  constructor(
    public readonly organizationId: string,
    public readonly gracePeriodId: string,
    public readonly restrictionLevel: RestrictionLevel,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrgGracePeriodExpiredEvent {
  constructor(
    public readonly organizationId: string,
    public readonly gracePeriodId: string,
    public readonly targetStatus: OrgLifecycleStatus,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class OrgInFlightOrdersFlaggedEvent {
  constructor(
    public readonly organizationId: string,
    public readonly orderIds: string[],
    public readonly conflictPolicy: InFlightConflictPolicy,
    public readonly timestamp: Date = new Date(),
  ) {}
}
