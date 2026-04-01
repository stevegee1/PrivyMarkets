/**
 * 2_create_market.mjs — Create a new prediction market via leo execute
 *
 * Usage:
 *   node 2_create_market.mjs
 *
 * Prerequisites:
 *   - PRIVATE_KEY set in .env (the admin key used to deploy)
 *   - The admin must have an AdminCap record. Run initialize() first if needed.
 *   - Approved sufficient USDCx for the contract:
 *       snarkos developer execute test_usdcx_stablecoin.aleo approve_public \
 *         "privymarket_v6.aleo" "2000000u128" \
 *         --private-key $PRIVATE_KEY ...
 *
 * What it does:
 *   1. Prints the leo execute command you need to run
 *   2. Shows the expected market_id so you can verify on-chain
 */
import 'dotenv/config';
import { PROGRAM_ID, head, log, info, warn } from './helpers.mjs';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS ||
  'aleo1aqwe9742m69tq0hr5645qcsw5a77u025s0xpedx0y602she0jsyq5pjghk';

// ── Market parameters — edit these ───────────────────────────────────────────
const METADATA_CID  = '1field';                   // replace with your IPFS CID hash
const METADATA_HASH = '2field';                   // replace with BHP256 of raw metadata
const RESOLUTION_BLOCK = '999999u64';             // block height deadline
const INITIAL_YES   = '1000000000u128';           // 1000 USDCx
const INITIAL_NO    = '1000000000u128';           // 1000 USDCx
const ENDPOINT      = 'https://api.provable.com/v2/testnet';
const BROADCAST     = `${ENDPOINT}/transaction/broadcast`;

head('PrivyMarkets — Create Market');

if (!PRIVATE_KEY) {
  warn('PRIVATE_KEY not set in .env — cannot sign transaction.');
  warn('Showing dry-run commands only.');
}

// ── Step 1: Approve USDCx spend ─────────────────────────────────────────────
const TOTAL = '2000000000u128'; // initial_yes + initial_no
log('Step 1 — Approve USDCx (run this first if not done):');
console.log(`\n  snarkos developer execute test_usdcx_stablecoin.aleo approve_public \\
    "${PROGRAM_ID}" "${TOTAL}" \\
    --private-key ${PRIVATE_KEY ?? 'YOUR_PRIVATE_KEY'} \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000\n`);

// ── Step 2: Create market ────────────────────────────────────────────────────
log('Step 2 — Create Market:');
console.log(`\n  snarkos developer execute ${PROGRAM_ID} create_market \\
    --record "AdminCap record plaintext here" \\
    "${METADATA_CID}" "${METADATA_HASH}" "${RESOLUTION_BLOCK}" \\
    "${INITIAL_YES}" "${INITIAL_NO}" \\
    --private-key ${PRIVATE_KEY ?? 'YOUR_PRIVATE_KEY'} \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000\n`);

// ── Step 3: Leo execute alternative ─────────────────────────────────────────
log('Alternative — Leo Execute (needs AdminCap record):');
console.log(`\n  cd backend && leo execute create_market \\
    "AdminCap { owner: ${ADMIN_ADDRESS}.private }" \\
    "${METADATA_CID}" "${METADATA_HASH}" "${RESOLUTION_BLOCK}" \\
    "${INITIAL_YES}" "${INITIAL_NO}" \\
    --network testnet --endpoint https://api.explorer.provable.com/v1 --broadcast\n`);

info('After broadcast, run: node 1_check_state.mjs <market_id>field');
info('Market ID is printed in the transaction output (MarketInfo record)');
