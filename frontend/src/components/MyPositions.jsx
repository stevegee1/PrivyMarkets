import { useState, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { PROGRAM_ID } from "../core/constants.js";
import { formatRecordInput } from "../core/utils.js";
import { createAleoTransaction } from "../core/transaction-helper.js";

// ─── Explorer base ────────────────────────────────────────────────────────────
const EXPLORER = 'https://api.provable.com/v2/testnet';

// ─── Fetch a single mapping value ─────────────────────────────────────────────
// Returns: number for u8/u64/u128 mappings, boolean for bool mappings, null on error.
async function fetchMapping(name, key) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

  // CRITICAL: Aleo explorer mapping keys MUST end with "field"
  const cleanKey = key.toString().trim().endsWith("field") ? key : `${key}field`;

  try {
    const url = `${EXPLORER}/program/${PROGRAM_ID}/mapping/${name}/${cleanKey}`;
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!r.ok) return null;
    const v = await r.json();

    // V2 returns { value: "..." }
    const s = v.value?.toString().trim().replace(/"/g, '') || v?.toString().trim().replace(/"/g, '');
    if (s === 'true')  return true;
    if (s === 'false') return false;
    const m = s.match(/(-?\d+)/);
    return m ? +m[1] : null;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

// ─── Fetch full on-chain market state ────────────────────────────────────────
// Returns { yes_pool, no_pool, vault, state, resolved, result, winning_pool }
// All pool values in micro-USDCx (u64).
async function fetchMarketState(market_id) {
  const [yesPool, noPool, vault, state, result, winPool] = await Promise.all([
    fetchMapping('yes_pools',      market_id),
    fetchMapping('no_pools',       market_id),
    fetchMapping('vault_balances', market_id),
    fetchMapping('market_states',  market_id),
    fetchMapping('market_results', market_id),
    fetchMapping('winning_pools',  market_id),
  ]);
  return {
    yes_pool:     yesPool    ?? 0,
    no_pool:      noPool     ?? 0,
    vault:        vault      ?? 0,
    state:        state      ?? 0,
    resolved:     state === 3,
    result:       result === true,  // fetchMapping returns bool for bool mappings
    winning_pool: winPool    ?? 0,
  };
}

// ─── Compute expected payout for a winning position ──────────────────────────
// payout = (user_shares / winning_pool) × vault  (mirrors Leo finalize exactly)
function computeExpectedPayout(userShares, winningPool, vault) {
  if (!winningPool || !vault || !userShares) return 0n;
  return (BigInt(userShares) * BigInt(vault)) / BigInt(winningPool);
}

// ─── AMM sell preview — mirrors new privymarket_v5 finalize exactly ───────────
// SELL YES: shares injected INTO NO pool  → payout from YES pool
// SELL NO:  shares injected INTO YES pool → payout from NO pool
function ammSellPreview(yes, no, shares, outcome) {
  const y = BigInt(yes), n = BigInt(no), s = BigInt(shares);
  const k = y * n;
  if (outcome) {
    // SELL YES
    const newNo  = n + s;
    const newYes = k / newNo;
    return { payout: Number(y - newYes), newYes: Number(newYes), newNo: Number(newNo) };
  } else {
    // SELL NO
    const newYes = y + s;
    const newNo  = k / newYes;
    return { payout: Number(n - newNo), newYes: Number(newYes), newNo: Number(newNo) };
  }
}

// ─── Shield wallet tx ID extractor ───────────────────────────────────────────
const extractTxId = (r) =>
  typeof r === 'string' ? r : (r?.transactionId ?? JSON.stringify(r));

// ─── State label — contract states: 0=OPEN 1=PAUSED 3=RESOLVED (no state 2) ──
const STATE_LABEL = { 0: 'Open', 1: 'Paused', 3: 'Resolved' };

// ─────────────────────────────────────────────────────────────────────────────
function MyPositions() {
  const { wallet, address: publicKey } = useWallet();

  const [positions,    setPositions]    = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');

  // Per-position action state: { [key]: { loading, status, error } }
  const [actionState, setActionState]   = useState({});
  const [manualRecord, setManualRecord] = useState('');
  const [showManual,   setShowManual]   = useState(false);
  const [explorerTxId, setExplorerTxId] = useState('');
  const [scanning,     setScanning]     = useState(false);
  const [txStatus,     setTxStatus]     = useState('');

  // ── Update per-position action state ─────────────────────────────────────
  const setAction = (key, patch) =>
    setActionState(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));

  // ── Parse a Position record from Shield wallet ────────────────────────────
  const parseRecord = (rec) => {
    let d = rec.data || {};

    // Fallback: If data is empty but plaintext exists, try to parse the Leo string
    if (Object.keys(d).length === 0 && rec.plaintext) {
      console.log('Data empty, attempting to parse plaintext...');
      try {
        // Simple regex-based Leo record parser
        const pairs = rec.plaintext.match(/(\w+):\s*([^,{}]+)/g);
        if (pairs) {
          pairs.forEach(pair => {
            const [key, val] = pair.split(':').map(s => s.trim());
            d[key] = val;
          });
        }
      } catch (e) {
        console.error('Failed to parse plaintext:', e);
      }
    }

    const strip = (v) => parseInt((v || '').toString().replace(/[^0-9]/g, '') || '0');

    // Strip visibility modifiers but KEEP field type suffix.
    const market_id = (d.market_id || '')
      .replace(/\.private|\.public/g, '')
      .trim();

    return {
      raw:        rec,
      recordId:   rec.id || rec.recordId || `${market_id}-${strip(d.yes_shares)}-${strip(d.no_shares)}-${strip(d.timestamp)}`,
      plaintext:  rec.plaintext || formatRecordInput(rec),
      market_id,
      yes_shares: strip(d.yes_shares),
      no_shares:  strip(d.no_shares),
      entry_yes:  strip(d.entry_price_yes),
      entry_no:   strip(d.entry_price_no),
      timestamp:  strip(d.timestamp),
    };
  };

  // ── Fetch Position records from wallet + enrich with chain state ──────────
  const handleFetchPositions = async () => {
    if (!publicKey) { setError('Connect your Shield Wallet first'); return; }
    setLoading(true);
    setError('');
    try {
      console.log('Fetching records for program:', PROGRAM_ID);
      const rawRecords = await wallet.adapter.requestRecords(PROGRAM_ID);
      console.log(`Pool contains ${rawRecords?.length || 0} total records`);

      // 1. Initial filter for unspent Position records
      const candidates = (rawRecords || []).filter(r => r.recordName === 'Position' && !r.spent);
      console.log(`Found ${candidates.length} candidate Position records`);

      // 2. Decryption Pass: Sequential to avoid hammering the wallet with popups
      let decryptError = null;
      const decryptedRecords = [];

      for (const raw of candidates) {
        if (raw.data && Object.keys(raw.data).length > 0) {
          decryptedRecords.push(raw);
          continue;
        }

        if (raw.recordCiphertext) {
          console.log('Requesting decryption for Position record...');
          try {
            const adapter = wallet.adapter;
            let plaintext = null;
            if (adapter.decryptRecord) plaintext = await adapter.decryptRecord(raw.recordCiphertext);
            else if (adapter.decrypt) plaintext = await adapter.decrypt(raw.recordCiphertext);

            if (plaintext) {
               decryptedRecords.push({ ...raw, plaintext });
            } else {
               decryptedRecords.push(raw);
            }
            // Small delay to let wallet UI breathe
            await new Promise(r => setTimeout(r, 300));
          } catch (e) {
            console.warn('Decryption failed for record:', e);
            if (e.message?.includes('Decryption not allowed')) {
              decryptError = e.message;
            }
            decryptedRecords.push(raw);
          }
        } else {
          decryptedRecords.push(raw);
        }
      }

      if (decryptError && decryptedRecords.filter(r => r.plaintext || r.data).length === 0) {
        throw new Error(decryptError);
      }

      // 3. Final filter: must have data OR plaintext content
      const posRecords = decryptedRecords.filter(r =>
        (r.data && Object.keys(r.data).length > 0) || r.plaintext
      );

      console.log(`Ready to parse ${posRecords.length} records`);

      if (posRecords.length === 0) { setPositions([]); return; }

      const enriched = await Promise.all(posRecords.map(async (rec) => {
        const parsed = parseRecord(rec);
        if (!parsed.market_id) return null;

        console.log('Enriching position for market:', parsed.market_id);

        let chain = { yes_pool: 0, no_pool: 0, vault: 0, state: 0, resolved: false, result: false, winning_pool: 0 };
        try {
          chain = await fetchMarketState(parsed.market_id);
        } catch (e) {
          console.error(`Failed to fetch state for market ${parsed.market_id}:`, e);
        }

        return {
          ...parsed,
          ...chain,
          question: `Market ${parsed.market_id.slice(0, 14)}…`,
          recordKey: `${parsed.recordId}-${parsed.yes_shares > 0 ? 'YES' : 'NO'}`,
        };
      }));

      setPositions(enriched.filter(p => p !== null));
    } catch (err) {
      console.error('CRITICAL: handleFetchPositions error:', err);
      if (err.message?.includes('Decryption not allowed')) {
        setError('Shield Wallet Error: "Decryption not allowed". Please ensure "Allow Decrypt" is enabled in your Wallet Settings, or use Manual Import below.');
        setShowManual(true);
      } else {
        setError(`Failed to fetch positions: ${err.message || 'Check browser console for details'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleManualImport = async (plaintextInput = manualRecord.trim()) => {
    if (!plaintextInput) return;
    setLoading(true);
    setError('');
    try {
      const rec = { plaintext: plaintextInput, spent: false };
      const parsed = parseRecord(rec);
      if (!parsed.market_id || (!parsed.yes_shares && !parsed.no_shares)) {
        throw new Error('Invalid record format. Ensure you copied the full Position record.');
      }
      const chain = await fetchMarketState(parsed.market_id);
      const enriched = {
        ...parsed, ...chain,
        question: `Imported Market ${parsed.market_id.slice(0, 14)}…`,
        recordKey: `manual-${Date.now()}`
      };
      setPositions(prev => [enriched, ...prev]);
      setManualRecord('');
      setShowManual(false);
    } catch (e) {
      console.error('Manual import failed:', e);
      setError('Import failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── 5. Scan Explorer (Blockchain Scanner) ──────────────────────────────────
  const handleScanExplorer = async () => {
    if (!explorerTxId.trim()) return;
    setScanning(true);
    setError('');
    setTxStatus('');

    try {
      const id = explorerTxId.trim();
      // Try fetching as transaction first, then transition
      let txData = null;

      const endpoints = [
        `${EXPLORER}/transactions/${id}`,
        `${EXPLORER}/find/transition/${id}`
      ];

      for (const url of endpoints) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            txData = await res.json();
            break;
          }
        } catch {}
      }

      if (!txData) throw new Error('Transaction/Transition not found on Explorer. Is the ID correct?');

      // V2 structure: txData.execution.transitions or txData.transitions
      const transitions = txData.execution?.transitions || txData.transitions || (txData.transition ? [txData] : []);
      const newPotential = [];

      for (const t of transitions) {
        if (t.outputs) {
          for (const out of t.outputs) {
            // In Aleo V2 API, records are in 'value' and look like "record1..."
            const val = out.value || out.ciphertext;
            if (val && (val.startsWith('record1') || val.startsWith('ciphertext1'))) {
              newPotential.push({
                recordCiphertext: val,
                recordName: 'Position',
                programName: PROGRAM_ID,
                onChain: true
              });
            }
          }
        }
      }

      if (newPotential.length === 0) throw new Error('No ciphertexts found in this transaction.');

      setTxStatus(`Found ${newPotential.length} outputs. Attempting decryption...`);

      // Attempt decryption on found ciphertexts
      let successCount = 0;
      for (const raw of newPotential) { // Changed from 'positionRecords' to 'newPotential' as 'positionRecords' is not defined here.
        try {
          const adapter = wallet.adapter;
          let plaintext = null;
          // Add safety checks for wallet adapter decryption methods
          if (adapter && typeof adapter.decryptRecord === 'function') {
            plaintext = await adapter.decryptRecord(raw.recordCiphertext);
          } else if (adapter && typeof adapter.decrypt === 'function') {
            plaintext = await adapter.decrypt(raw.recordCiphertext);
          }

          if (plaintext) {
            await handleManualImport(plaintext); // Use the modified handleManualImport
            successCount++;
          }
        } catch (e) {
          console.warn('Scan decryption failed for one output:', e.message);
        }
      }

      if (successCount > 0) {
        setTxStatus(` Success! Decrypted ${successCount} record(s) from the blockchain.`);
        setExplorerTxId('');
        setShowManual(false);
      } else {
        setError('Found the transaction, but wallet could not decrypt the outputs. Are they yours?');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => { if (publicKey) handleFetchPositions(); }, [publicKey]); // eslint-disable-line

  // ── Sell shares ───────────────────────────────────────────────────────────
  // New contract: no expected_yes/no — uses live state in finalize.
  // Requires: min_payout_out (slippage) + deadline (block height).
  const handleSell = async (pos, sharesToSell, slippageBps = 50) => {
    const key = pos.recordKey;
    setAction(key, { loading: true, status: 'Fetching latest pool state…', error: '' });

    try {
      // Re-fetch live pools for slippage calculation
      const chain = await fetchMarketState(pos.market_id);
      const preview = ammSellPreview(chain.yes_pool, chain.no_pool, sharesToSell, pos.yes_shares > 0);
      const minPayout = Math.floor(preview.payout * (10_000 - slippageBps) / 10_000);

      // Deadline: current block + 20 (~5 min on Aleo testnet)
      // We don't have block height from API easily, use a safe estimate: timestamp-based fallback
      // Fetch current block height from explorer
      let deadline = 999_999_999; // fallback — won't expire
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const bRes = await fetch(`${EXPLORER}/block/height/latest`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (bRes.ok) { const b = await bRes.json(); deadline = (parseInt(b) || 0) + 20; }
      } catch { /* use fallback */ }

      setAction(key, { status: 'Submitting sell_shares…' });
      const tx = createAleoTransaction(
        publicKey,
        PROGRAM_ID,
        'sell_shares',
        [
          `${pos.market_id}`,
          pos.plaintext,
          `${pos.yes_shares > 0}`,           // private outcome — ZK-hidden ✓
          `${sharesToSell}u64`,               // private share_amount — ZK-hidden ✓
          `${minPayout}u64`,                  // min_payout_out (slippage guard)
          `${deadline}u32`,                   // block height deadline
        ],
        2_000_000
      );
      const txId = extractTxId(await wallet.adapter.executeTransaction(tx));
      setAction(key, {
        loading: false,
        status: ` Sell submitted! TX: ${txId}. Call Withdraw once confirmed.`,
      });
    } catch (err) {
      setAction(key, { loading: false, error: err.message || 'Sell failed.' });
    }
  };

  // ── Claim winnings ────────────────────────────────────────────────────────
  // New contract: returns Future only — credits claimable mapping.
  // User must call withdraw() after.
  const handleClaim = async (pos) => {
    const key = pos.recordKey;
    setAction(key, { loading: true, status: 'Computing payout…', error: '' });

    try {
      // Re-fetch live state for accurate payout calculation
      const chain = await fetchMarketState(pos.market_id);
      const userShares = chain.result ? pos.yes_shares : pos.no_shares;
      if (!userShares) {
        setAction(key, { loading: false, error: 'You hold the losing side — no payout.' });
        return;
      }

      const expectedPayout = computeExpectedPayout(userShares, chain.winning_pool, chain.vault);
      if (!expectedPayout) {
        setAction(key, { loading: false, error: 'Payout computed as 0 — market may be empty.' });
        return;
      }

      setAction(key, { status: 'Submitting claim_winnings…' });
      const tx = createAleoTransaction(
        publicKey,
        PROGRAM_ID,
        'claim_winnings',
        [
          pos.plaintext,
          `${pos.market_id}`,
          `${expectedPayout}u128`,
        ],
        2_000_000
      );
      const txId = extractTxId(await wallet.adapter.executeTransaction(tx));
      setAction(key, {
        loading: false,
        status: ` Claim submitted! TX: ${txId}. Now call Withdraw to receive funds.`,
        pendingWithdraw: expectedPayout.toString(),
      });
    } catch (err) {
      setAction(key, { loading: false, error: err.message || 'Claim failed.' });
    }
  };

  // ── Withdraw (after sell or claim) ───────────────────────────────────────
  // Transfers claimable balance to user's public USDCx balance.
  const handleWithdraw = async (pos, amount) => {
    const key = pos.recordKey;
    setAction(key, { loading: true, status: 'Submitting withdraw…', error: '' });
    try {
      const tx = createAleoTransaction(
        publicKey,
        PROGRAM_ID,
        'withdraw',
        [
          `${pos.market_id}`,
          `${amount}u128`,
        ],
        1_000_000
      );
      const txId = extractTxId(await wallet.adapter.executeTransaction(tx));
      setAction(key, {
        loading: false,
        status: ` Withdrawn! TX: ${txId}. USDCx is now in your public balance.`,
        pendingWithdraw: null,
      });
    } catch (err) {
      setAction(key, { loading: false, error: err.message || 'Withdraw failed.' });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">My Positions</h2>
        <p className="text-gray-600 dark:text-gray-400">Your encrypted USDCx positions on PrivyMarkets.</p>
      </div>

      {!publicKey ? (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <p className="text-yellow-800 dark:text-yellow-200">Connect your Shield Wallet to view positions.</p>
        </div>
      ) : (
        <button onClick={handleFetchPositions} disabled={loading}
          className="mb-6 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors">
          {loading ? 'Fetching…' : 'Refresh Positions'}
        </button>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <p className="text-red-800 dark:text-red-200">{error}</p>
          {error.includes('Decryption not allowed') && (
             <div className="text-xs mt-3 space-y-2 text-red-600 dark:text-red-400 border-t border-red-200 dark:border-red-800/50 pt-3">
               <p className="font-bold">How to fix this in Shield Wallet:</p>
               <ol className="list-decimal ml-4 space-y-1">
                 <li>Open the Shield Extension.</li>
                 <li>Click the <strong>Gear Icon (Settings)</strong> &rarr; <strong>Managed Sites</strong> (or Permissions).</li>
                 <li>Find <code>localhost</code> in the list.</li>
                 <li>Click where it says <strong className="bg-red-100 px-1">"NO decrypt"</strong> and change it to <strong className="bg-green-100 px-1">"Decrypt upon request"</strong>.</li>
                 <li>Refresh this page and click "Refresh Positions".</li>
               </ol>
             </div>
          )}
        </div>
      )}

      {showManual && (
        <div className="mb-8 p-6 bg-slate-50 dark:bg-slate-800 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Manual Position Import</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            If your wallet blocks automated decryption, you can paste the record manually.
            Open Shield Wallet &rarr; <strong>Records</strong> &rarr; find a <strong>Position</strong> record &rarr; <strong>Copy Plaintext</strong>.
          </p>
          <textarea
            className="w-full p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-mono text-sm mb-4"
            rows="5"
            placeholder="{ owner: ..., market_id: ..., yes_shares: ..., ... }"
            value={manualRecord}
            onChange={(e) => setManualRecord(e.target.value)}
          />
          <div className="flex gap-3">
            <button onClick={handleManualImport} disabled={!manualRecord.trim() || loading}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-semibold">
              Import Position
            </button>
            <button onClick={() => setShowManual(false)} className="px-6 py-2 text-slate-600 dark:text-slate-400 font-medium">
              Cancel
            </button>
          </div>

          {txStatus && (
            <div className="mt-3 p-3 rounded-lg bg-green-900/30 border border-green-700 text-green-300 text-xs break-all">
              {txStatus}
            </div>
          )}

          <div className="mt-6 border-t border-blue-100 dark:border-blue-900 pt-4">
            <p className="font-bold text-sm text-blue-800 dark:text-blue-200 mb-1">
              Option 2: Pull from Blockchain
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mb-3">
              Find your transaction on{' '}
              <a
                href={`https://testnet.aleoscan.io/address?id=${publicKey}`}
                target="_blank"
                rel="noreferrer"
                className="underline font-bold"
              >
                AleoScan
              </a>, copy the Transaction ID (at1...), and paste it here:
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 p-2 text-xs font-mono border rounded-lg dark:bg-slate-900 dark:border-slate-700"
                placeholder="at1..."
                value={explorerTxId}
                onChange={(e) => setExplorerTxId(e.target.value)}
              />
              <button
                onClick={handleScanExplorer}
                disabled={scanning || !explorerTxId}
                className="px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded-lg disabled:opacity-50"
              >
                {scanning ? 'Scanning...' : 'Scan & Decrypt'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-slate-800 dark:text-white">Active Positions</h3>
        {!showManual && (
          <button onClick={() => setShowManual(true)} className="text-sm text-purple-600 hover:text-purple-700 font-medium">
            + Manual Import
          </button>
        )}
      </div>

      {positions.length === 0 && !loading && publicKey && (
        <div className="text-center py-12 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-2">No positions found</h3>
          <p className="text-gray-500 dark:text-gray-400">Place a bet to create your first position.</p>
        </div>
      )}

      <div className="space-y-6">
        {positions.map((pos) => {
          const key       = pos.recordKey;
          const act       = actionState[key] || {};
          const hasYes    = pos.yes_shares > 0;
          const side      = hasYes ? 'YES' : 'NO';
          const shares    = hasYes ? pos.yes_shares : pos.no_shares;
          const winner    = pos.resolved ? (pos.result ? hasYes : !hasYes) : null;
          const totalPool = (pos.yes_pool || 0) + (pos.no_pool || 0);
          const yesOdds   = totalPool > 0
            ? Math.round((pos.yes_pool / totalPool) * 100) : 50;

          // Sell preview (0.5% default slippage)
          const sellP = pos.state === 0 && shares > 0
            ? ammSellPreview(pos.yes_pool, pos.no_pool, shares, hasYes) : null;
          const minPayout = sellP ? Math.floor(sellP.payout * 0.995) : 0;

          // Claim payout estimate
          const claimPayout = pos.resolved && winner
            ? computeExpectedPayout(shares, pos.winning_pool, pos.vault) : null;

          return (
            <div key={key}
              className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">

              {/* Header */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  pos.state === 3
                    ? 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300'
                    : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                }`}>{STATE_LABEL[pos.state] ?? 'Unknown'}</span>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  hasYes
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                }`}>{side}</span>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">{pos.question}</h3>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 mb-4 p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg text-sm">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Shares</p>
                  <p className="font-semibold text-gray-900 dark:text-white">{shares.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Entry price</p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {(hasYes ? pos.entry_yes : pos.entry_no) > 0
                      ? `${((hasYes ? pos.entry_yes : pos.entry_no) / 100).toFixed(1)}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Current odds</p>
                  <p className="font-semibold text-gray-900 dark:text-white">{yesOdds}% YES</p>
                </div>
              </div>

              {/* Sell preview */}
              {sellP && (
                <div className="mb-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Sell all shares → </span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    ~{(sellP.payout / 1e6).toFixed(6)} USDCx
                  </span>
                  <span className="text-xs text-gray-400 ml-2">(0.5% slippage guard applied)</span>
                </div>
              )}

              {/* Resolution status */}
              {pos.resolved ? (
                <div className={`mb-4 p-4 rounded-lg border ${
                  winner
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700'
                }`}>
                  {winner
                    ? <p className="text-green-800 dark:text-green-200 font-semibold">
                        🎉 You Won! · Market resolved {pos.result ? 'YES' : 'NO'}
                        {claimPayout ? ` · ~${(Number(claimPayout) / 1e6).toFixed(4)} USDCx` : ''}
                      </p>
                    : <p className="text-gray-600 dark:text-gray-400">
                        Market resolved {pos.result ? 'YES' : 'NO'} · Your {side} position did not win
                      </p>
                  }
                </div>
              ) : (
                <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
                  ⏳ Market open — resolution pending
                </div>
              )}

              {/* ── Action buttons ──────────────────────────────────────── */}
              <div className="flex flex-wrap gap-3">

                {/* SELL (market open) */}
                {pos.state === 0 && shares > 0 && (
                  <button
                    onClick={() => handleSell(pos, shares, 50)}
                    disabled={act.loading}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">
                    {act.loading ? 'Submitting…' : `Sell All ${side} Shares`}
                  </button>
                )}

                {/* CLAIM (resolved, winner) */}
                {pos.resolved && winner && !act.pendingWithdraw && (
                  <button
                    onClick={() => handleClaim(pos)}
                    disabled={act.loading}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 transition-colors">
                    {act.loading ? 'Submitting…' : '🏆 Claim Winnings'}
                  </button>
                )}

                {/* WITHDRAW (after sell or claim) */}
                {act.pendingWithdraw && (
                  <button
                    onClick={() => handleWithdraw(pos, act.pendingWithdraw)}
                    disabled={act.loading}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 transition-colors">
                    {act.loading ? 'Withdrawing…' : `Withdraw ${(Number(act.pendingWithdraw) / 1e6).toFixed(4)} USDCx`}
                  </button>
                )}
              </div>

              {/* Action feedback */}
              {act.status && (
                <div className="mt-3 p-3 rounded-lg bg-green-900/30 border border-green-700 text-green-300 text-xs break-all">
                  {act.status}
                </div>
              )}
              {act.error && (
                <div className="mt-3 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-xs">
                  {act.error}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {positions.length > 0 && (
        <div className="mt-8 p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg text-sm text-purple-800 dark:text-purple-200">
          🔒 <strong>Privacy Protected:</strong> Only you can see these positions.
          Your bets and amounts are fully encrypted via ZK proofs.
        </div>
      )}
    </div>
  );
}

export default MyPositions;
