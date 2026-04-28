/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

import * as SorobanRpc from '@stellar/stellar-sdk/rpc';

import { SorobanService } from '../soroban.service';
import { BlockchainEvent } from '../entities/blockchain-event.entity';
import { REDIS_CLIENT } from '../../redis/redis.constants';

// ─── helpers ─────────────────────────────────────────────────────────────────

const ORG_ID = 'GORGID000000000000000000000000000000000000000000000000000';

/** Build a minimal mock Redis client */
const makeRedis = (store: Map<string, string> = new Map()) => ({
  get: jest.fn(async (key: string) => store.get(key) ?? null),
  setex: jest.fn(async (key: string, _ttl: number, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
  del: jest.fn(async (key: string) => {
    store.delete(key);
    return 1;
  }),
});

/** Build a mock Soroban RPC server */
const makeServer = () => ({
  getAccount: jest.fn(),
  simulateTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  getTransaction: jest.fn(),
});

/** Build a mock Keypair */
const makeKeypair = () => ({
  publicKey: jest.fn().mockReturnValue('GPUBLICKEY000000000000000000000000000000000000000000000000'),
  xdrPublicKey: jest.fn().mockReturnValue({}),
});

/** Build a mock Contract */
const makeContract = () => ({
  contractId: jest.fn().mockReturnValue('CONTRACT_ID'),
  call: jest.fn().mockReturnValue({ type: 'invokeHostFunction' }),
});

/** Successful simulation returning a bool ScVal */
const makeSuccessSimulation = (retval: unknown) => ({
  result: { retval },
  error: undefined,
});

/** Failed simulation (contract error) */
const makeFailedSimulation = () => ({
  result: undefined,
  error: 'HostError: contract not found',
});

async function buildService(
  overrides: {
    server?: ReturnType<typeof makeServer>;
    contract?: ReturnType<typeof makeContract> | null;
    redis?: ReturnType<typeof makeRedis>;
  } = {},
): Promise<SorobanService> {
  const redis = overrides.redis ?? makeRedis();
  const configService = {
    get: jest.fn((key: string, def?: unknown) => {
      const map: Record<string, unknown> = {
        SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
        SOROBAN_CONTRACT_ID: overrides.contract !== null ? 'CONTRACT_ID' : undefined,
        SOROBAN_SECRET_KEY: 'SCZANGBA5YELHNLNPQB7OPPDPVMCOIGGM5XSIMLMALPKGZQKFNKJNZMR',
        SOROBAN_NETWORK: 'testnet',
      };
      return map[key] ?? def;
    }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SorobanService,
      { provide: ConfigService, useValue: configService },
      { provide: REDIS_CLIENT, useValue: redis },
      {
        provide: getRepositoryToken(BlockchainEvent),
        useValue: { create: jest.fn(), save: jest.fn() },
      },
    ],
  }).compile();

  const svc = module.get(SorobanService);

  // Inject mocked internals directly (bypasses onModuleInit network calls)
  if (overrides.server) {
    (svc as any).server = overrides.server;
  }
  if (overrides.contract !== undefined) {
    (svc as any).contract = overrides.contract ?? undefined;
  }
  (svc as any).sourceKeypair = makeKeypair();
  (svc as any).networkPassphrase = 'Test SDF Network ; September 2015';

  return svc;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('SorobanService.getOrganizationVerificationStatus', () => {
  describe('positive – verified org', () => {
    it('returns verified=true with metadata from contract', async () => {
      const retval = {
        _switch: { name: 'scvMap' },
        _value: [
          { key: { _switch: { name: 'scvSymbol' }, _value: Buffer.from('verified') }, val: { _switch: { name: 'scvBool' }, _value: true } },
          { key: { _switch: { name: 'scvSymbol' }, _value: Buffer.from('verified_at') }, val: { _switch: { name: 'scvU64' }, _value: { toString: () => '1700000000' } } },
        ],
      };

      const server = makeServer();
      server.getAccount.mockResolvedValue({ accountId: () => 'GPUB', sequenceNumber: () => '1', incrementSequenceNumber: jest.fn() });
      server.simulateTransaction.mockResolvedValue(makeSuccessSimulation(retval));

      // Patch isSimulationSuccess to return true for our mock
      jest.spyOn(SorobanRpc.Api, 'isSimulationSuccess').mockReturnValue(true);

      const svc = await buildService({ server });
      const result = await svc.getOrganizationVerificationStatus(ORG_ID);

      expect(result).not.toBeNull();
      expect(result!.verified).toBe(true);
      expect(result!.orgId).toBe(ORG_ID);
    });

    it('caches the result and does not call RPC on second request', async () => {
      const store = new Map<string, string>();
      const redis = makeRedis(store);
      const server = makeServer();
      server.getAccount.mockResolvedValue({ accountId: () => 'GPUB', sequenceNumber: () => '1', incrementSequenceNumber: jest.fn() });
      server.simulateTransaction.mockResolvedValue(makeSuccessSimulation({
        _switch: { name: 'scvBool' }, _value: true,
      }));
      jest.spyOn(SorobanRpc.Api, 'isSimulationSuccess').mockReturnValue(true);

      const svc = await buildService({ server, redis });
      await svc.getOrganizationVerificationStatus(ORG_ID);
      await svc.getOrganizationVerificationStatus(ORG_ID);

      // RPC should only be called once
      expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
      expect(redis.setex).toHaveBeenCalledTimes(1);
    });

    it('invalidateOrgVerificationCache removes the cached entry', async () => {
      const store = new Map<string, string>();
      const redis = makeRedis(store);
      const server = makeServer();
      server.getAccount.mockResolvedValue({ accountId: () => 'GPUB', sequenceNumber: () => '1', incrementSequenceNumber: jest.fn() });
      server.simulateTransaction.mockResolvedValue(makeSuccessSimulation({
        _switch: { name: 'scvBool' }, _value: true,
      }));
      jest.spyOn(SorobanRpc.Api, 'isSimulationSuccess').mockReturnValue(true);

      const svc = await buildService({ server, redis });
      await svc.getOrganizationVerificationStatus(ORG_ID);
      await svc.invalidateOrgVerificationCache(ORG_ID);

      expect(redis.del).toHaveBeenCalledWith(`org:verification:${ORG_ID}`);
      expect(store.has(`org:verification:${ORG_ID}`)).toBe(false);
    });
  });

  describe('negative – unverified / not found', () => {
    it('returns null when simulation fails (contract not found)', async () => {
      const server = makeServer();
      server.getAccount.mockResolvedValue({ accountId: () => 'GPUB', sequenceNumber: () => '1', incrementSequenceNumber: jest.fn() });
      server.simulateTransaction.mockResolvedValue(makeFailedSimulation());
      jest.spyOn(SorobanRpc.Api, 'isSimulationSuccess').mockReturnValue(false);

      const svc = await buildService({ server });
      const result = await svc.getOrganizationVerificationStatus(ORG_ID);

      expect(result).toBeNull();
    });

    it('returns null when no contract is configured', async () => {
      const svc = await buildService({ contract: null });
      const result = await svc.getOrganizationVerificationStatus(ORG_ID);
      expect(result).toBeNull();
    });
  });

  describe('chain unavailable', () => {
    it('throws when getAccount fails (RPC unavailable)', async () => {
      const server = makeServer();
      server.getAccount.mockRejectedValue(new Error('ECONNREFUSED'));

      const svc = await buildService({ server });

      await expect(svc.getOrganizationVerificationStatus(ORG_ID)).rejects.toThrow(
        /RPC unavailable/,
      );
    });

    it('throws when simulateTransaction times out', async () => {
      const server = makeServer();
      server.getAccount.mockResolvedValue({ accountId: () => 'GPUB', sequenceNumber: () => '1', incrementSequenceNumber: jest.fn() });
      server.simulateTransaction.mockRejectedValue(new Error('Request timeout'));

      const svc = await buildService({ server });

      await expect(svc.getOrganizationVerificationStatus(ORG_ID)).rejects.toThrow(
        /timeout or network error/,
      );
    });
  });
});
