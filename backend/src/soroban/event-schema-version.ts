export const CONTRACT_EVENT_SCHEMA_VERSION = 1;
export const LEGACY_CONTRACT_EVENT_SCHEMA_VERSION = 0;

export const SUPPORTED_CONTRACT_EVENT_SCHEMA_VERSIONS = [
  LEGACY_CONTRACT_EVENT_SCHEMA_VERSION,
  CONTRACT_EVENT_SCHEMA_VERSION,
] as const;

export type EventLike = {
  eventType?: string;
  transactionHash?: string;
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

export type ContractEventDecoder<T = Record<string, unknown>> = (
  event: EventLike,
) => T;

export interface EventDecoderRegistration {
  eventType: string;
  schemaVersion: number;
  decoder: ContractEventDecoder;
}

export interface PartialEventMetadata {
  schemaVersion: number;
  eventType?: string;
  transactionHash?: string;
}

const decoderRegistry = new Map<string, ContractEventDecoder>();

function decoderKey(eventType: string, schemaVersion: number): string {
  return `${eventType}::${schemaVersion}`;
}

/** Registers a decoder for a given event type + schema version pair. */
export function registerEventDecoder(
  registration: EventDecoderRegistration,
): void {
  decoderRegistry.set(
    decoderKey(registration.eventType, registration.schemaVersion),
    registration.decoder,
  );
}

/**
 * Attempts to decode an event using the decoder registered for its type and
 * schema version. Returns `undefined` (rather than throwing) when no decoder
 * is registered for that combination, so callers can quarantine the event.
 * Throws `UnsupportedContractEventSchemaVersionError` if the schema version
 * itself is not one this build knows how to handle.
 */
export function tryDecodeEvent(
  event: EventLike & { eventType: string },
): Record<string, unknown> | undefined {
  const version = assertSupportedContractEventSchemaVersion(event);
  const decoder = decoderRegistry.get(decoderKey(event.eventType, version));
  return decoder ? decoder(event) : undefined;
}

/** Best-effort metadata for quarantine logging when an event can't be decoded. */
export function extractPartialMetadata(event: EventLike): PartialEventMetadata {
  return {
    schemaVersion: getContractEventSchemaVersion(event),
    eventType: event.eventType,
    transactionHash: event.transactionHash,
  };
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
