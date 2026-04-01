/**
 * batch_create_markets.mjs — Generate commands to batch-create 10 prediction markets
 *
 * Budget: 45 USDCx available
 *   - 10 markets × 4 USDCx (2 per side) = 40 USDCx total
 *   - 5 USDCx reserve
 *
 * Usage:
 *   node batch_create_markets.mjs
 *
 * BEFORE RUNNING:
 *   1. You need an AdminCap record (run: node 0_initialize.mjs)
 *   2. This script prints a single approve + 10 create commands
 *   3. Run each in sequence, wait for the tx to FINALIZE before the next
 *
 * AFTER RUNNING:
 *   - Decrypt your MarketInfo records (scan_records.mjs or Shield wallet)
 *   - Each record has a market_id field
 *   - Run: node update_market_index.mjs <id1> <id2> ... <id10>
 */
import 'dotenv/config';
import { PROGRAM_ID, USDCX_ID, head, log, info, warn } from './helpers.mjs';

const PRIVATE_KEY   = process.env.PRIVATE_KEY;
const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS ||
  'aleo1aqwe9742m69tq0hr5645qcsw5a77u025s0xpedx0y602she0jsyq5pjghk';
const ENDPOINT      = 'https://api.provable.com/v2/testnet';
const BROADCAST     = `${ENDPOINT}/transaction/broadcast`;
const PK            = PRIVATE_KEY ?? 'YOUR_PRIVATE_KEY';

// 2 USDCx per side = 4 USDCx per market = 40 USDCx for 10 markets
const LIQ = 2_000_000n; // µUSDCx per side

// Current block: 15,474,021
// 1 day ≈ 2,618 blocks (33s per block on testnet)
const BASE = 15_474_021;
const DAY  = 2_618;

const MARKETS = [
  {
    id: 1,  cid: '1001field', hash: '1001field',
    resolution: BASE + DAY * 30,
    question: 'Will Bitcoin close above $100k by end of April 2026?',
  },
  {
    id: 2,  cid: '1002field', hash: '1002field',
    resolution: BASE + DAY * 45,
    question: 'Will Ethereum reach $5,000 before May 2026?',
  },
  {
    id: 3,  cid: '1003field', hash: '1003field',
    resolution: BASE + DAY * 90,
    question: 'Will GPT-5 be publicly released before July 2026?',
  },
  {
    id: 4,  cid: '1004field', hash: '1004field',
    resolution: BASE + DAY * 60,
    question: 'Will Aleo mainnet launch before June 2026?',
  },
  {
    id: 5,  cid: '1005field', hash: '1005field',
    resolution: BASE + DAY * 35,
    question: 'Will the US Federal Reserve cut rates in May 2026?',
  },
  {
    id: 6,  cid: '1006field', hash: '1006field',
    resolution: BASE + DAY * 55,
    question: 'Will Solana (SOL) surpass $300 before June 2026?',
  },
  {
    id: 7,  cid: '1007field', hash: '1007field',
    resolution: BASE + DAY * 70,
    question: 'Will Apple announce an AI-native iPhone at WWDC 2026?',
  },
  {
    id: 8,  cid: '1008field', hash: '1008field',
    resolution: BASE + DAY * 80,
    question: 'Will total crypto market cap exceed $5T before July 2026?',
  },
  {
    id: 9,  cid: '1009field', hash: '1009field',
    resolution: BASE + DAY * 65,
    question: 'Will ALEO token list on a top-5 CEX by June 2026?',
  },
  {
    id: 10, cid: '1010field', hash: '1010field',
    resolution: BASE + DAY * 100,
    question: 'Will the first ZK-native DeFi protocol hit $1B TVL before Q3 2026?',
  },
];

const totalLiq = BigInt(MARKETS.length) * LIQ * 2n;

head('PrivyMarkets — Batch Create 10 Markets');
info(`Admin:    ${ADMIN_ADDRESS}`);
info(`Budget:   45 USDCx available`);
info(`Per mkt:  ${Number(LIQ) / 1_000_000} USDCx each side = ${Number(LIQ * 2n) / 1_000_000} USDCx per market`);
info(`Total:    ${Number(totalLiq) / 1_000_000} USDCx for ${MARKETS.length} markets`);
info(`Reserve:  ${45 - Number(totalLiq) / 1_000_000} USDCx`);
info(`Gas est:  ~${MARKETS.length * 3} Aleo credits`);

if (!PRIVATE_KEY) warn('PRIVATE_KEY not set in .env — commands are templates');

console.log(`\n${'═'.repeat(62)}`);
log('STEP 0 — Initialize (if not done yet):');
console.log(`${'═'.repeat(62)}\n`);
console.log(`snarkos developer execute ${PROGRAM_ID} initialize \\
  --private-key ${PK} \\
  --query ${ENDPOINT} \\
  --broadcast ${BROADCAST} \\
  --priority-fee 1000000\n`);

console.log(`${'═'.repeat(62)}`);
log(`STEP 1 — Approve ${Number(totalLiq) / 1_000_000} USDCx (run ONCE):`);
console.log(`${'═'.repeat(62)}\n`);
console.log(`snarkos developer execute ${USDCX_ID} approve_public \\
  "${PROGRAM_ID}" "${totalLiq}u128" \\
  --private-key ${PK} \\
  --query ${ENDPOINT} \\
  --broadcast ${BROADCAST} \\
  --priority-fee 1000000\n`);

console.log(`${'═'.repeat(62)}`);
log('STEP 2 — Create Markets (run in order, wait for finalization):');
console.log(`${'═'.repeat(62)}\n`);
info('Set $ADMIN_CAP to the AdminCap record plaintext from initialize():');
console.log(`  export ADMIN_CAP='{ owner: ${ADMIN_ADDRESS}.private }'\n`);

for (const m of MARKETS) {
  console.log(`# ${m.id}/10 — ${m.question}`);
  console.log(`snarkos developer execute ${PROGRAM_ID} create_market \\
  --record "$ADMIN_CAP" \\
  "${m.cid}" "${m.hash}" "${m.resolution}u64" \\
  "${LIQ}u128" "${LIQ}u128" \\
  --private-key ${PK} \\
  --query ${ENDPOINT} \\
  --broadcast ${BROADCAST} \\
  --priority-fee 2000000\n`);
}

console.log(`${'═'.repeat(62)}`);
log('STEP 3 — After all 10 are finalized, collect market_ids:');
console.log(`${'═'.repeat(62)}\n`);
console.log(`  node scan_records.mjs   # view your MarketInfo records\n`);
info('Each MarketInfo record has a market_id field (e.g. 4053716152field)');
info('Then wire into frontend:');
console.log(`  node update_market_index.mjs <id1> <id2> ... <id10>\n`);
info('Finally verify each market on-chain:');
console.log(`  node 1_check_state.mjs <market_id>\n`);
