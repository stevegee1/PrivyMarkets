/**
 * 3_buy_shares.mjs — Buy shares in a prediction market (YES or NO)
 *
 * Usage:
 *   node 3_buy_shares.mjs <market_id> <yes|no> [amount_usdcx]
 *
 * Examples:
 *   node 3_buy_shares.mjs 4053716field yes 10
 *   node 3_buy_shares.mjs 4053716field no  5.5
 *
 * What it does:
 *   1. Fetches live pool state from chain
 *   2. Simulates the AMM to compute expected shares
 *   3. Prints the exact snarkos CLI command to execute the buy
 *   4. After you run the command, run 1_check_state.mjs to verify
 */
import 'dotenv/config';
import {
  PROGRAM_ID, USDCX_ID,
  fetchMarketState, latestBlock,
  head, log, info, warn, fail, fmt
} from './helpers.mjs';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ENDPOINT    = 'https://api.provable.com/v2/testnet';
const BROADCAST   = `${ENDPOINT}/transaction/broadcast`;
const SLIPPAGE    = 50n; // 0.5% default slippage in bps

const [,, marketIdRaw, side, amountArg] = process.argv;
if (!marketIdRaw || !side) {
  console.error('Usage: node 3_buy_shares.mjs <market_id> <yes|no> [amount_usdcx]');
  process.exit(1);
}
const marketId  = marketIdRaw.endsWith('field') ? marketIdRaw : `${marketIdRaw}field`;
const outcome   = side.toLowerCase() === 'yes'; // true=YES false=NO
const amtUSDCx  = parseFloat(amountArg ?? '10');
const amtMicro  = BigInt(Math.round(amtUSDCx * 1_000_000));

// ── AMM simulation ────────────────────────────────────────────────────────────
function ammBuy(yesPool, noPool, amount, isYes) {
  const effective = amount * 997n / 1000n;
  const cy = yesPool, cn = noPool;
  const k  = cy * cn;
  if (isYes) {
    const newYes = cy + effective;
    const newNo  = (k + newYes - 1n) / newYes; // ceil
    return { shares: cn - newNo, newYes: cy + amount, newNo };
  } else {
    const newNo  = cn + effective;
    const newYes = (k + newNo - 1n) / newNo; // ceil
    return { shares: cy - newYes, newYes, newNo: cn + amount };
  }
}

async function main() {
  head(`PrivyMarkets — Buy ${side.toUpperCase()} Shares`);
  info(`Market:  ${marketId}`);
  info(`Amount:  ${fmt(amtMicro)}`);

  // Fetch live state
  const s = await fetchMarketState(marketId);
  if (s.state === null) {
    fail('Market not found on-chain'); process.exit(1);
  }
  if (s.state !== 0n) {
    fail(`Market is not OPEN (state=${s.state})`); process.exit(1);
  }

  log(`YES pool: ${fmt(s.yes)}`);
  log(`NO  pool: ${fmt(s.no)}`);
  log(`Vault:    ${fmt(s.vault)}`);

  // Simulate AMM
  const sim = ammBuy(s.yes, s.no, amtMicro, outcome);
  log(`Expected shares out: ${sim.shares}`);

  const minShares = sim.shares * (10_000n - SLIPPAGE) / 10_000n;
  log(`Min shares (0.5% slippage): ${minShares}`);

  const block     = await latestBlock();
  const deadline  = (block ?? 0) + 20;
  const timestamp = BigInt(Math.floor(Date.now() / 1000));

  // ── Step 1: Approve ───────────────────────────────────────────────────────
  log('\nStep 1 — Approve USDCx if not already done:');
  console.log(`
  snarkos developer execute ${USDCX_ID} approve_public \\
    "${PROGRAM_ID}" "${amtMicro}u128" \\
    --private-key ${PRIVATE_KEY ?? 'YOUR_PRIVATE_KEY'} \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000
`);

  // ── Step 2: Buy shares ────────────────────────────────────────────────────
  const outcomeStr = outcome ? 'true' : 'false';
  log('Step 2 — Buy shares:');
  console.log(`
  snarkos developer execute ${PROGRAM_ID} buy_shares \\
    "${marketId}" "${amtMicro}u128" "${outcomeStr}" \\
    "${minShares}u64" "${deadline}u32" "${timestamp}u64" \\
    --private-key ${PRIVATE_KEY ?? 'YOUR_PRIVATE_KEY'} \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 2000000
`);

  info('After broadcast: node 1_check_state.mjs ' + marketId);
  info('Your Position record will appear in your wallet after finalization (~2 blocks).');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
