# Testnet Identity Setup

Before running `deploy-testnet.sh` you need a Stellar CLI identity that is
funded on the Stellar testnet.  The helper script `setup-identity.sh` handles
this automatically.

## One-Command Setup

```bash
cd lifebank-soroban
./scripts/setup-identity.sh
```

This creates a keypair named `default` (or whatever `$STELLAR_IDENTITY` is
set to) and funds it via Friendbot.  It is safe to run multiple times — if the
identity already exists the generate step is a no-op.

## Custom Identity Name

```bash
STELLAR_IDENTITY=alice ./scripts/setup-identity.sh
STELLAR_IDENTITY=alice ./scripts/deploy-testnet.sh
```

## Manual Steps (if you prefer)

```bash
# 1. Generate a keypair
stellar keys generate --network testnet default

# 2. Fund via Friendbot
stellar keys fund default --network testnet

# 3. Verify the account exists
stellar account show --network testnet "$(stellar keys address default)"
```

## CI / GitHub Actions Setup

In CI there is no pre-existing `default` identity.  Add the following to your
workflow:

```yaml
env:
  STELLAR_IDENTITY: ${{ secrets.STELLAR_IDENTITY }}

steps:
  - name: Setup Stellar identity
    run: |
      echo "${{ secrets.STELLAR_SECRET_KEY }}" | stellar keys add "$STELLAR_IDENTITY" --secret-key
      stellar keys fund "$STELLAR_IDENTITY" --network testnet
  - name: Deploy contracts
    run: cd lifebank-soroban && ./scripts/deploy-testnet.sh
```

Required GitHub Actions secrets:

| Secret | Value |
|--------|-------|
| `STELLAR_IDENTITY` | Name to use for the Stellar CLI identity (e.g. `ci-deploy`) |
| `STELLAR_SECRET_KEY` | The raw `S…` secret key for the funded account |

> **Never commit secret keys.**  Use GitHub Secrets or a secrets manager.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `identity 'default' not found` | Keypair not generated yet | Run `setup-identity.sh` |
| `account not found` | Account not funded | Run `stellar keys fund default --network testnet` |
| `insufficient funds` | Friendbot allocation spent | Request additional XLM from [laboratory.stellar.org](https://laboratory.stellar.org) |
