# Stellar Passkeys / WebAuthn Integration Guide

## Issue #854: Add Passkey Support for Hospital and Blood Bank Authentication

### Overview

This document describes how hospitals and blood banks can authenticate with the Lifebank Soroban contracts using **Stellar Passkeys (WebAuthn)** instead of managing raw private keys. This significantly improves UX and security for healthcare workers.

### Background

The contracts currently use `require_auth()` which accepts any Stellar address, including:
- Standard keypair addresses (GABC...)
- **Smart wallet contract addresses** (which can use passkeys as signers)

Stellar's Smart Wallets protocol allows users to authenticate with biometrics (Touch ID, Face ID, Windows Hello) via the WebAuthn standard.

### Implementation Status

✅ **Contracts already support smart wallets** - No contract changes needed!  
The `require_auth()` calls in `inventory`, `payments`, and other contracts natively accept smart wallet addresses.

### Integration Steps for Frontend

#### 1. Install Stellar Wallets Kit

```bash
npm install @creit.tech/stellar-wallets-kit
```

#### 2. Initialize with Passkey Support

```typescript
import { StellarWalletsKit, WalletNetwork, PASSKEY_ID } from '@creit.tech/stellar-wallets-kit';

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET, // or MAINNET
  selectedWalletId: PASSKEY_ID,
  modules: [
    // Add passkey module
    import('@creit.tech/stellar-wallets-kit').then(m => m.PasskeyKit)
  ]
});
```

#### 3. Create Passkey Wallet for Hospital Staff

```typescript
async function createPasskeyWallet() {
  await kit.openModal({
    onWalletSelected: async (option) => {
      // User creates passkey (biometric prompt)
      const { address } = await kit.getAddress();
      
      // This address is a smart wallet contract address
      // Store it as the hospital's authentication address
      console.log('Smart wallet address:', address);
      
      return address;
    }
  });
}
```

#### 4. Sign Transactions with Passkey

```typescript
import { TransactionBuilder, Operation } from '@stellar/stellar-sdk';

async function registerBloodUnit(serialNumber: string, bloodType: string, quantityMl: number) {
  const hospitalAddress = await kit.getAddress();
  
  // Build transaction calling the inventory contract
  const tx = new TransactionBuilder(account, { fee: '1000' })
    .addOperation(Operation.invokeContractFunction({
      contract: INVENTORY_CONTRACT_ID,
      function: 'register_blood',
      args: [
        nativeToScVal(hospitalAddress, { type: 'address' }),
        nativeToScVal(serialNumber, { type: 'string' }),
        nativeToScVal(bloodType, { type: 'symbol' }),
        nativeToScVal(quantityMl, { type: 'u32' }),
        nativeToScVal(null, { type: 'option' })
      ]
    }))
    .setTimeout(300)
    .build();
  
  // Sign with passkey (biometric prompt)
  const signedTx = await kit.sign({ xdr: tx.toXDR() });
  
  // Submit to network
  const result = await server.sendTransaction(signedTx);
  return result;
}
```

### Smart Wallet Address Format

Smart wallet addresses look like standard Stellar addresses:
```
GCABCDEF123456789ABCDEF123456789ABCDEF123456789ABCDEF1234
```

The difference is that they point to a deployed smart wallet contract that uses WebAuthn signatures instead of Ed25519 keypairs.

### Authorization Flow

1. **Hospital staff** creates a passkey wallet (one-time setup)
2. **Admin** authorizes the smart wallet address as a blood bank:
   ```rust
   inventory_contract.authorize_bank(admin, smart_wallet_address, true)
   ```
3. **Hospital staff** can now call contract functions using biometric authentication
4. The smart wallet contract verifies the WebAuthn signature and forwards the call

### Security Benefits

✅ **No seed phrases** - Healthcare workers don't manage private keys  
✅ **Biometric authentication** - Touch ID, Face ID, or security keys  
✅ **Device-bound** - Passkeys are tied to the user's device  
✅ **Phishing-resistant** - WebAuthn prevents credential theft  
✅ **Audit trail** - All actions still recorded on-chain with the smart wallet address

### Testing on Testnet

1. Deploy a smart wallet contract using Stellar's example:
   https://github.com/stellar/soroban-examples/tree/main/smart-wallet

2. Register the smart wallet address with the inventory contract:
   ```bash
   soroban contract invoke \
     --id $INVENTORY_CONTRACT \
     --source $ADMIN_SECRET \
     -- authorize_bank \
     --admin $ADMIN_ADDRESS \
     --bank $SMART_WALLET_ADDRESS \
     --authorized true
   ```

3. Use the Stellar Wallets Kit in your frontend to sign transactions

### References

- **Stellar Passkeys Documentation**: https://developers.stellar.org/docs/smart-contract-encyclopedia/passkeys
- **Smart Wallet Example**: https://github.com/stellar/soroban-examples/tree/main/smart-wallet
- **Stellar Wallets Kit**: https://www.npmjs.com/package/@creit.tech/stellar-wallets-kit
- **WebAuthn Standard**: https://webauthn.io/

### Next Steps

1. ✅ Document smart wallet support (this file)
2. 🔲 Create example frontend code in `frontend/` directory
3. 🔲 Add passkey setup flow to hospital onboarding
4. 🔲 Update deployment scripts to support smart wallet addresses
5. 🔲 Add smart wallet integration tests

---

**Issue #854 Resolution**: Contracts already support smart wallets natively via `require_auth()`. This document provides integration guidance for frontend developers to implement passkey authentication for healthcare partners.
