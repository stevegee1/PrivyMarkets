/**
 * 6_admin_controls.mjs — Admin-only transitions: pause, resume, withdraw
 *
 * Usage:
 *   node 6_admin_controls.mjs <market_id> <pause|resume|withdraw> [amount]
 *
 * Examples:
 *   node 6_admin_controls.mjs 4053716field pause
 *   node 6_admin_controls.mjs 4053716field resume
 *   node 6_admin_controls.mjs 4053716field withdraw 50
 */
import 'dotenv/config';
import {
  PROGRAM_ID,
  fetchMarketState,
  head, log, info, warn, fail, fmt, stateLabel
} from './helpers.mjs';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ENDPOINT    = 'https://api.provable.com/v2/testnet';
const BROADCAST   = `${ENDPOINT}/transaction/broadcast`;

const [,, marketIdRaw, action, amountArg] = process.argv;
if (!marketIdRaw || !action) {
  console.error('Usage: node 6_admin_controls.mjs <market_id> <pause|resume|withdraw> [amount_usdcx]');
  process.exit(1);
}
const marketId = marketIdRaw.endsWith('field') ? marketIdRaw : `${marketIdRaw}field`;
const pk       = PRIVATE_KEY ?? 'YOUR_ADMIN_PRIVATE_KEY';

async function main() {
  head(`PrivyMarkets — Admin: ${action.toUpperCase()}`);

  const s = await fetchMarketState(marketId);
  if (s.state === null) {
    fail('Market not found on-chain'); process.exit(1);
  }

  log(`Current state: ${stateLabel(s.state)}`);
  log(`Vault:         ${fmt(s.vault)}`);

  switch (action.toLowerCase()) {
    case 'pause': {
      if (s.state !== 0n) {
        warn(`Market is not OPEN (state=${stateLabel(s.state)}) — pause will fail`);
      }
      log('\nPause Market command (admin only):');
      console.log(`
  snarkos developer execute ${PROGRAM_ID} pause_market \\
    --record "AdminCap record plaintext" \\
    "${marketId}" \\
    --private-key ${pk} \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000
`);
      break;
    }

    case 'resume': {
      if (s.state !== 1n) {
        warn(`Market is not PAUSED (state=${stateLabel(s.state)}) — resume will fail`);
      }
      log('\nResume Market command (admin only):');
      console.log(`
  snarkos developer execute ${PROGRAM_ID} resume_market \\
    --record "AdminCap record plaintext" \\
    "${marketId}" \\
    --private-key ${pk} \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000
`);
      break;
    }

    case 'withdraw': {
      const amtUSDCx  = parseFloat(amountArg ?? '1');
      const amtMicro  = BigInt(Math.round(amtUSDCx * 1_000_000));
      const amtMicro128 = `${amtMicro}u128`;

      if (s.vault != null && amtMicro > s.vault) {
        warn(`Requested ${fmt(amtMicro)} exceeds vault ${fmt(s.vault)}`);
      }

      log(`\nWithdraw Public (to public USDCx balance):`);
      console.log(`
  snarkos developer execute ${PROGRAM_ID} withdraw_public \\
    "${marketId}" "${amtMicro128}" \\
    --private-key YOUR_USER_PRIVATE_KEY \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000
`);

      log('Withdraw Private (to private Token record — maximum privacy):');
      console.log(`
  snarkos developer execute ${PROGRAM_ID} withdraw_private \\
    "${marketId}" "${amtMicro}u64" \\
    --private-key YOUR_USER_PRIVATE_KEY \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000
`);
      info('withdraw_private emits a private Token record to your wallet.');
      break;
    }

    default:
      fail(`Unknown action: ${action}. Use: pause | resume | withdraw`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
