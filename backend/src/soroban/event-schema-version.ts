export const CONTRACT_EVENT_SCHEMA_VERSION = 1;
export const LEGACY_CONTRACT_EVENT_SCHEMA_VERSION = 0;

export const SUPPORTED_CONTRACT_EVENT_SCHEMA_VERSIONS = [
  LEGACY_CONTRACT_EVENT_SCHEMA_VERSION,
  CONTRACT_EVENT_SCHEMA_VERSION,
] as const;

type EventLike = {
  eventData?: Record<string, unknown> | null;
  topics?: unknown[] | null;
};

export class UnsupportedContractEventSchemaVersionError extends Error {
  constructor(version: number) {
    super(`Unsupported contract event schema version: ${version}`);
    this.name = UnsupportedContractEventSchemaVersionError.name;
  }
}

export function getContractEventSchemaVersion(event: EventLike): number {
  const payloadVersion =
    event.eventData?.schemaVersion ?? event.eventData?.schema_version;

  if (payloadVersion !== undefined) {
    return normalizeSchemaVersion(payloadVersion);
  }

  const topicVersion = event.topics?.[event.topics.length - 1];
  if (topicVersion !== undefined) {
    const parsed = parseTopicVersion(topicVersion);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return LEGACY_CONTRACT_EVENT_SCHEMA_VERSION;
}

export function assertSupportedContractEventSchemaVersion(
  event: EventLike,
): number {
  const version = getContractEventSchemaVersion(event);
  if (
    !(SUPPORTED_CONTRACT_EVENT_SCHEMA_VERSIONS as readonly number[]).includes(
      version,
    )
  ) {
    throw new UnsupportedContractEventSchemaVersionError(version);
  }
  return version;
}

function parseTopicVersion(topic: unknown): number | undefined {
  if (typeof topic !== 'string') {
    return undefined;
  }

  const match = /^v(\d+)$/.exec(topic);
  return match ? Number(match[1]) : undefined;
}

function normalizeSchemaVersion(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const prefixed = parseTopicVersion(trimmed);
    if (prefixed !== undefined) {
      return prefixed;
    }

    const parsed = Number(trimmed);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  throw new UnsupportedContractEventSchemaVersionError(Number.NaN);
}
