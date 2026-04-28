import { registerEventDecoder } from '../soroban/event-schema-version';
import { CONTRACT_EVENT_SCHEMA_VERSION, LEGACY_CONTRACT_EVENT_SCHEMA_VERSION } from '../soroban/event-schema-version';

/**
 * Register event decoders for supported schema versions.
 * This module should be imported during application bootstrap.
 */
export function registerContractEventDecoders(): void {
  // Current schema v1 decoders
  registerEventDecoder({
    eventType: 'blood_registered',
    schemaVersion: CONTRACT_EVENT_SCHEMA_VERSION,
    decoder: (event) => ({
      unitId: event.eventData?.unitId,
      donorId: event.eventData?.donorId,
      bloodType: event.eventData?.bloodType,
      collectionDate: event.eventData?.collectionDate,
      expiryDate: event.eventData?.expiryDate,
      timestamp: event.eventData?.timestamp,
    }),
  });

  registerEventDecoder({
    eventType: 'custody_transferred',
    schemaVersion: CONTRACT_EVENT_SCHEMA_VERSION,
    decoder: (event) => ({
      unitId: event.eventData?.unitId,
      fromFacility: event.eventData?.fromFacility,
      toFacility: event.eventData?.toFacility,
      transferReason: event.eventData?.transferReason,
      actor: event.eventData?.actor,
      timestamp: event.eventData?.timestamp,
    }),
  });

  registerEventDecoder({
    eventType: 'temperature_logged',
    schemaVersion: CONTRACT_EVENT_SCHEMA_VERSION,
    decoder: (event) => ({
      unitId: event.eventData?.unitId,
      temperature: event.eventData?.temperature,
      location: event.eventData?.location,
      sensorId: event.eventData?.sensorId,
      timestamp: event.eventData?.timestamp,
    }),
  });

  // Legacy schema v0 decoders (for backward compatibility)
  registerEventDecoder({
    eventType: 'blood_registered',
    schemaVersion: LEGACY_CONTRACT_EVENT_SCHEMA_VERSION,
    decoder: (event) => ({
      unitId: event.eventData?.unit_id || event.eventData?.id,
      donorId: event.eventData?.donor_id,
      bloodType: event.eventData?.blood_type,
      collectionDate: event.eventData?.collection_date,
      expiryDate: event.eventData?.expiry_date,
      timestamp: event.eventData?.timestamp || event.eventData?.created_at,
    }),
  });

  registerEventDecoder({
    eventType: 'custody_transferred',
    schemaVersion: LEGACY_CONTRACT_EVENT_SCHEMA_VERSION,
    decoder: (event) => ({
      unitId: event.eventData?.unit_id || event.eventData?.id,
      fromFacility: event.eventData?.from_facility,
      toFacility: event.eventData?.to_facility,
      transferReason: event.eventData?.transfer_reason,
      actor: event.eventData?.actor,
      timestamp: event.eventData?.timestamp || event.eventData?.created_at,
    }),
  });

  registerEventDecoder({
    eventType: 'temperature_logged',
    schemaVersion: LEGACY_CONTRACT_EVENT_SCHEMA_VERSION,
    decoder: (event) => ({
      unitId: event.eventData?.unit_id || event.eventData?.id,
      temperature: event.eventData?.temperature,
      location: event.eventData?.location,
      sensorId: event.eventData?.sensor_id,
      timestamp: event.eventData?.timestamp || event.eventData?.created_at,
    }),
  });
}