# PrivyMarkets

> The first private prediction market on Aleo. Bet on the future without revealing your beliefs.

[![Built on Aleo](https://img.shields.io/badge/Built%20on-Aleo-blueviolet?style=for-the-badge)](https://aleo.org)
[![Privacy First](https://img.shields.io/badge/Privacy-First-green?style=for-the-badge)](https://github.com/yourusername/dark-pool-markets)
[![Zero Knowledge](https://img.shields.io/badge/Zero%20Knowledge-Betting-orange?style=for-the-badge)](https://github.com/yourusername/dark-pool-markets)

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
│          │    ALEO SMART PROGRAMS       │                    │
│          │                              │                    │
│          │  market_manager.aleo         │                    │
│          │  • Creates markets           │                    │
│          │  • Tracks public pool totals │                    │
│          │                              │                    │
│          │  betting.aleo                │                    │
│          │  • Private bet placement     │                    │
│          │  • Hidden positions          │                    │
│          │                              │                    │
│          │  resolution.aleo             │                    │
│          │  • Oracle submits result     │                    │
│          │  • Private claim winnings    │                    │
│          └──────────────────────────────┘                    │
│                                                              │
│  PRIVACY GUARANTEES:                                         │
│  ✓ Bet amounts are private records                           │
│  ✓ Positions hidden until claimed                            │
│  ✓ Only pool totals are public                               │
│  ✓ Winnings paid out privately                               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Example: Betting Flow

### Market: "Will BTC hit $120,000 by March 2026?"

**Step 1: Oracle Creates Market**
```leo
transition create_market(
    question: field,           // hash("Will BTC hit $120k by March 2025?")
    resolution_time: u64,      // Unix timestamp: March 1, 2025
    initial_liquidity: u64     // 10,000 credits (5k YES, 5k NO)
) -> Market
```

**Result:** Market is live with 50/50 odds (5k YES pool / 5k NO pool)

---

**Step 2: Alice Bets $10,000 on YES (Private)**

```leo
transition place_bet(
    market_id: field,
    position: bool,            // true = YES
    amount: u64,               // 10,000 credits
    payment: credits
) -> (Bet, Market)
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

**Step 3: Bob Bets $5,000 on NO (Private)**

```leo
transition place_bet(
    market_id: field,
    position: bool,            // false = NO
    amount: u64,               // 5,000 credits
    payment: credits
) -> (Bet, Market)
```

**Pool Updates:**
- YES pool: 15,000 (unchanged)
- NO pool: 5,000 → 10,000
- New odds: 15,000 / (15,000 + 10,000) = 60% YES

**What's HIDDEN:**
-  Nobody knows Bob bet
-  Nobody knows his amount or position
-  Alice doesn't know Bob bet against her

---

**Step 4: Resolution (March 1, 2026)**

Oracle checks: BTC is at $118,000 (did NOT hit $120k)

```leo
transition resolve_market(
    market_id: field,
    result: bool               // false = NO wins
) -> Market
```

**Result:** Market resolved, NO bets win

---

**Step 5: Bob Claims Winnings (Private)**

```leo
transition claim_winnings(
    bet: Bet,
    resolved_market: Market
) -> credits
```

**Calculation:**
- Bob bet 5,000 on NO at 40% odds
- Total pool: 25,000 credits
- NO pool won (10,000 credits bet on NO)
- Bob's share: (5,000 / 10,000) × 25,000 = 12,500 credits
- **Bob's profit: 7,500 credits** (150% return)

**What's HIDDEN:**
-  Nobody knows Bob won
-  Nobody knows his payout amount
-  Credits appear in Bob's wallet privately

---

**Step 6: Alice's Bet (Lost)**

Alice's Bet record is now worthless (she bet YES, market resolved NO).
She can burn it or keep it as a receipt, but it has no claim value.

**Privacy maintained:**
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

### What This Does NOT Guarantee

| Limitation | Explanation | Mitigation |
|------------|-------------|------------|
|  **Oracle honesty** | Trusted oracle submits result | Future: Multi-sig or token voting |
|  **Timing attacks** | Large pool changes reveal whale activity | Future: Batched transactions |
|  **Sybil resistance** | Multiple wallets can bet | Future: ZK identity proofs |

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

### Smart Contract Stack

```
┌─────────────────────────────────────────────────────┐
│              ALEO PROGRAMS (Leo)                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  market_manager.aleo                                │
│  ├─ create_market()                                 │
│  ├─ add_liquidity()                                 │
│  └─ resolve_market()                                │
│                                                     │
│  betting.aleo                                       │
│  ├─ place_bet()          [Private Bet Record]       │
│  ├─ cancel_bet()         [Before resolution]        │
│  └─ get_current_odds()   [Public view]              │
│                                                     │
│  resolution.aleo                                    │
│  ├─ submit_oracle_result()  [Trusted oracle]        │
│  └─ claim_winnings()        [Private payout]        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 10-Wave Buildathon Plan

###  Wave 1: Core Market Creation, Private Betting System & Frontend Market Browser

**Deliverables:**
-  `market_manager.aleo` program
-  `create_market()` transition
-  Market record structure
-  Deploy to Aleo testnet
-  CLI test script
-  `betting.aleo` program
-  `place_bet()` transition (creates private Bet record)
-  AMM price calculation
-  Pool update logic
- Web UI for market browser

###  Wave 2: Oracle Resolution System
**Goal:** Allow oracle to resolve markets and users to claim winnings

**Deliverables:**
-  `resolution.aleo` program
-  `resolve_market()` transition (oracle only)
-  `claim_winnings()` transition (private payout)
-  Payout calculation logic
-  End-to-end test: create → bet → resolve → claim

---

### Wave 3: Enhance Frontend - Market Browser

**Deliverables:**
-  React app with Aleo SDK integration
-  Market list view (fetch from chain)
-  Market detail page (pools, odds, resolution time)
-  Aleo wallet connection (Leo Wallet / Puzzle Wallet)
-  Responsive design

**Features:**
- View all active markets
- See current odds (calculated from pools)
- Time to resolution countdown
- Total volume (yes_pool + no_pool)

**Success Criteria:**
-  Wallet connects successfully
-  Markets display with correct data
-  Odds calculated accurately
-  Mobile responsive

---

###  Wave 4: Frontend - Bet Placement UI
**Goal:** Allow users to place bets through UI

**Deliverables:**
-  Bet placement modal/form
-  Position selection (YES/NO buttons)
-  Amount input with validation
-  Odds preview (dynamic based on amount)
-  Transaction signing via wallet
-  Success/error handling

**Features:**
- Toggle YES/NO position
- Amount input with balance check
- Live odds preview
- Slippage warning if large bet
- Privacy reminder ("Your position stays private")

**Success Criteria:**
-  Transaction signs successfully
-  Bet record created (check wallet)
-  Market pools update on chain
-  UI shows confirmation

---

###  Wave 5: Frontend - Position Manager
**Goal:** View your private bets and claim winnings

**Deliverables:**
-  "My Bets" dashboard
-  Display owned Bet records from wallet
-  Show bet details (amount, position, entry odds)
-  Market status (active/resolved)
-  Claim winnings button (for winning bets)
-  P&L calculation


**Features:**
- List all your bets
- Show market status
- Calculate potential/actual winnings
- One-click claim for winning bets
- Privacy reminder (only you see this)

**Success Criteria:**
-  Bets load from wallet
-  Status calculated correctly
-  Claim transaction works
-  Payout amount accurate

---

###  Wave 6: Oracle Dashboard
**Goal:** Admin interface for creating and resolving markets

**Deliverables:**
-  Oracle-only dashboard
-  Market creation form
-  Resolve market interface
-  Market analytics (volume, participants estimate)
-  Access control (only market owner)

**Features:**
- Create markets with custom questions
- Set resolution time
- Add initial liquidity
- Resolve markets when time comes
- View market analytics

**Success Criteria:**
-  Only owner can access their markets
-  Market creation works
-  Resolution updates market state
-  Cannot resolve before time

---

###  Wave 7: Real-World Demo Markets
**Goal:** Deploy 3 real prediction markets with actual data

**Deliverables:**
-  Market 1: Crypto ("Will BTC hit $120k by March 2025?")
-  Market 2: Politics ("Will [Event] happen by [Date]?")
-  Market 3: Sports ("Will [Team] win championship?")
-  Initial liquidity in each market
-  Off-chain question storage (IPFS or DB)
-  Oracle resolution plan


**Demo Script:**
1. Show 3 live markets in UI
2. Walk through bet placement (Alice bets on BTC)
3. Show privacy (blockchain explorer shows no position)
4. Fast-forward to resolution time
5. Oracle resolves market
6. Winner claims payout privately

**Success Criteria:**
-  3 markets deployed to testnet
-  Questions stored off-chain
-  Markets discoverable in UI
-  Can place test bets on all 3
-  Resolution mechanism tested

---

### Wave 8: Privacy + Market Balancing
**Goal:** Advanced privacy features + prevent one-sided markets

**The Problem:**
When predictions become obvious (e.g., "BTC will hit $50k" when it's already at $48k), everyone bets YES and the market becomes:
- **Illiquid** - No counterparty willing to bet NO at 95% YES odds
- **Stagnant** - Price discovery fails, market stops updating
- **Unfair** - Late bettors get terrible odds

**New Deliverables:**

**Market Balancing:**
-  **LMSR pricing function** - Logarithmic cost curve keeps spreads tight even when lopsided
-  **10%-90% circuit breakers** - Hard limits prevent absurd odds
-  **Rebalancing function** - Oracle injects liquidity to minority side when odds hit 85%+
-  **UI warning** - Alert users: " Market heavily skewed toward NO. Rebalancing recommended."

**Privacy Enhancements:**
-  Privacy budget system (limit queries per user)
-  Batched bet transactions (hide timing)
-  Odds obfuscation (add noise to prevent exact inference)
-  Documentation of privacy guarantees


**Success Criteria:**
-  LMSR pricing compresses extreme odds
-  Circuit breaker rejects bets beyond 10%-90%
-  Oracle can rebalance markets above 85% skew
-  UI shows warnings for heavily skewed markets
-  Privacy budget enforced
-  Batching reduces timing leaks
-  Documentation explains guarantees

---

### Wave 9 - 10: Polish & Grand Finale
**Goal:** Production-ready marketplace with professional presentation

**Deliverables:**
-  All components integrated seamlessly
-  Professional UI/UX design
-  Comprehensive documentation
-  5-minute demo video
-  Pitch deck for judges
-  Deploy to Aleo mainnet/testnet
-  Analytics dashboard
-  Bug fixes and optimization

**Final Checklist:**

**Smart Contracts:**
-  All programs audited (self-audit)
-  Gas optimization
-  Error handling
-  Deployed to testnet
-  Transaction IDs documented

**Frontend:**
-  Mobile responsive
-  Wallet adapter stable
-  Loading states
-  Error messages clear
-  Accessibility (WCAG AA)
-  Dark mode

**Documentation:**
-  README with setup instructions
-  Architecture diagrams
-  API documentation
-  Privacy guarantees explained
-  FAQ section
-  Video tutorial

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

**2. Deploy Smart Contracts:**
```bash
cd programs/market_manager
leo build
leo deploy --network testnet

cd ../betting
leo build
leo deploy --network testnet

cd ../resolution
leo build
leo deploy --network testnet
```

**3. Configure Frontend:**
```bash
cd ../../frontend
cp .env.example .env

# Edit .env with your program IDs
VITE_MARKET_MANAGER_PROGRAM=market_manager.aleo
VITE_BETTING_PROGRAM=betting.aleo
VITE_RESOLUTION_PROGRAM=resolution.aleo
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

## Development Workflow

### Creating a New Market

```bash
# Via CLI
leo run create_market \
  "$(leo hash 'Will BTC hit $120k by March 2025?')" \
  "1740000000u64" \
  "10000u64"

# Via UI
1. Connect wallet
2. Navigate to Oracle Dashboard
3. Click "Create Market"
4. Fill form and submit
```

### Placing a Bet

```bash
# Via CLI
leo run place_bet \
  "{market_record}" \
  "true" \          # YES position
  "1000u64" \       # 1000 credits
  "{payment_record}"

# Via UI
1. Browse markets
2. Click market card
3. Click "Place Bet"
4. Select YES/NO
5. Enter amount
6. Confirm transaction
```

### Resolving a Market

```bash
# Via CLI (oracle only)
leo run resolve_market \
  "{market_record}" \
  "false"           # NO won

# Via UI
1. Oracle Dashboard
2. Find market (resolution time passed)
3. Click "Resolve YES" or "Resolve NO"
```

### Claiming Winnings

```bash
# Via CLI
leo run claim_winnings \
  "{bet_record}" \
  "{resolved_market_record}"

# Via UI
1. Navigate to "My Bets"
2. Find winning bet
3. Click "Claim Winnings"
4. Confirm transaction
```

---

## Testing

### Unit Tests

```bash
cd programs/betting
leo test
```

### Integration Tests

```bash
# Full flow test
./scripts/test-flow.sh

# Expected output:
✓ Market created
✓ Bet 1 placed (Alice: 1000 YES)
✓ Bet 2 placed (Bob: 500 NO)
✓ Market resolved (NO wins)
✓ Bob claimed 1500 credits
✓ Privacy verified (positions not visible on explorer)
```

### Frontend Tests

```bash
cd frontend
npm run test
```

---

## Privacy Analysis

### Threat Model

| Threat | Mitigation | Status |
|--------|------------|--------|
| **Position Inference** | Private Bet records |  Mitigated |
| **Amount Inference** | Encrypted on-chain |  Mitigated |
| **Timing Correlation** | Batched transactions |  Wave 9 |
| **Whale Identification** | Noise in pool updates |  Wave 9 |
| **Oracle Manipulation** | Multi-sig (future) |  Centralized (MVP) |

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
- Market Manager: `market_manager_123.aleo`
- Betting: `betting_456.aleo`
- Resolution: `resolution_789.aleo`
