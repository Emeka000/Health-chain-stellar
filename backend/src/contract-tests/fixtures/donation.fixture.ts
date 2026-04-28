/**
 * Donation & Pledge Contract Fixtures
 *
 * Generated from DonationEntity and PledgeEntity schemas.
 * Version-tagged for drift detection.
 */

import { generateFixture, GeneratedFixture } from '../utils/fixture-generator';
import { createInteraction, createServiceContract } from '../utils/interaction-matcher';

export const DONATION_SCHEMA_VERSION = '1.0.0';

export const DonationEntityFixture: GeneratedFixture = generateFixture(
  'DonationEntity',
  DONATION_SCHEMA_VERSION,
  {
    fields: {
      id: { type: 'uuid', example: '00000000-0000-0000-0000-000000000001' },
      amount: { type: 'decimal', example: 100.0 },
      asset: { type: 'string', enum: ['XLM', 'USDC', 'HEALTH'], example: 'XLM' },
      payerAddress: { type: 'string', example: 'GABC...XYZ' },
      recipientId: { type: 'string', example: 'hospital-001' },
      status: { type: 'string', enum: ['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED'], example: 'PENDING' },
      memo: { type: 'string', example: 'DON-ABCD1234' },
      transactionHash: { type: 'string', nullable: true, example: null },
      donorUserId: { type: 'uuid', nullable: true, example: null },
      createdAt: { type: 'timestamp', example: '2026-01-01T00:00:00.000Z' },
      updatedAt: { type: 'timestamp', example: '2026-01-01T00:00:00.000Z' },
      metadata: { type: 'object', nullable: true, example: null },
    },
    required: ['id', 'amount', 'asset', 'payerAddress', 'recipientId', 'status', 'memo', 'createdAt', 'updatedAt'],
  },
);

export const PledgeEntityFixture: GeneratedFixture = generateFixture(
  'PledgeEntity',
  DONATION_SCHEMA_VERSION,
  {
    fields: {
      id: { type: 'uuid', example: '00000000-0000-0000-0000-000000000002' },
      amount: { type: 'decimal', example: 50.0 },
      asset: { type: 'string', enum: ['XLM', 'USDC', 'HEALTH'], example: 'XLM' },
      payerAddress: { type: 'string', example: 'GABC...XYZ' },
      recipientId: { type: 'string', example: 'hospital-001' },
      frequency: { type: 'string', enum: ['WEEKLY', 'MONTHLY', 'QUARTERLY'], example: 'MONTHLY' },
      causeTag: { type: 'string', example: 'blood-supply' },
      regionTag: { type: 'string', example: 'nairobi' },
      emergencyPool: { type: 'boolean', example: false },
      status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'COMPLETED'], example: 'ACTIVE' },
      memo: { type: 'string', example: 'PLG-ABCD1234' },
      sorobanPledgeId: { type: 'string', nullable: true, example: null },
      donorUserId: { type: 'uuid', nullable: true, example: null },
      nextExecutionAt: { type: 'timestamp', nullable: true, example: '2026-02-01T00:00:00.000Z' },
      createdAt: { type: 'timestamp', example: '2026-01-01T00:00:00.000Z' },
      updatedAt: { type: 'timestamp', example: '2026-01-01T00:00:00.000Z' },
    },
    required: ['id', 'amount', 'asset', 'payerAddress', 'recipientId', 'frequency', 'status', 'memo', 'createdAt', 'updatedAt'],
  },
);

export const CreateDonationIntentInteraction = createInteraction(
  'Create donation intent',
  'Client',
  'DonationService',
  {
    method: 'POST',
    path: '/donations/intent',
    headers: { 'Content-Type': 'application/json' },
    body: {
      amount: 100.0,
      payerAddress: 'GABC...XYZ',
      recipientId: 'hospital-001',
      asset: 'XLM',
    },
  },
  {
    status: 201,
    body: DonationEntityFixture.example,
  },
);

export const ConfirmDonationInteraction = createInteraction(
  'Confirm donation with transaction hash',
  'Client',
  'DonationService',
  {
    method: 'PATCH',
    path: '/donations/00000000-0000-0000-0000-000000000001/confirm',
    headers: { 'Content-Type': 'application/json' },
    body: { transactionHash: 'abc123txhash' },
  },
  {
    status: 200,
    body: { ...DonationEntityFixture.example, status: 'COMPLETED', transactionHash: 'abc123txhash' },
  },
);

export const DonationContract = createServiceContract(
  'Donation',
  DONATION_SCHEMA_VERSION,
  [CreateDonationIntentInteraction, ConfirmDonationInteraction],
);
