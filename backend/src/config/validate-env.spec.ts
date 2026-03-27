import 'reflect-metadata';
import { validateEnv } from './validate-env';

/** Minimal valid config satisfying all required fields */
const validConfig = {
  DATABASE_NAME: 'healthchain',
  JWT_SECRET: 'super-secret-key-that-is-long-enough',
  JWT_REFRESH_SECRET: 'another-secret-key-that-is-long-enough',
  MAPS_API_KEY: 'maps-key-123',
  SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  SOROBAN_CONTRACT_ID: 'CONTRACT123',
  SOROBAN_SECRET_KEY: 'STELLAR_SECRET',
  AT_API_KEY: 'at-key-123',
  FIREBASE_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}',
};

describe('validateEnv', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('valid configuration', () => {
    it('returns a typed config object when all required vars are present', () => {
      const result = validateEnv({ ...validConfig });

      expect(result.DATABASE_NAME).toBe('healthchain');
      expect(result.JWT_SECRET).toBe('super-secret-key-that-is-long-enough');
      expect(result.PORT).toBe(3000); // default
      expect(result.NODE_ENV).toBe('development'); // default
      expect(result.REDIS_HOST).toBe('localhost'); // default
    });

    it('coerces PORT string to number', () => {
      const result = validateEnv({ ...validConfig, PORT: '4000' });
      expect(result.PORT).toBe(4000);
      expect(typeof result.PORT).toBe('number');
    });

    it('coerces TRUST_PROXY string "true" to boolean true', () => {
      const result = validateEnv({ ...validConfig, TRUST_PROXY: 'true' });
      expect(result.TRUST_PROXY).toBe(true);
    });

    it('applies default values for optional fields', () => {
      const result = validateEnv({ ...validConfig });
      expect(result.SMTP_FROM).toBe('noreply@example.com');
      expect(result.INVENTORY_FORECAST_THRESHOLD_DAYS).toBe(3);
      expect(result.SOROBAN_NETWORK).toBe('testnet');
    });

    it('accepts all valid NODE_ENV values', () => {
      for (const env of ['development', 'staging', 'production', 'test']) {
        expect(() =>
          validateEnv({ ...validConfig, NODE_ENV: env }),
        ).not.toThrow();
      }
    });
  });

  describe('missing required variables', () => {
    it('throws when DATABASE_NAME is missing', () => {
      const { DATABASE_NAME: _, ...rest } = validConfig;
      expect(() => validateEnv(rest)).toThrow();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('DATABASE_NAME'),
      );
    });

    it('throws when JWT_SECRET is missing', () => {
      const { JWT_SECRET: _, ...rest } = validConfig;
      expect(() => validateEnv(rest)).toThrow();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('JWT_SECRET'),
      );
    });

    it('throws when JWT_REFRESH_SECRET is missing', () => {
      const { JWT_REFRESH_SECRET: _, ...rest } = validConfig;
      expect(() => validateEnv(rest)).toThrow();
    });

    it('throws when MAPS_API_KEY is missing', () => {
      const { MAPS_API_KEY: _, ...rest } = validConfig;
      expect(() => validateEnv(rest)).toThrow();
    });

    it('throws when SOROBAN_RPC_URL is missing', () => {
      const { SOROBAN_RPC_URL: _, ...rest } = validConfig;
      expect(() => validateEnv(rest)).toThrow();
    });

    it('throws when AT_API_KEY is missing', () => {
      const { AT_API_KEY: _, ...rest } = validConfig;
      expect(() => validateEnv(rest)).toThrow();
    });

    it('throws when FIREBASE_SERVICE_ACCOUNT_JSON is missing', () => {
      const { FIREBASE_SERVICE_ACCOUNT_JSON: _, ...rest } = validConfig;
      expect(() => validateEnv(rest)).toThrow();
    });

    it('reports all missing fields in a single error report', () => {
      const {
        DATABASE_NAME: _a,
        JWT_SECRET: _b,
        MAPS_API_KEY: _c,
        ...rest
      } = validConfig;
      expect(() => validateEnv(rest)).toThrow();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('DATABASE_NAME');
      expect(output).toContain('JWT_SECRET');
      expect(output).toContain('MAPS_API_KEY');
    });
  });

  describe('invalid formats and types', () => {
    it('throws when PORT is not a number', () => {
      expect(() =>
        validateEnv({ ...validConfig, PORT: 'not-a-port' }),
      ).toThrow();
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('PORT'));
    });

    it('throws when PORT is out of range', () => {
      expect(() => validateEnv({ ...validConfig, PORT: '99999' })).toThrow();
    });

    it('throws when NODE_ENV is an invalid value', () => {
      expect(() =>
        validateEnv({ ...validConfig, NODE_ENV: 'local' }),
      ).toThrow();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('NODE_ENV'),
      );
    });

    it('throws when SOROBAN_RPC_URL is not a valid URL', () => {
      expect(() =>
        validateEnv({ ...validConfig, SOROBAN_RPC_URL: 'not-a-url' }),
      ).toThrow();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('SOROBAN_RPC_URL'),
      );
    });

    it('throws when JWT_SECRET is the default placeholder', () => {
      expect(() =>
        validateEnv({
          ...validConfig,
          JWT_SECRET: 'your-super-secret-jwt-key-change-in-production',
        }),
      ).toThrow();
    });

    it('throws when JWT_SECRET is too short', () => {
      expect(() =>
        validateEnv({ ...validConfig, JWT_SECRET: 'short' }),
      ).toThrow();
    });

    it('throws when SOROBAN_NETWORK is an invalid value', () => {
      expect(() =>
        validateEnv({ ...validConfig, SOROBAN_NETWORK: 'devnet' }),
      ).toThrow();
    });

    it('throws when DATABASE_PORT is out of range', () => {
      expect(() =>
        validateEnv({ ...validConfig, DATABASE_PORT: '0' }),
      ).toThrow();
    });
  });

  describe('error report format', () => {
    it('writes a structured report to stderr on failure', () => {
      const { DATABASE_NAME: _, ...rest } = validConfig;
      expect(() => validateEnv(rest)).toThrow();

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('ENVIRONMENT VARIABLE VALIDATION FAILED');
      expect(output).toContain('.env.example');
      expect(output).toContain('✗');
    });

    it('includes error count in the report', () => {
      const { DATABASE_NAME: _a, JWT_SECRET: _b, ...rest } = validConfig;
      expect(() => validateEnv(rest)).toThrow();

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/\d+ error\(s\) found/);
    });
  });
});
