# Contributing to HealthDonor Protocol

Thank you for your interest in contributing to HealthDonor Protocol! This guide covers everything you need to get started.

## Getting Started

### System Dependencies

Install these tools before running the project locally:

| Dependency | Version | Purpose |
|---|---|---|
| **Node.js** | >= 18.x | Backend and frontend runtime |
| **npm** | >= 9.x | Package manager |
| **Docker** + **Docker Compose** | latest | PostgreSQL and Redis |
| **Rust** + **Cargo** | stable (via [rustup](https://rustup.rs)) | Soroban smart contracts |
| **Stellar CLI** (`stellar`) | >= 21.x | Deploy and invoke Soroban contracts |
| **wasm32-unknown-unknown** target | — | Cross-compile Rust contracts to WASM |

Install the Rust WASM target after installing Rust:

```bash
rustup target add wasm32-unknown-unknown
```

Install the Stellar CLI:

```bash
cargo install --locked stellar-cli
```

### Expected Service Ports

| Service | Port |
|---|---|
| Next.js frontend | `:3000` |
| NestJS backend | `:3001` |
| PostgreSQL | `:5432` |
| Redis | `:6379` |

### Local Development Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Emeka000/Health-chain-stellar.git
   cd Health-chain-stellar
   ```

2. **Start infrastructure services (PostgreSQL + Redis):**

   ```bash
   docker-compose up -d
   ```

   Verify the containers are running:

   ```bash
   docker-compose ps
   ```

3. **Set up the backend:**

   ```bash
   cd backend
   cp .env.example .env
   ```

   Open `backend/.env` and configure at minimum:

   ```env
   DATABASE_NAME=health_chain
   DATABASE_USERNAME=postgres
   DATABASE_PASSWORD=         # match your docker-compose config
   JWT_SECRET=change-me-in-dev
   JWT_REFRESH_SECRET=change-me-in-dev
   ```

   Then install dependencies and run database migrations:

   ```bash
   npm install
   npm run migration:run
   npm run start:dev          # starts on http://localhost:3001
   ```

   The Swagger UI is available at `http://localhost:3001/docs` once the server is running.

4. **Set up the frontend:**

   ```bash
   cd frontend/health-chain
   npm install
   npm run dev                # starts on http://localhost:3000
   ```

5. **Build and deploy smart contracts to testnet (optional):**

   ```bash
   # Build the legacy registry contract (contracts/)
   cd contracts
   cargo build --target wasm32-unknown-unknown --release

   # Build the lifebank-soroban suite (ten deployed contracts)
   cd ../lifebank-soroban
   bash scripts/build-all.sh

   # Set up a Stellar identity for deployment
   bash scripts/setup-identity.sh

   # Deploy all contracts to testnet
   bash scripts/deploy-testnet.sh
   ```

   After deployment, copy the printed contract IDs into `backend/.env` under the `*_CONTRACT_ID` variables.

## Project Structure

```
Health-chain-stellar/
├── backend/           # NestJS API server
│   ├── src/           # Source code (modules, services, controllers)
│   ├── test/          # E2E and integration tests
│   ├── docs/          # Backend documentation
│   └── .env.example   # Environment variable template
├── frontend/          # Frontend application
│   ├── src/           # Source code
│   └── health-chain/  # Health chain UI components
├── contracts/         # Soroban smart contracts (Rust)
│   └── src/           # Contract source code
├── scripts/           # Utility scripts
├── docs/              # Project documentation
└── docker-compose.yml # Postgres + Redis setup
```

## Running Tests

### Backend Unit Tests

```bash
cd backend
npm run test           # Run all unit tests
npm run test:watch     # Watch mode
npm run test:cov       # With coverage report
```

### Backend E2E Tests

```bash
cd backend
npm run test:e2e
```

### Lifebank Soroban Contract Tests

The ten deployed contracts live in `lifebank-soroban/` (not `contracts/`). Run their test suite:

```bash
cd lifebank-soroban
cargo test --workspace
```

The legacy `contracts/` crate contains the old healthchain registry contract. To test it:

```bash
cd contracts
cargo test
```

### Frontend Type Checking

Type checking requires the correct working directory. The app lives in `frontend/health-chain/`:

```bash
cd frontend/health-chain
npx tsc --noEmit
```

## Opening a Pull Request

### Branch Naming

Use descriptive branch names with prefixes:

- `feat/` — New features (e.g., `feat/blood-unit-search`)
- `fix/` — Bug fixes (e.g., `fix/donation-escrow-timing`)
- `docs/` — Documentation (e.g., `docs/api-endpoint-reference`)
- `chore/` — Maintenance tasks (e.g., `chore/update-dependencies`)
- `refactor/` — Code restructuring
- `test/` — Adding or updating tests

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

Optional longer description explaining the change.
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`

**Examples:**
```
feat(donation): add time-locked fund release
fix(contract): prevent reentrancy in escrow withdrawal
docs: add API endpoint documentation
```

### PR Checklist

Before opening a PR, ensure:

- [ ] Tests pass:
  - Backend: `cd backend && npm run test`
  - Lifebank contracts: `cd lifebank-soroban && cargo test --workspace`
  - Legacy contracts: `cd contracts && cargo test` (if modified)
- [ ] Linting passes (check-only, no rewrites):
  - Backend: `cd backend && npm run lint:check`
  - Contracts: `cd lifebank-soroban && cargo clippy --all-targets --all-features`
- [ ] Frontend type checking: `cd frontend/health-chain && npx tsc --noEmit`
- [ ] New features have accompanying tests
- [ ] Database schema changes include migration files (see [Writing a Migration](backend/MIGRATION_POLICY.md#writing-a-migration))
- [ ] Commit messages follow the conventional format
- [ ] PR description explains what changed and why

### PR Review Process

1. Open a PR against the `main` branch.
2. Fill in the PR template with a clear description.
3. Reference related issues (e.g., `Closes #42`).
4. Wait for CI checks to pass.
5. Address review feedback promptly.
6. A maintainer will merge once approved.

## Code Style

### Backend (TypeScript/NestJS)

- Follow the ESLint configuration in `backend/eslint.config.mjs`.
- Use Prettier for formatting (config in `backend/.prettierrc`).
- Check linting (without modifying files):
  ```bash
  cd backend && npm run lint:check
  ```
- Auto-fix linting issues:
  ```bash
  cd backend && npm run lint
  ```
- Follow NestJS conventions: modules, services, controllers, DTOs.

### Frontend (TypeScript/React)

- Use TypeScript strict mode.
- Follow existing component patterns.
- Type check:
  ```bash
  cd frontend/health-chain && npx tsc --noEmit
  ```

### Contracts (Rust/Soroban)

- Lifebank contracts (recommended):
  ```bash
  cd lifebank-soroban && cargo clippy --all-targets --all-features
  ```
- Legacy contracts:
  ```bash
  cd contracts && cargo clippy
  ```
- Ensure no compiler warnings.

## Reporting Security Issues

Given the medical domain of this project, security is critical. **Do not open public issues for security vulnerabilities.**

Instead, please refer to our [Security Policy](SECURITY.md) and use the
[private vulnerability reporting form](https://github.com/Emeka000/Health-chain-stellar/security/advisories/new)
for responsible disclosure instructions.

## Finding Good First Issues

Look for issues labeled with:
- [`good first issue`](https://github.com/Emeka000/Health-chain-stellar/labels/good%20first%20issue) — Beginner-friendly tasks
- [`help wanted`](https://github.com/Emeka000/Health-chain-stellar/labels/help%20wanted) — Tasks where we need community help

## Code of Conduct

Please be respectful and constructive in all interactions. We are building a welcoming community for contributors of all backgrounds and experience levels.

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

## Questions?

If you have questions about contributing:
- Open a [GitHub Issue](https://github.com/Emeka000/Health-chain-stellar/issues) for bugs or feature requests
- Check existing documentation in `docs/` and `backend/docs/`

Thank you for contributing to HealthDonor Protocol!
