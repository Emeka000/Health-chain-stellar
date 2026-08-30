/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  /**
   * Allow Jest to resolve modules relative to the `src` directory so that
   * cross-module imports like `../../donations/entities/donation.entity`
   * from inside `src/reconciliation/` resolve correctly even though rootDir
   * is set to `src`.
   */
  modulePaths: ['<rootDir>'],
  /**
   * Stub out the generated @healthchain/* SDK packages.
   * These packages live under packages/ in the monorepo but their dist/ folders
   * are not built during test runs (requires a full contract-bindings generation
   * step). Each stub exports enough shape for the consuming services to
   * instantiate without actually connecting to Soroban.
   */
  moduleNameMapper: {
    '^@healthchain/inventory-sdk$':
      '<rootDir>/__mocks__/@healthchain/inventory-sdk.ts',
    '^@healthchain/coordinator-sdk$':
      '<rootDir>/__mocks__/@healthchain/coordinator-sdk.ts',
    '^@healthchain/payments-sdk$':
      '<rootDir>/__mocks__/@healthchain/payments-sdk.ts',
    '^@healthchain/requests-sdk$':
      '<rootDir>/__mocks__/@healthchain/requests-sdk.ts',
    '^@healthchain/temperature-sdk$':
      '<rootDir>/__mocks__/@healthchain/temperature-sdk.ts',
  },
};
