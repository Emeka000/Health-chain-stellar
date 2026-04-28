import {
  CONTRACT_EVENT_SCHEMA_VERSION,
  LEGACY_CONTRACT_EVENT_SCHEMA_VERSION,
  UnsupportedContractEventSchemaVersionError,
  assertSupportedContractEventSchemaVersion,
  getContractEventSchemaVersion,
} from './event-schema-version';

describe('contract event schema versioning', () => {
  it('treats events without a version marker as explicit legacy events', () => {
    expect(getContractEventSchemaVersion({ eventData: {} })).toBe(
      LEGACY_CONTRACT_EVENT_SCHEMA_VERSION,
    );
  });

  it('distinguishes current payload schema versions from legacy payloads', () => {
    const legacy = getContractEventSchemaVersion({ eventData: {} });
    const current = getContractEventSchemaVersion({
      eventData: { schemaVersion: CONTRACT_EVENT_SCHEMA_VERSION },
    });

    expect(legacy).toBe(0);
    expect(current).toBe(1);
    expect(current).not.toBe(legacy);
  });

  it('can decode the Soroban topic version marker used by contract events', () => {
    expect(
      getContractEventSchemaVersion({
        topics: ['blood', 'request', 'v1'],
        eventData: {},
      }),
    ).toBe(CONTRACT_EVENT_SCHEMA_VERSION);
  });

  it('rejects unknown future versions instead of silently decoding them', () => {
    expect(() =>
      assertSupportedContractEventSchemaVersion({
        eventData: { schemaVersion: 2 },
      }),
    ).toThrow(UnsupportedContractEventSchemaVersionError);
  });
});
