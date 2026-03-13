# Technical Report: Wave 3 Upgrades & Wave 4 Roadmap

## 🚀 Wave 3: Technical Upgrades

This wave focused on moving PrivyMarkets from a basic limit-order style system to a modern, decentralized AMM architecture.

### 1. Uniswap-Style AMM ($x \cdot y = k$)
*   **Implementation:** Rebuilt the core trading logic in `main.leo` (`privymarket_v5.aleo`) using the constant product formula.
*   **Result:** All trades now occur against on-chain liquidity pools (`yes_pools` and `no_pools`), eliminating the need for off-chain order matching.
*   **Safety:** Integrated mandatory slippage protection (`min_shares_out`) and block-height deadlines into every trade transition.

### 2. USDCx Stablecoin Adoption
*   **Integration:** Switched all protocol value-transfers to use the `test_usdcx_stablecoin.aleo` contract.
*   **Workflow:** Implemented the `approve_public` + `transfer_from_public` pattern for buys and liquidity provision, ensuring the protocol handles collateral as a standard Aleo token.

### 3. Record Management Upgrade
*   **Position Privacy:** Redesigned `Position` records to be consumed during `sell_shares`, enabling private order flow while updating public liquidity pools.
*   **Claimable Mapping:** Decoupled winning claims from direct token transfers to prevent transaction failures when the vault is locked or congested.

---

## 🛠 Wave 3: Critical Challenges & Workarounds

### 1. API Reliability & Timeouts
*   **Issue:** Provable V1 API returned constant 404s/timeouts.
*   **Workaround:** Migrated to **Provable V2 API** (`api.provable.com/v2`) and implemented 5s `AbortController` timeouts globally.

### 2. Mapping Key Formatting
*   **Issue:** Aleo mapping lookups returned `null` for valid keys.
*   **Workaround:** Discovered V2 API requires keys to explicitly end with the `field` suffix in URLs.
*   **Fix:** Standardized `fetchMapping` to automatically append `field` to any `BHP256` hash key.

### 3. Wallet Synchronization (JWT Errors)
*   **Issue:** Shield Wallet `requestRecords` frequently failed due to sync/JWT issues.
*   **Workaround:** Built an **On-Chain Transition Importer**.
*   **Fix:** Users paste a Transaction ID; the app fetches the raw ciphertext and decrypts it individually, bypassing the broken record sync.

---

## 🏗 Wave 4: Production Hardening Roadmap

### 1. Registry Scalability (Managed Backend)
*   **Current:** `markets.json` is a static file.
*   **Wave 4:** Migrate metadata to a managed database (PostgreSQL) to allow decentralized market creation.

### 2. Liquidity Provision (LP) UI
*   **Current:** Markets are capped by admin pre-funding.
*   **Wave 4:** Add UI for "Add/Remove Liquidity" to earn trading fees.

### 3. Record Caching (IndexedDB)
*   **Current:** High frequency of wallet decryption popups.
*   **Wave 4:** Cache decrypted `Position` records in `IndexedDB` to make the UI feel instant.

### 4. Mainnet Deployment
*   **Next Step:** Security audit of the `v5` Leo logic and deployment to Aleo Mainnet.
