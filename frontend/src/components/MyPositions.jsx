import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { PROGRAM_ID } from '../core/constants.js';
import { requestTransaction, normalizeWalletError } from '../lib/walletAdapter.js';
import {
  loadPositions,
  removePosition,
  updatePosition,
} from '../lib/usePositionsStore.js';
import { fetchRecordsViaSDK } from '../core/sdkRecordProvider.js';

// ─── Explorer base ─────────────────────────────────────────────────────────────
const EXPLORER = 'https://api.provable.com/v2/testnet';

// ─── Fetch a single mapping value from chain ──────────────────────────────────
async function fetchMapping(name, key) {
  const cleanKey = key.toString().trim().endsWith('field') ? key : `${key}field`;
  try {
    const r = await fetch(`${EXPLORER}/program/${PROGRAM_ID}/mapping/${name}/${cleanKey}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const v = await r.json();
    const s = (v.value?.toString() ?? v?.toString()).replace(/"/g, '').trim();
    if (s === 'true')  return true;
    if (s === 'false') return false;
    const m = s.match(/(-?\d+)/);
    return m ? +m[1] : null;
  } catch {
    return null;
  }
}

// ─── Fetch market state from chain ────────────────────────────────────────────
async function fetchMarketState(marketId) {
  const [yesPool, noPool, vault, state, result, winPool] = await Promise.all([
    fetchMapping('yes_pools',      marketId),
    fetchMapping('no_pools',       marketId),
    fetchMapping('vault_balances', marketId),
    fetchMapping('market_states',  marketId),
    fetchMapping('market_results', marketId),
    fetchMapping('winning_pools',  marketId),
  ]);
  return {
    yes_pool:     yesPool  ?? 0,
    no_pool:      noPool   ?? 0,
    vault:        vault    ?? 0,
    state:        state    ?? 0,
    resolved:     state === 3,
    result:       result === true,
    winning_pool: winPool  ?? 0,
  };
}

// ─── AMM sell preview ─────────────────────────────────────────────────────────
function ammSellPreview(yes, no, shares, isYes) {
  const y = BigInt(yes), n = BigInt(no), s = BigInt(shares);
  const k = y * n;
  if (isYes) {
    const newNo  = n + s;
    const newYes = k / newNo;
    return Number(y - newYes);
  } else {
    const newYes = y + s;
    const newNo  = k / newYes;
    return Number(n - newNo);
  }
}

// ─── Compute claim payout ─────────────────────────────────────────────────────
function computeClaimPayout(shares, winningPool, vault) {
  if (!winningPool || !vault || !shares) return 0n;
  return (BigInt(shares) * BigInt(vault)) / BigInt(winningPool);
}

// ─── State label ─────────────────────────────────────────────────────────────
const STATE_LABEL = { 0: 'Open', 1: 'Paused', 3: 'Resolved' };

// ─────────────────────────────────────────────────────────────────────────────
export default function MyPositions() {
  const { wallet, address: publicKey } = useWallet();

  const [positions,    setPositions]    = useState([]);
  const [enriched,     setEnriched]     = useState({});
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [actionState,  setActionState]  = useState({});
  const [pasteBox,     setPasteBox]     = useState({});  // { [txId]: string }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const setAction = (txId, patch) =>
    setActionState(prev => ({ ...prev, [txId]: { ...(prev[txId] || {}), ...patch } }));

  // ── Load positions from localStorage ─────────────────────────────────────
  const refresh = useCallback(() => {
    if (!publicKey) return;
    const stored = loadPositions(publicKey);
    setPositions(stored);
  }, [publicKey]);

  // Auto-load on connect
  useEffect(() => { refresh(); }, [publicKey, refresh]);

  // ── Enrich positions with live chain state ─────────────────────────────────
  const handleEnrich = async () => {
    if (!publicKey) { setError('Connect your wallet first.'); return; }
    const stored = loadPositions(publicKey);
    setPositions(stored);
    if (stored.length === 0) return;

    setLoading(true);
    setError('');
    try {
      const results = await Promise.allSettled(
        stored.map(async (p) => {
          const chain = await fetchMarketState(p.marketId);
          return { txId: p.txId, chain };
        })
      );
      const newEnriched = {};
      for (const r of results) {
        if (r.status === 'fulfilled') {
          newEnriched[r.value.txId] = r.value.chain;
        }
      }
      setEnriched(newEnriched);
    } catch (e) {
      setError('Failed to fetch chain state: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Auto-Sync Records (Multi-Strategy Hunting) ──────────────────────────
  const handleAutoSync = async () => {
    if (!publicKey) return;
    setLoading(true);
    setError('');
    let foundCount = 0;
    try {
      // Strategy: Use SDK to find records via Explorer/Provider
      const records = await fetchRecordsViaSDK(null, PROGRAM_ID, publicKey);
      
      if (records && records.length > 0) {
        for (const record of records) {
          const txId = record.transaction_id || record.tx_id;
          if (txId) {
            updatePosition(publicKey, txId, { plaintext: typeof record === 'string' ? record : JSON.stringify(record) });
            foundCount++;
          }
        }
      }
      if (foundCount > 0) {
        refresh();
        setError(`✅ Synced ${foundCount} record(s) from on-chain!`);
      } else {
        setError('No new unspent records found. If you just bet, wait ~1 min.');
      }
    } catch (e) {
      setError('Auto-sync failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Sell ─────────────────────────────────────────────────────────────────
  const handleSell = async (pos, slippageBps = 50) => {
    const id = pos.txId;
    if (!pos.plaintext) {
      setAction(id, {
        error: 'Position record plaintext not available. Open the Position record in your wallet, tap Copy Plaintext, and paste it in the "Manual sell" box.',
      });
      return;
    }

    setAction(id, { loading: true, status: 'Fetching pool state…', error: '' });
    try {
      const chain = await fetchMarketState(pos.marketId);
      const isYes = pos.outcome === 'YES';
      const shares = pos.shares ?? 0;
      const rawPayout = ammSellPreview(chain.yes_pool, chain.no_pool, shares, isYes);
      const minPayout = Math.floor(rawPayout * (10_000 - slippageBps) / 10_000);

      // Fetch latest block for deadline
      let deadline = 999_999_999;
      try {
        const br = await fetch(`${EXPLORER}/block/height/latest`, { signal: AbortSignal.timeout(3000) });
        if (br.ok) { const b = await br.json(); deadline = (parseInt(b) || 0) + 20; }
      } catch { }

      setAction(id, { status: 'Waiting for wallet approval…' });
      const txId = await requestTransaction(
        wallet?.adapter,
        {
          programId: PROGRAM_ID,
          functionName: 'sell_shares',
          inputs: [
            `${pos.marketId}`,        // public market_id
            pos.plaintext,             // private Position record — ZK hidden ✓
            `${isYes}`,               // private outcome — ZK hidden ✓
            `${shares}u64`,           // private share_amount — ZK hidden ✓
            `${minPayout}u64`,        // public min_payout_out
            `${deadline}u32`,         // public deadline
          ],
          fee: 2.0,
        },
        publicKey
      );
      setAction(id, {
        loading: false,
        status: `✅ Sell submitted! TX: ${txId}\nCall Withdraw once confirmed on-chain.`,
        pendingWithdraw: String(rawPayout),
      });
    } catch (err) {
      setAction(id, { loading: false, error: normalizeWalletError(err).message });
    }
  };

  // ── Claim winnings ─────────────────────────────────────────────────────────
  const handleClaim = async (pos) => {
    const id = pos.txId;
    setAction(id, { loading: true, status: 'Computing payout…', error: '' });
    try {
      const chain = await fetchMarketState(pos.marketId);
      const isYes = pos.outcome === 'YES';
      const userShares = chain.result ? (isYes ? pos.shares : 0) : (!isYes ? pos.shares : 0);
      if (!userShares) {
        setAction(id, { loading: false, error: 'You hold the losing side — no winnings to claim.' });
        return;
      }
      const payout = computeClaimPayout(userShares, chain.winning_pool, chain.vault);
      if (!payout) {
        setAction(id, { loading: false, error: 'Payout is 0 — market may be empty.' });
        return;
      }

      setAction(id, { status: 'Waiting for wallet approval…' });
      const txId = await requestTransaction(
        wallet?.adapter,
        {
          programId: PROGRAM_ID,
          functionName: 'claim_winnings',
          inputs: [
            pos.plaintext,
            `${pos.marketId}`,
            `${payout}u128`,
          ],
          fee: 2.0,
        },
        publicKey
      );
      setAction(id, {
        loading: false,
        status: `✅ Claim submitted! TX: ${txId}\nNow call Withdraw to receive your USDCx.`,
        pendingWithdraw: payout.toString(),
      });
    } catch (err) {
      setAction(id, { loading: false, error: normalizeWalletError(err).message });
    }
  };

  // ── Withdraw ───────────────────────────────────────────────────────────────
  const handleWithdraw = async (pos, amount) => {
    const id = pos.txId;
    setAction(id, { loading: true, status: 'Submitting withdraw…', error: '' });
    try {
      const txId = await requestTransaction(
        wallet?.adapter,
        {
          programId: PROGRAM_ID,
          functionName: 'withdraw',
          inputs: [`${pos.marketId}`, `${amount}u128`],
          fee: 1.0,
        },
        publicKey
      );
      setAction(id, {
        loading: false,
        status: `✅ Withdrawn! TX: ${txId}. USDCx is now in your public balance.`,
        pendingWithdraw: null,
      });
      // Mark claimed in localStorage
      updatePosition(publicKey, id, { claimed: true, status: 'settled' });
      refresh();
    } catch (err) {
      setAction(id, { loading: false, error: normalizeWalletError(err).message });
    }
  };

  // ── Remove a position ──────────────────────────────────────────────────────
  const handleRemove = (txId) => {
    removePosition(publicKey, txId);
    refresh();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">

      {/* Page title */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">My Positions</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Positions are stored locally and enriched with live on-chain data.
        </p>
      </div>

      {/* Wallet guard */}
      {!publicKey ? (
        <div className="rounded-xl border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 p-5 mb-6 text-yellow-800 dark:text-yellow-200">
          Connect your wallet to view positions.
        </div>
      ) : (
        <div className="flex gap-3 mb-6">
          <button
            onClick={handleEnrich}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-900 dark:text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {loading ? 'Refreshing…' : '🔄 Refresh Prices'}
          </button>
          <button
            onClick={handleAutoSync}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors shadow-sm"
          >
            {loading ? 'Syncing…' : '🔍 Auto-Sync Records'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 text-red-800 dark:text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Privacy note */}
      {positions.length > 0 && (
        <div className="mb-6 p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-xs">
          🔒 <strong>Privacy Protected</strong> — Your bets are ZK-encrypted on-chain. Only you can see your positions here.
        </div>
      )}

      {/* Empty state */}
      {positions.length === 0 && !loading && publicKey && (
        <div className="text-center py-16 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
          <p className="text-2xl mb-2">🎯</p>
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-1">No positions yet</h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Place a bet on any market — your positions appear here instantly.
          </p>
        </div>
      )}

      {/* Position cards */}
      <div className="space-y-5">
        {positions.map((pos) => {
          const id    = pos.txId;
          const act   = actionState[id] || {};
          const chain = enriched[id];
          const isYes = pos.outcome === 'YES';

          // Chain-enriched values (fallback to 0 if not yet fetched)
          const yesPool    = chain?.yes_pool     ?? 0;
          const noPool     = chain?.no_pool      ?? 0;
          const vault      = chain?.vault        ?? 0;
          const state      = chain?.state        ?? null;
          const resolved   = chain?.resolved     ?? false;
          const result     = chain?.result       ?? false;
          const winPool    = chain?.winning_pool ?? 0;

          const totalPool  = yesPool + noPool;
          const yesOdds    = totalPool > 0 ? Math.round((yesPool / totalPool) * 100) : 50;

          // Sell preview
          const shares     = pos.shares ?? 0;
          const sellPayout = (state === 0 || state === null) && shares > 0 && totalPool > 0
            ? ammSellPreview(yesPool, noPool, shares, isYes) : 0;

          // Claim
          const userWon    = resolved && (result === isYes);
          const claimAmt   = userWon && shares > 0
            ? computeClaimPayout(shares, winPool, vault) : null;

          return (
            <div key={id}
              className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5"
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    isYes
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                  }`}>{pos.outcome}</span>
                  {state !== null && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300">
                      {STATE_LABEL[state] ?? 'Unknown'}
                    </span>
                  )}
                  {pos.status === 'pending' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 animate-pulse">
                      ⏳ Pending
                    </span>
                  )}
                </div>

                {/* Remove btn */}
                <button
                  onClick={() => handleRemove(id)}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  title="Remove from list"
                >✕</button>
              </div>

              {/* Question */}
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
                {pos.marketQuestion}
              </h3>

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
                <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Spent</p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {pos.amountMicro ? (pos.amountMicro / 1e6).toFixed(2) : '—'} USDCx
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Shares</p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {shares ? (shares / 1e6).toFixed(6) : '—'}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">YES odds</p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {chain ? `${yesOdds}%` : '—'}
                  </p>
                </div>
                <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">TX</p>
                  <a
                    href={`https://testnet.explorer.provable.com/transaction/${id}`}
                    target="_blank" rel="noreferrer"
                    className="text-blue-500 hover:underline font-mono text-xs truncate block"
                  >
                    {id.startsWith('at1') ? id.slice(0, 14) + '…' : id.slice(0, 13) + '…'}
                  </a>
                </div>
              </div>

              {/* Sell preview */}
              {sellPayout > 0 && (
                <div className="mb-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Sell all → </span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    ~{(sellPayout / 1e6).toFixed(6)} USDCx
                  </span>
                  <span className="text-xs text-gray-400 ml-2">(0.5% slippage)</span>
                </div>
              )}

              {/* Resolution */}
              {resolved && (
                <div className={`mb-3 p-3 rounded-lg border text-sm font-medium ${
                  userWon
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}>
                  {userWon
                    ? `🎉 You Won! Resolved ${result ? 'YES' : 'NO'}${claimAmt ? ` · ~${(Number(claimAmt) / 1e6).toFixed(4)} USDCx` : ''}`
                    : `Market resolved ${result ? 'YES' : 'NO'} — your ${pos.outcome} position did not win`
                  }
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 mt-2">
                {/* SELL — market open */}
                {(state === 0 || state === null) && shares > 0 && pos.plaintext && (
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => handleSell(pos)}
                      disabled={act.loading}
                      className="px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors"
                    >
                      {act.loading && act.status?.includes('Sell') ? 'Submitting…' : `Sell ${pos.outcome}`}
                    </button>
                    <button
                      onClick={() => {
                        const cmd = `snarkos developer execute ${PROGRAM_ID} sell_shares "${pos.marketId}" "${pos.plaintext}" "${isYes}" "${shares}u64" "0u64" "999999999u32" --private-key YOUR_KEY --query https://api.provable.com/v2/testnet --priority-fee 1000000`;
                        navigator.clipboard.writeText(cmd);
                        alert('CLI command copied!');
                      }}
                      className="text-[10px] text-orange-600 font-mono hover:underline text-center"
                    >
                      📋 CLI Sell
                    </button>
                  </div>
                )}

                {/* CLAIM — resolved + winner */}
                {resolved && userWon && !act.pendingWithdraw && !pos.claimed && pos.plaintext && (
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => handleClaim(pos)}
                      disabled={act.loading}
                      className="px-4 py-2 text-sm font-semibold rounded-lg bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 transition-colors"
                    >
                      {act.loading ? 'Claiming…' : '🏆 Claim Winnings'}
                    </button>
                    <button
                      onClick={() => {
                        const cmd = `snarkos developer execute ${PROGRAM_ID} claim_winnings "${pos.plaintext}" "${pos.marketId}" "0u128" --private-key YOUR_KEY --query https://api.provable.com/v2/testnet --priority-fee 1000000`;
                        navigator.clipboard.writeText(cmd);
                        alert('CLI command copied! Note: update payout u128 if needed.');
                      }}
                      className="text-[10px] text-green-600 font-mono hover:underline text-center"
                    >
                      📋 CLI Claim
                    </button>
                  </div>
                )}

                {/* WITHDRAW — after sell or claim */}
                {act.pendingWithdraw && (
                  <button
                    onClick={() => handleWithdraw(pos, act.pendingWithdraw)}
                    disabled={act.loading}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 transition-colors"
                  >
                    {act.loading ? 'Withdrawing…' : `Withdraw ${(Number(act.pendingWithdraw) / 1e6).toFixed(4)} USDCx`}
                  </button>
                )}
              </div>

              {/* Missing plaintext — inline paste box */}
              {!pos.plaintext && shares > 0 && (
                <div className="mt-3 text-xs">
                  <p className="text-amber-600 dark:text-amber-400 mb-2">
                    ℹ️ To sell, open your wallet → Records → find the <strong>Position</strong> record → Copy Plaintext, then paste it here:
                  </p>
                  <textarea
                    rows={3}
                    className="w-full p-2 rounded bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 font-mono text-xs text-slate-800 dark:text-slate-200"
                    placeholder="{ owner: ..., market_id: ..., yes_shares: ..., ... }"
                    value={pasteBox[id] || ''}
                    onChange={e => setPasteBox(prev => ({ ...prev, [id]: e.target.value }))}
                  />
                  <button
                    disabled={!pasteBox[id]?.trim()}
                    onClick={() => {
                      updatePosition(publicKey, id, { plaintext: pasteBox[id].trim() });
                      setPasteBox(prev => ({ ...prev, [id]: '' }));
                      refresh();
                    }}
                    className="mt-1 px-3 py-1 rounded bg-blue-600 text-white text-xs disabled:opacity-50"
                  >
                    Save Record
                  </button>
                </div>
              )}

              {/* Action feedback */}
              {act.status && (
                <div className="mt-3 p-3 rounded-lg bg-green-900/20 border border-green-700/50 text-green-300 text-xs break-all whitespace-pre-wrap">
                  {act.status}
                </div>
              )}
              {act.error && (
                <div className="mt-3 p-3 rounded-lg bg-red-900/20 border border-red-700/50 text-red-300 text-xs">
                  {act.error}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Help box */}
      {positions.length > 0 && (
        <div className="mt-8 p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400">
          <strong className="text-slate-800 dark:text-slate-200">💡 How it works</strong>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>Positions are saved locally the moment you place a bet.</li>
            <li>Click <strong>Refresh Prices</strong> to pull live pool state and resolution status.</li>
            <li>Use <strong>Auto-Sync Records</strong> if your Position records aren't showing up (requires a view key for private records).</li>
            <li><strong>CLI Fallback:</strong> If the wallet fails, you can use <code>snarkos developer execute {PROGRAM_ID} ...</code> to interact directly with the program.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
