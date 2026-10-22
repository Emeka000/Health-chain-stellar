import { OrgTrustScoringService } from './org-trust-scoring.service';

function makeOrg(overrides: Partial<object> = {}) {
  return {
    id: 'org-1',
    rating: 4.5,
    status: 'approved',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    ...overrides,
  };
}

function makeReviews(ratings: number[]) {
  return ratings.map((rating, i) => ({
    id: `rev-${i}`,
    organizationId: 'org-1',
    reviewerId: `user-${i}`,
    rating,
    isHidden: false,
    createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
  }));
}

function makeService(org: object | null, reviews: object[] = []) {
  const scoreRepo = {
    create: jest.fn((d) => ({ ...d })),
    save: jest.fn(async (r) => ({ id: 'score-1', ...r })),
    findOne: jest.fn(async () => null),
  };
  const historyRepo = {
    create: jest.fn((d) => ({ ...d })),
    save: jest.fn(async (r) => r),
    find: jest.fn(async () => []),
  };
  const orgRepo = { findOne: jest.fn(async () => org) };
  const reviewRepo = { find: jest.fn(async () => reviews) };

  return new OrgTrustScoringService(
    scoreRepo as any,
    historyRepo as any,
    orgRepo as any,
    reviewRepo as any,
  );
}

describe('OrgTrustScoringService — issue #623', () => {
  it('computes a score and stores explanation with per-factor contributions', async () => {
    const svc = makeService(makeOrg(), makeReviews([4, 5, 4, 3, 5]));
    const result = await svc.computeAndStore('org-1');
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.explanation).toHaveLength(5); // 5 factors
    expect(result.explanation!.every((f) => f.weight > 0)).toBe(true);
    expect(result.featureSnapshot).toBeDefined();
  });

  it('score is reproducible from stored feature snapshot', async () => {
    const svc = makeService(makeOrg(), makeReviews([4, 5, 4, 3, 5]));
    const result = await svc.computeAndStore('org-1');
    const replayed = svc.replayFromSnapshot(result.featureSnapshot!);
    expect(Math.abs(replayed.score - result.score)).toBeLessThan(0.0001);
  });

  it('flags suspicious rating ring (all same rating)', async () => {
    const svc = makeService(makeOrg(), makeReviews([5, 5, 5, 5, 5]));
    const result = await svc.computeAndStore('org-1');
    expect(result.suspiciousRatingFlag).toBe(true);
  });

  it('does not flag diverse ratings', async () => {
    const svc = makeService(makeOrg(), makeReviews([1, 3, 5, 2, 4]));
    const result = await svc.computeAndStore('org-1');
    expect(result.suspiciousRatingFlag).toBe(false);
  });

  it('downranks suspicious rating ring via anti-gaming multiplier', async () => {
    const svcClean = makeService(makeOrg(), makeReviews([1, 3, 5, 2, 4]));
    const svcRing = makeService(makeOrg(), makeReviews([5, 5, 5, 5, 5]));
    const clean = await svcClean.computeAndStore('org-1');
    const ring = await svcRing.computeAndStore('org-1');
    // Ring should score lower due to anti-gaming multiplier on rating factor
    expect(ring.score).toBeLessThanOrEqual(clean.score);
  });

  it('throws NotFoundException for unknown organization', async () => {
    const svc = makeService(null);
    await expect(svc.computeAndStore('unknown')).rejects.toThrow('not found');
  });

  it('explanation factor contributions sum to approximately the total score', async () => {
    const svc = makeService(makeOrg(), makeReviews([4, 5, 3]));
    const result = await svc.computeAndStore('org-1');
    const sumContributions = result.explanation!.reduce((s, f) => s + f.contribution, 0);
    expect(Math.abs(sumContributions - result.score)).toBeLessThan(0.01);
  });
});
