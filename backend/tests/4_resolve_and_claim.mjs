/**
 * 4_resolve_and_claim.mjs — Resolve a market and print claim commands
 *
 * Usage:
 *   node 4_resolve_and_claim.mjs <market_id> <yes|no>
 *
 * Example:
 *   node 4_resolve_and_claim.mjs 4053716field yes
 *
 * What it does:
 *   1. Verifies the market is in OPEN or PAUSED state
 *   2. Checks the resolution_time has passed
 *   3. Prints the resolve_market snarkos command
 *   4. Prints the claim_winnings snarkos command for the winning side
 */
import 'dotenv/config';
import {
  PROGRAM_ID,
  fetchMarketState, latestBlock,
  head, log, info, warn, fail, fmt, stateLabel
} from './helpers.mjs';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ENDPOINT    = 'https://api.provable.com/v2/testnet';
const BROADCAST   = `${ENDPOINT}/transaction/broadcast`;

const [,, marketIdRaw, winSideArg] = process.argv;
if (!marketIdRaw || !winSideArg) {
  console.error('Usage: node 4_resolve_and_claim.mjs <market_id> <yes|no>');
  process.exit(1);
}
const marketId    = marketIdRaw.endsWith('field') ? marketIdRaw : `${marketIdRaw}field`;
const winOutcome  = winSideArg.toLowerCase() === 'yes';

async function main() {
  head(`PrivyMarkets — Resolve Market → ${winSideArg.toUpperCase()} wins`);
  info(`Market: ${marketId}`);

  const s     = await fetchMarketState(marketId);
  const block = await latestBlock();

  if (s.state === null) {
    fail('Market not found on-chain'); process.exit(1);
  }
  if (s.state === 3n) {
    warn('Market already RESOLVED');
    log(`Result: ${s.result ? 'YES WON' : 'NO WON'}`);
    log(`Winning pool: ${fmt(s.winPool)}`);
    log(`Vault: ${fmt(s.vault)}`);
    printClaimCommand(s, marketId);
    return;
  }
  if (s.state !== 0n && s.state !== 1n) {
    fail(`Unexpected state: ${stateLabel(s.state)}`); process.exit(1);
  }

  log(`Current state: ${stateLabel(s.state)}`);
  log(`Latest block:  ${block}`);
  log(`Res. time:     block ${s.resTime}`);

  if (block && s.resTime && block < s.resTime) {
    warn(`Resolution time not yet reached (${Number(s.resTime) - block} blocks remaining)`);
  } else {
    log('Resolution window: OPEN ✓');
  }

  // ── Resolve command ────────────────────────────────────────────────────────
  log('\nResolve Market command (admin only):');
  console.log(`
  snarkos developer execute ${PROGRAM_ID} resolve_market \\
    --record "AdminCap record plaintext" \\
    "${marketId}" "${winOutcome}" \\
    --private-key ${PRIVATE_KEY ?? 'YOUR_ADMIN_PRIVATE_KEY'} \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000
`);
  info('After resolving, run this script again to get the claim command.');
  printClaimCommand(s, marketId);
}

function printClaimCommand(s, marketId) {
  // Compute expected payout based on a hypothetical user holding userShares
  const vault    = s.vault    ?? 0n;
  const winPool  = s.winPool  ?? 0n;

  log('\nClaim Winnings command (per user — replace YOUR_SHARES and YOUR_POSITION):');
  console.log(`
  # 1. Compute your payout first:
  #    payout = (your_shares * vault) / winning_pool
  #    Example: (1000u64 * ${vault}u128) / ${winPool || 'WINNING_POOL'}u128

  snarkos developer execute ${PROGRAM_ID} claim_winnings \\
    --record "Position record plaintext" \\
    "${marketId}" "EXPECTED_PAYOUT_u128" \\
    --private-key YOUR_PRIVATE_KEY \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000

  # Then withdraw:
  snarkos developer execute ${PROGRAM_ID} withdraw_public \\
    "${marketId}" "AMOUNT_u128" \\
    --private-key YOUR_PRIVATE_KEY \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000
`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
