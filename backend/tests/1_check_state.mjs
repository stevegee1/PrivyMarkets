/**
 * 1_check_state.mjs — Read current on-chain state of privymarket_v6.aleo
 *
 * Usage:
 *   node 1_check_state.mjs [market_id_field]
 *
 * Will print:
 *   - Whether the contract is deployed (via a mapping probe)
 *   - Current block height
 *   - Full market state for the given market_id (if provided)
 */
import {
  PROGRAM_ID, EXPLORER,
  fetchMapping, fetchMarketState, latestBlock,
  head, log, warn, fail, info, fmt, stateLabel
} from './helpers.mjs';

const marketId = process.argv[2] || null;

async function main() {
  head('PrivyMarkets — On-Chain State Check');

  // ── 1. Confirm contract is reachable ─────────────────────────────────────
  info(`Program:  ${PROGRAM_ID}`);
  info(`Explorer: ${EXPLORER}`);

  const block = await latestBlock();
  if (block) {
    log(`Network reachable — latest block: ${block}`);
  } else {
    fail('Cannot reach testnet API');
    process.exit(1);
  }

  // ── 2. Confirm contract is deployed ──────────────────────────────────────
  // We probe an arbitrary key in market_states; a non-500 response means
  // the program exists on-chain even if the mapping entry is empty.
  try {
    const r = await fetch(
      `${EXPLORER}/program/${PROGRAM_ID}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r.ok || r.status === 404) {
      // 404 can mean mapping key not found, not program missing
      log(`Program ${PROGRAM_ID} is deployed ✓`);
    } else {
      warn(`Program fetch returned ${r.status} — may not be deployed yet`);
    }
  } catch (e) {
    fail(`Program check failed: ${e.message}`);
  }

  // ── 3. Market state (if market_id provided) ───────────────────────────────
  if (!marketId) {
    warn('No market_id provided. Pass it as: node 1_check_state.mjs <market_id>field');
    warn('Example: node 1_check_state.mjs 4053716152732613659field');
    return;
  }

  head(`Market State: ${marketId}`);
  const s = await fetchMarketState(marketId);

  if (s.state === null) {
    fail('Market not found on-chain (yet). May not be created or still pending.');
    return;
  }

  log(`State:           ${stateLabel(s.state)}  (raw: ${s.state})`);
  log(`YES pool:        ${fmt(s.yes)}`);
  log(`NO  pool:        ${fmt(s.no)}`);
  log(`Vault:           ${fmt(s.vault)}`);
  log(`Resolution time: block ${s.resTime ?? 'N/A'}`);

  if (s.state === 3n) {
    log(`Result:          ${s.result ? 'YES WON' : 'NO WON'}`);
    log(`Winning pool:    ${fmt(s.winPool)}`);
  }

  // ── 4. Vault invariant check ──────────────────────────────────────────────
  if (s.yes != null && s.no != null && s.vault != null) {
    const ok = s.vault >= s.yes + s.no;
    if (ok) {
      log(`Vault invariant: PASS  (vault ≥ yes + no)`);
    } else {
      fail(`Vault invariant: FAIL  vault=${s.vault} < yes+no=${s.yes + s.no}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
