module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
    './src/auth/**/*.ts': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './src/blockchain/**/*.ts': {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75,
    },
    './src/inventory/**/*.ts': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
