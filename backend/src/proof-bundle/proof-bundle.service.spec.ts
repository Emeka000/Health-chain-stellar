import * as crypto from 'crypto';
import { ProofBundleService } from './proof-bundle.service';
import { ProofBundleStatus } from './entities/proof-bundle.entity';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const VALID_HASH = sha256('artifact');
const PHOTO_HASH = sha256('photo');
const MEDICAL_HASH = sha256('medical');

const mockProof = {
  id: 'proof-1',
  orderId: 'order-1',
  riderId: 'rider-1',
  deliveredAt: new Date('2026-01-01'),
  recipientName: 'Alice',
  verified: true,
  isTemperatureCompliant: true,
  recipientSignatureHash: VALID_HASH,
  photoHashes: [PHOTO_HASH],
};

function makeService(savedBundle?: Partial<object>) {
  const bundleRepo = {
    create: jest.fn((data) => ({ ...data })),
    save: jest.fn(async (b) => ({ id: 'bundle-1', ...b })),
    findOne: jest.fn(async () => savedBundle ?? null),
  };
  const deliveryProofService = {
    getDeliveryProof: jest.fn(async () => mockProof),
  };
  return new ProofBundleService(bundleRepo as any, deliveryProofService as any);
}

describe('ProofBundleService — issue #620', () => {
  const baseDto = {
    paymentId: 'pay-1',
    deliveryProofId: 'proof-1',
    signatureHash: VALID_HASH,
    photoHash: PHOTO_HASH,
    medicalHash: MEDICAL_HASH,
    submittedBy: 'user-1',
    verifierIdentity: 'verifier-1',
  };

  it('validates a correct bundle and produces a manifest root digest', async () => {
    const svc = makeService();
    const result = await svc.validateAndAttach(baseDto);
    expect(result.valid).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.bundle.manifestRootDigest).toHaveLength(64);
    expect(result.bundle.manifest).toHaveLength(4); // signature, photo, medical, delivery
    expect(result.bundle.verifierIdentity).toBe('verifier-1');
  });

  it('rejects a bundle with a mismatched signature hash', async () => {
    const svc = makeService();
    const result = await svc.validateAndAttach({ ...baseDto, signatureHash: sha256('wrong') });
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('Signature hash'))).toBe(true);
    expect(result.bundle.status).toBe(ProofBundleStatus.REJECTED);
  });

  it('rejects a bundle with a mismatched photo hash', async () => {
    const svc = makeService();
    const result = await svc.validateAndAttach({ ...baseDto, photoHash: sha256('wrong-photo') });
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('Photo hash'))).toBe(true);
  });

  it('rejects a bundle with explicit artifacts having non-contiguous seq numbers', async () => {
    const svc = makeService();
    const result = await svc.validateAndAttach({
      ...baseDto,
      artifacts: [
        { type: 'signature', digest: VALID_HASH, seq: 0 },
        { type: 'photo', digest: PHOTO_HASH, seq: 2 }, // gap!
        { type: 'medical', digest: MEDICAL_HASH, seq: 3 },
        { type: 'delivery', digest: sha256('delivery'), seq: 4 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('contiguous'))).toBe(true);
  });

  it('verifyBundle detects tampered manifest root digest', async () => {
    const svc = makeService({
      id: 'bundle-1',
      status: ProofBundleStatus.VALIDATED,
      manifest: [{ type: 'signature', digest: VALID_HASH, seq: 0 }],
      manifestRootDigest: 'tampered000000000000000000000000000000000000000000000000000000000',
    });
    const result = await svc.verifyBundle('bundle-1');
    expect(result.intact).toBe(false);
  });

  it('verifyBundle confirms intact bundle', async () => {
    // Build a real bundle first to get the correct root digest
    const svc = makeService();
    const { bundle } = await svc.validateAndAttach(baseDto);

    // Now mock findOne to return that bundle
    const svc2 = makeService(bundle);
    const result = await svc2.verifyBundle('bundle-1');
    expect(result.intact).toBe(true);
  });
});
