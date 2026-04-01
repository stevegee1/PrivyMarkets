/**
 * helpers.mjs — Shared utilities for PrivyMarkets testnet tests
 */
import 'dotenv/config';

export const PROGRAM_ID   = 'privymarket_v6.aleo';
export const USDCX_ID     = 'test_usdcx_stablecoin.aleo';
export const EXPLORER     = 'https://api.provable.com/v2/testnet';
export const EXPLORER_V1  = 'https://api.explorer.provable.com/v1';

// ── Logging ──────────────────────────────────────────────────────────────────
export const log  = (msg) => console.log(`  ✅  ${msg}`);
export const warn = (msg) => console.log(`  ⚠️   ${msg}`);
export const fail = (msg) => console.log(`  ❌  ${msg}`);
export const info = (msg) => console.log(`  ℹ️   ${msg}`);
export const head = (msg) => console.log(`\n${'─'.repeat(56)}\n  ${msg}\n${'─'.repeat(56)}`);

// ── Generic mapping fetch ─────────────────────────────────────────────────────
export async function fetchMapping(programId, mappingName, key) {
  const cleanKey = String(key).endsWith('field') ? key : `${key}field`;
  try {
    const r = await fetch(
      `${EXPLORER}/program/${programId}/mapping/${mappingName}/${cleanKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const v = await r.json();
    const s = (v?.value ?? v)?.toString().replace(/"/g, '').trim();
    if (s === 'null' || s === 'undefined') return null;
    if (s === 'true')  return true;
    if (s === 'false') return false;
    const m = s.match(/(-?\d+)/);
    return m ? BigInt(m[1]) : s;
  } catch { return null; }
}

// ── Full market state snapshot ────────────────────────────────────────────────
export async function fetchMarketState(marketId) {
  const [yes, no, vault, state, result, winPool, resTime] = await Promise.all([
    fetchMapping(PROGRAM_ID, 'yes_pools',        marketId),
    fetchMapping(PROGRAM_ID, 'no_pools',         marketId),
    fetchMapping(PROGRAM_ID, 'vault_balances',   marketId),
    fetchMapping(PROGRAM_ID, 'market_states',    marketId),
    fetchMapping(PROGRAM_ID, 'market_results',   marketId),
    fetchMapping(PROGRAM_ID, 'winning_pools',    marketId),
    fetchMapping(PROGRAM_ID, 'resolution_times', marketId),
  ]);
  return { yes, no, vault, state, result, winPool, resTime };
}

// ── Latest block height ───────────────────────────────────────────────────────
export async function latestBlock() {
  try {
    const r = await fetch(`${EXPLORER}/block/height/latest`, { signal: AbortSignal.timeout(5000) });
    return r.ok ? parseInt(await r.json()) : null;
  } catch { return null; }
}

// ── Format micro-USDCx ────────────────────────────────────────────────────────
export const fmt = (micro) =>
  micro != null ? `${(Number(micro) / 1_000_000).toFixed(6)} USDCx (${micro} µ)` : 'N/A';

// ── State code → label ────────────────────────────────────────────────────────
export const stateLabel = (s) =>
  s === 0n ? 'OPEN' : s === 1n ? 'PAUSED' : s === 3n ? 'RESOLVED' : `UNKNOWN(${s})`;
