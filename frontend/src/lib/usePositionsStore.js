/**
 * usePositionsStore — localStorage-backed positions tracker.
 *
 * Mirrors the pattern from Veiled Markets' MyBets store:
 *   - Write a position entry immediately when a buy tx is submitted.
 *   - Read positions from localStorage in MyPositions.
 *   - Enrich on-demand from the chain (pool state, resolution).
 *
 * Key: `privy_positions_<address>`
 * Each entry:
 *   { id, txId, marketId, marketQuestion, outcome, shares, amountMicro, placedAt, status }
 */

const PREFIX = 'privy_positions_';

// ── Read helpers ──────────────────────────────────────────────────────────────
export function loadPositions(address) {
  if (!address) return [];
  try {
    const raw = localStorage.getItem(PREFIX + address);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ── Write helpers ─────────────────────────────────────────────────────────────
export function savePositions(address, positions) {
  if (!address) return;
  localStorage.setItem(PREFIX + address, JSON.stringify(positions));
}

/**
 * Add a new position entry right after a buy is submitted.
 * @param {string} address   - Wallet address (used as localStorage key)
 * @param {object} entry     - { txId, marketId, marketQuestion, outcome, amountMicro }
 */
export function addPosition(address, entry) {
  if (!address) return;
  const existing = loadPositions(address);

  // Deduplicate by txId
  if (existing.some(p => p.txId === entry.txId)) return;

  const position = {
    id:             entry.txId,
    txId:           entry.txId,
    marketId:       entry.marketId,
    marketQuestion: entry.marketQuestion || `Market ${entry.marketId?.slice(0, 12)}…`,
    outcome:        entry.outcome,          // 'YES' or 'NO'
    amountMicro:    entry.amountMicro,      // spent amount in micro-USDCx
    shares:         entry.shares || null,   // shares received (may be null until confirmed)
    placedAt:       Date.now(),
    status:         'pending',              // pending → active → won|lost
    claimed:        false,
    plaintext:      entry.plaintext || null, // Position record plaintext (if available)
  };

  savePositions(address, [position, ...existing]);
  return position;
}

/**
 * Update an existing position (e.g. mark as confirmed once on-chain).
 */
export function updatePosition(address, txId, patch) {
  const existing = loadPositions(address);
  const updated  = existing.map(p => p.txId === txId ? { ...p, ...patch } : p);
  savePositions(address, updated);
}

/**
 * Remove a position by txId.
 */
export function removePosition(address, txId) {
  const existing = loadPositions(address);
  savePositions(address, existing.filter(p => p.txId !== txId));
}
