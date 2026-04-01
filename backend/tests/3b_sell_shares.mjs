/**
 * 3b_sell_shares.mjs — Simulate selling shares and print snarkos command
 *
 * Usage:
 *   node 3b_sell_shares.mjs <market_id> <yes|no> <share_amount>
 *
 * Example:
 *   node 3b_sell_shares.mjs 4053716field yes 50000
 *
 * What it does:
 *   1. Fetches live pool state
 *   2. Simulates the AMM sell (reverse swap) to compute net payout
 *   3. Applies 0.3% fee (P5) 
 *   4. Prints the snarkos CLI command with correct min_payout_out
 */
import 'dotenv/config';
import {
  PROGRAM_ID,
  fetchMarketState, latestBlock,
  head, log, info, warn, fail, fmt
} from './helpers.mjs';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ENDPOINT    = 'https://api.provable.com/v2/testnet';
const BROADCAST   = `${ENDPOINT}/transaction/broadcast`;
const SLIPPAGE    = 50n; // 0.5% in bps

const [,, marketIdRaw, side, shareAmtArg] = process.argv;
if (!marketIdRaw || !side || !shareAmtArg) {
  console.error('Usage: node 3b_sell_shares.mjs <market_id> <yes|no> <share_amount>');
  process.exit(1);
}
const marketId  = marketIdRaw.endsWith('field') ? marketIdRaw : `${marketIdRaw}field`;
const outcome   = side.toLowerCase() === 'yes';
const shares    = BigInt(shareAmtArg);

// ── AMM sell simulation (P3: ceil division, P5: 0.3% fee) ─────────────────────
function ammSell(yesPool, noPool, shareAmt, isYes) {
  const cy = yesPool, cn = noPool, sh = shareAmt;
  const k  = cy * cn;
  let rawPayout;
  if (isYes) {
    // Sell YES: yes shares → YES pool, payout from NO pool
    const newNo  = cn + sh;
    const newYes = (k + newNo - 1n) / newNo;   // ceil
    rawPayout = cy - newYes;
  } else {
    // Sell NO: no shares → NO pool, payout from YES pool
    const newYes = cy + sh;
    const newNo  = (k + newYes - 1n) / newYes; // ceil
    rawPayout = cn - newNo;
  }
  const netPayout = rawPayout * 997n / 1000n; // P5: 0.3% fee
  return { rawPayout, netPayout };
}

async function main() {
  head(`PrivyMarkets — Sell ${side.toUpperCase()} Shares`);
  info(`Market:  ${marketId}`);
  info(`Shares:  ${shares}`);

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

  const { rawPayout, netPayout } = ammSell(s.yes, s.no, shares, outcome);
  log(`Raw payout (before fee): ${fmt(rawPayout)}`);
  log(`Net payout (after 0.3% fee): ${fmt(netPayout)}`);

  const minPayout = netPayout * (10_000n - SLIPPAGE) / 10_000n;
  log(`Min payout (0.5% slippage): ${fmt(minPayout)}`);

  const block    = await latestBlock();
  const deadline = (block ?? 0) + 20;

  log('\nSell Shares command:');
  console.log(`
  snarkos developer execute ${PROGRAM_ID} sell_shares \\
    "${marketId}" \\
    --record "Position record plaintext" \\
    "${outcome}" "${shares}u64" \\
    "${minPayout}u64" "${deadline}u32" \\
    --private-key ${PRIVATE_KEY ?? 'YOUR_PRIVATE_KEY'} \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 2000000
`);

  info('After selling, claimable balance is credited on-chain.');
  info('Then run withdraw_public or withdraw_private to receive funds.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
