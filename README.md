# PrivyMarkets

> The first private prediction market on Aleo. Bet on the future without revealing your beliefs.

[![Built on Aleo](https://img.shields.io/badge/Built%20on-Aleo-blueviolet?style=for-the-badge)](https://aleo.org)
[![Privacy First](https://img.shields.io/badge/Privacy-First-green?style=for-the-badge)](https://github.com/yourusername/dark-pool-markets)


---

## The Problem: Public Prediction Markets

**PolyMarket processes $3B+ in volume, but every bet is PUBLIC.**

```
Traditional Prediction Markets (PolyMarket, Augur):

i   Your positions visible to everyone
ii  Whales get frontrun by bots
iii Social cost on controversial topics
iv  Market manipulation through visible coordination
v   Privacy invasion (beliefs reveal political/personal views)
```

**Example:**
```
Alice bets $100,000 on "Trump wins 2024"
  ↓
Everyone sees: Alice's address, amount, position
  ↓
Consequences:
- Bots frontrun her trade
- Competitors know her conviction
- Social judgment for political stance
- Market moves before her order fills
```

---

## The Solution: PrivyMarkets on Aleo

```
┌─────────────────────────────────────────────────────────┐
│   POLYMARKET (Public)    →    PrivyMarkets (Private)    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Public positions        →    Private bet records       │
│  Visible whale trades    →    Hidden amounts            │
│  Frontrunning bots       →    Encrypted transactions    │
│  Social stigma           →    Anonymous participation   │
│  Orderbook visible       →    Only pool totals public   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### What You Get:

| Feature | Description |
|---------|-------------|
| **Private Positions** | Only YOU know what you bet and how much |
| **No Frontrunning** | Encrypted transactions prevent bot manipulation |
| **Anonymous Beliefs** | Bet on controversial topics without social cost |
| **Fair Pricing** | Automated Market Maker ensures fair odds |
| **Private Winnings** | Claim payouts without revealing bet details |

---

## How It Works

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    PRIVYMARKETS                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐            │
│  │  ORACLE  │      │  TRADER  │      │  TRADER  │            │
│  │  (Admin) │      │  (Alice) │      │   (Bob)  │            │
│  └────┬─────┘      └────┬─────┘      └────┬─────┘            │
│       │                 │                   │                │
│       │ Creates         │ Places            │ Places         │
│       │ Market          │ Bet (Private)     │ Bet (Private)  │
│       │                 │                   │                │
│       └─────────────────┼───────────────────┘                │
│                         │                                    │
│                         ▼                                    │
│          ┌──────────────────────────────┐                    │
│          │    ALEO SMART PROGRAM        │                    │
│          │                              │                    │
│          │  privymarket_v5.aleo         │                    │
│          │  • Unified Market Manager    │                    │
│          │  • AMM (Constant Product)    │                    │
│          │  • Resolution & Claims       │                    │
│          │  • Privacy-First Withdrawals │                    │
│          └──────────────────────────────┘                    │
│                                                              │
│  WAVE 4 PRIVACY & SECURITY:                                  │
│  ✓ Bet outcomes are private Records                          │
│  ✓ Private Withdrawals (Public-to-Private tokens)            │
│  ✓ Enforced Resolution Window (No early resolution)          │
│  ✓ Robust Market IDs (Collision prevention)                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Example: Betting Flow

### Market: "Will BTC hit $120,000 by March 2026?"

**Step 1: Admin Creates Market**
```leo
transition create_market(
    admin: AdminCap,
    metadata_cid: field,
    metadata_hash: field,
    resolution_time: u64,      // Block height for resolution
    initial_yes: u128,         // Flexible YES liquidity
    initial_no: u128           // Flexible NO liquidity
)
```

**Result:** Market is live. Wave 4 enables **Flexible Initial Pricing** (e.g., seeding a market at 70/30 odds).

---

**Step 2: Alice Bets $10,000 on YES (Private)**

```leo
transition buy_shares(
    market_id: field,
    amount: u128,              // 10,000 USDCx
    outcome: bool,             // true = YES (ZK-hidden)
    expected_yes: u64,         // Pool state for slippage check
    expected_no: u64,
    min_shares_out: u64,       // Slippage protection
    deadline: u32              // Staleness protection
)
```

**What happens:**
- Alice's bet creates a PRIVATE Bet record
- Only pool totals update publicly:
  - YES pool: 5,000 → 15,000
  - NO pool: 5,000 (unchanged)
- New odds: 15,000 / (15,000 + 5,000) = 75% YES

**What's HIDDEN:**
-  Nobody knows Alice placed the bet
-  Nobody knows she bet $10,000
-  Nobody knows she chose YES
-  Nobody can frontrun her trade

**Alice's Private Record:**
```leo
record Bet {
    owner: alice.aleo,
    market_id: 0x123...field,
    position: true,              // YES - PRIVATE
    amount: 10000u64,            // PRIVATE
    entry_odds: 50u64            // She entered at 50% - PRIVATE
}
```

---

-  Nobody knows Alice lost
-  Nobody knows she bet 10,000 credits
-  Her loss is completely private

---

## Privacy Guarantees

### What This System GUARANTEES

| Property | Mechanism |
|----------|-----------|
|  **Position privacy** | Bet records are private to owner |
|  **Amount privacy** | Bet amounts encrypted on-chain |
|  **No frontrunning** | Transactions encrypted until execution |
|  **Anonymous participation** | Wallet addresses not linked to bets publicly |
|  **Private winnings** | Claim payouts without revealing bet details |
|  **Fair odds** | AMM pricing based on public pool ratios only |

### What's Public (By Design)

| Public Data | Why It's Public | Privacy Impact |
|-------------|-----------------|----------------|
| Total YES pool | Needed for pricing | Cannot attribute to individuals |
| Total NO pool | Needed for pricing | Cannot attribute to individuals |
| Market creation | Needed for discovery | Oracle identity visible |
| Market resolution | Needed for claims | Result is public information |

---

## Competitive Landscape

| Platform | Privacy Model | Order Matching | Blockchain |
|----------|-------------|---------------|------------|
| **PolyMarket** | Public positions | CLOB orderbook | Polygon |
| **Augur** | Public positions | Orderbook | Ethereum |
| **Gnosis** | Public positions | AMM | Gnosis Chain |
| **PrivyMarkets** | Private positions | Private AMM | Aleo |

**Unique Value Proposition:** "The only prediction market where your beliefs stay private."

---

## Use Cases

###  Political Predictions
Bet on elections without revealing political affiliation

**Example Markets:**
- "Will [Candidate X] win the 2028 election?"
- "Will [Policy Y] pass by 2026?"


**Why Privacy Matters:**
- Avoid social/professional consequences
- No employer discrimination
- No targeted advertising based on beliefs

---

###  Financial Markets
Hedge fund strategies without revealing positions

**Example Markets:**
- "Will BTC hit $150k by EOY 2026?"
- "Will S&P 500 close above 7000 in 2026?"
- "Will [Company X] stock double this year?"

**Why Privacy Matters:**
- Institutional traders hide positions
- Prevent frontrunning by competitors
- Maintain alpha through information asymmetry

---

###  Entertainment & Sports
Bet against your team without social backlash

**Example Markets:**
- "Will [Team X] win the championship?"
- "Will [Movie Y] win Best Picture?"
- "Will [Game Z] launch on time?"

**Why Privacy Matters:**
- Fan loyalty vs. rational betting
- No judgment for betting against your team
- Separate emotion from strategy

---

###  Scientific Predictions
Academic/research predictions without career risk

**Example Markets:**
- "Will [Drug X] get FDA approval by 2026?"
- "Will [Theory Y] be proven by 2027?"
- "Will [Technology Z] achieve milestone this year?"

**Why Privacy Matters:**
- Researchers can hedge their own predictions
- No conflict of interest accusations
- Honest belief revelation

---

## Technical Architecture

### Smart Contract Stack (privymarket_v6.aleo)

```
┌─────────────────────────────────────────────────────┐
│              ALEO PROGRAM (Leo)                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  privymarket_v6.aleo                                │
│  ├─ create_market()      [Admin Control]            │
│  ├─ buy_shares()         [Private Outcome + AMM]    │
│  ├─ sell_shares()        [AMM Exit + Double-Dip Guard]  │
│  ├─ resolve_market()     [Enforced Deadline]        │
│  ├─ claim_winnings()     [Record Verification]      │
│  ├─ withdraw_private()   [ZK Privacy Exit]          │
│  └─ withdraw_public()    [Public Exit]              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 10-Wave Buildathon Plan

### ✅ Wave 1 - 3: Core Infrastructure (COMPLETE)
**Goal:** Market Creation, Private Betting, and Resolution.

**Implemented Features:**
- [x] **AMM Logic**: Constant Product $x \cdot y = k$ implementation.
- [x] **Private Positions**: Outcomes are stored as encrypted Records.
- [x] **Oracle Resolution**: Admin-controlled market settlement.
- [x] **Winnings Claim**: Private claim logic based on share of winning pool.
- [x] **Frontend v1**: Market browser and basic betting UI.

---

### ✅ Wave 4: Production Hardening (COMPLETE)
**Goal:** Security, Privacy Exit, AMM Precision & Protocol Resilience

**Implemented Features:**
- [x] **Private Withdrawal**: `withdraw_private` returns funds as private records.
- [x] **AMM Fees Embedded (P5)**: 0.3% fee stays in pool as liquidity (no separate `claim_fees`).
- [x] **Vault Invariant (P1)**: `assert(vault >= yes_pool + no_pool)` enforced after every state change.
- [x] **Double-Dip Guard (P2)**: `position_consumed` mapping prevents re-selling or re-claiming a spent position.
- [x] **Ceil Division (P3)**: All AMM divisions round in the protocol's favour — prevents rounding exploitation.
- [x] **No Snapshot Params (P4)**: `expected_yes/no` removed from `buy_shares`; finalize is authoritative.
- [x] **Slippage Protection**: `min_shares_out` / `min_payout_out` checks.
- [x] **Staleness Protection**: Block-height `deadline` enforcement.
- [x] **Resolution Guard**: Cannot resolve market before `resolution_time`.
- [x] **Flexible Pricing**: Set initial YES/NO liquidity ratios.
- [x] **Collision Prevention**: Market IDs hashed with signer and time.
- [x] **Judge-Ready Wiring**: Static indexer, Dual-Polling, and Resilient Record Hunting.
- [x] **CLI Fallbacks**: Pre-generated `snarkos` commands for all critical actions.

---

## 🚀 Future Roadmap (Waves 5-10)
### Wave 5: Decentralization & Advanced Privacy
Oracle Multi-sig, Batched Transactions, and ZK Identity Proofs.

### Wave 6: Position Manager Dashboard
UI for private bet management and winnings claims.

### Wave 7: Admin Oracle Console
Control panel for market creation and resolution.

### Wave 8: LMSR Pricing & Circuit Breakers
Logarithmic AMM pricing and volatility protection.

### Wave 9: Real-World Data Integration
Production oracles for Sports, Financial, and Political data.

### Wave 10: Mainnet Launch
Final security audits and Aleo Mainnet deployment.

---

## Repository Structure

```
privy-markets/
├── programs/                  # Aleo smart programs
│   ├── market_manager/
│   │   ├── src/
│   │   │   └── main.leo
│   │   ├── program.json
│   │   └── README.md
│   ├── betting/
│   │   ├── src/
│   │   │   └── main.leo
│   │   ├── program.json
│   │   └── README.md
│   └── resolution/
│       ├── src/
│       │   └── main.leo
│       ├── program.json
│       └── README.md
│
├── frontend/                  # React web app
│   ├── src/
│   │   ├── components/
│   │   │   ├── MarketBrowser.jsx
│   │   │   ├── BetModal.jsx
│   │   │   ├── MyBets.jsx
│   │   │   └── OracleDashboard.jsx
│   │   ├── hooks/
│   │   │   ├── useMarkets.js
│   │   │   ├── useBets.js
│   │   │   └── useWallet.js
│   │   ├── utils/
│   │   │   ├── odds.js
│   │   │   └── aleo.js
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
│
├── scripts/                   # Deployment & testing
│   ├── deploy.sh
│   ├── create-demo-markets.sh
│   └── test-flow.sh
│
├── docs/                      # Documentation
│   ├── ARCHITECTURE.md
│   ├── PRIVACY.md
│   ├── API.md
│   └── TUTORIAL.md
│
├── demo/                      # Demo materials
│   ├── demo-video.mp4
│   ├── pitch-deck.pdf
│   └── screenshots/
│
├── .env.example
├── README.md
└── LICENSE
```

---

## Getting Started

### Prerequisites

**1. Install Git**
- Download: [https://git-scm.com/downloads/](https://git-scm.com/downloads/)

**2. Install Rust**
- Download: [https://rust-lang.org/tools/install/](https://rust-lang.org/tools/install/)

**3. Install Leo**
```bash
# Install Leo
cargo install leo-lang

# Install Node.js (for frontend)
# Download from https://nodejs.org/
```

### Quick Start (5 Minutes)

**1. Clone Repository:**
```bash
git clone https://github.com/stevegee1/PrivyMarkets.git
cd PrivyMarkets
```

**2. Deploy Smart Contract:**
```bash
cd backend
leo build
leo deploy --network testnet
```

**3. Configure Frontend:**
```bash
cd ../frontend
cp .env.example .env

# Edit .env with your program ID
VITE_MARKET_PROGRAM=privymarket_v5.aleo
```

**4. Run Frontend:**
```bash
npm install
npm run dev
```

**5. Open Browser:**
```
http://localhost:5173
```

**6. Connect Wallet:**
- Install Leo Wallet or Puzzle Wallet
- Connect to testnet
- Fund with testnet credits

**7. Try Demo:**
- Browse markets
- Place a bet (encrypted!)
- Check blockchain explorer (position hidden!)

---

## CLI Usage (Testing)

### 1. Create Market
```bash
# Note: Requires an AdminCap record
leo run create_market \
  "{admin_cap_record}" \
  "$(leo hash 'metadata_cid')" \
  "$(leo hash 'metadata_hash')" \
  "1000u64" \           # Resolution Block Height
  "1000000000u128" \    # Initial YES (1000 USDCx)
  "1000000000u128"      # Initial NO (1000 USDCx)
```

### 2. Buy Shares (Bet)
```bash
# privymarket_v6.aleo — P4: expected_yes/no removed, finalize is authoritative
leo run buy_shares \
  "0x123...field" \    # market_id
  "100000000u128" \    # amount
  "true" \             # YES position (ZK-private)
  "90000000u64" \      # min_shares_out (slippage tolerance)
  "1000u32" \          # deadline (block height)
  "1711612800u64"      # timestamp (unix seconds)
```

### 3. Claim Winnings
```bash
leo run claim_winnings \
  "true" \             # outcome
  "0x123...field" \    # market_id
  "150000000u64"       # expected_payout
```

---

## Testing

### Smart Contract Tests
```bash
cd backend
leo test
```

### Frontend Development
```bash
cd frontend
npm run dev
```

---

## Privacy Analysis

### Threat Model

| Threat | Mitigation |
|--------|------------|
| **Position Inference** | Private outcome records (ZK-hidden) |
| **Amount Inference** | Encrypted token transfers |
| **Early Resolution** | Enforced block height window |
| **Collision Attacks** | Admin-specific market hashing |

### Privacy Guarantees

**What's Private:**
-  Your bet position (YES/NO)
-  Your bet amount
-  Your entry odds
-  Your winnings amount
-  Your payout claim

**What's Public:**
-  Total YES pool
-  Total NO pool
-  Market existence
-  Market resolution result
-  Transaction existence (not details)

**Comparison to PolyMarket:**

| Data Point | PolyMarket | Dark Pool Markets |
|------------|------------|-------------------|
| Your position | PUBLIC | **PRIVATE** |
| Your amount | PUBLIC | **PRIVATE** |
| Your address | PUBLIC | **PRIVATE** |
| Your winnings | PUBLIC | **PRIVATE** |
| Market totals | PUBLIC | PUBLIC |

---

## Economics & Tokenomics

### Fee Structure (Future)

```
Per Bet:
├─ 2% → Oracle (incentive for honest resolution)
└─ 98% → Bettors (winning pool distribution)

Platform revenue comes from oracle fees, not betting fees.
```

### Market Incentives

**For Oracles:**
- Earn 2% of total pool for honest resolution
- Reputation staking (future: slash for dishonesty)
- Multi-market creation incentives

**For Bettors:**
- Zero trading fees (just pay gas)
- Privacy premium (bet without exposure)
- Fair AMM pricing (no orderbook manipulation)

### Liquidity Bootstrapping

**Initial Launch:**
1. Oracle creates market with initial liquidity
2. Acts as "house" until sufficient bettors
3. Early bettors get better odds (less liquidity = more price impact)

**Mature Markets:**
- Organic liquidity from both sides
- Tighter spreads
- Lower price impact

---

## Contributing

We welcome contributions!

**Areas for Contribution:**
- Additional market categories
- Privacy enhancements
- UI/UX improvements
- Documentation
- Bug reports

**Development Setup:**
```bash
# Fork repo
git clone your-fork
cd PrivyMarkets

# Create feature branch
git checkout -b feature/your-feature

# Make changes
...

# Test thoroughly
./scripts/test-flow.sh

# Submit PR
git push origin feature/your-feature
```

---

## Security

**Responsible Disclosure:**
If you discover a security vulnerability, please email `ogarstephen98@gmail.com` instead of opening a public issue.

**Audit Status:**
-  Self-audit completed
-  External audit (planned post-buildathon)
-  Bug bounty program (planned for mainnet)

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---



## Status

**Testnet Deployment:**
- Unified Program: `privymarket_v6.aleo`
- Assets: `test_usdcx_stablecoin.aleo`
