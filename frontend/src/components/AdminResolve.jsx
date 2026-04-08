import { useState, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { fetchFromIPFS } from '../utils/ipfs';
import { createAleoTransaction } from "../core/transaction-helper.js";

const PROGRAM_ID = 'privymarket_v5.aleo';
const EXPLORER   = 'https://api.provable.com/v2/testnet';

// ── Strip Leo type suffixes ──────────────────────────────────────────────────
// Records return values like "123456field.private" or "0u8.public" — strip them.
const stripSuffix = (v) =>
  v == null ? '' : String(v).replace(/\.(private|public)$/, '').trim();

// ── Fetch a single mapping value from the explorer with 5s timeout ──────────
const fetchMapping = async (mappingName, key) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  // CRITICAL: Aleo explorer mapping keys MUST end with "field"
  const cleanKey = key.toString().trim().endsWith('field') ? key : `${key}field`;
  const url = `${EXPLORER}/program/${PROGRAM_ID}/mapping/${mappingName}/${cleanKey}`;

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const v = await res.json();

    // V2 returns { value: "..." }
    const s = v.value?.toString().trim().replace(/"/g, '') || v?.toString().trim().replace(/"/g, '');
    if (s === 'true')  return true;
    if (s === 'false') return false;
    const m = s.match(/(-?\d+)/);
    return m ? +m[1] : null;
  } catch (e) {
    if (e.name === 'AbortError') console.warn(`[AdminResolve] Fetch ${mappingName} (${cleanKey}) timed out`);
    else console.warn(`[AdminResolve] Fetch ${mappingName} error:`, e);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

// ── Fetch live pool + state for a market ────────────────────────────────────
const fetchMarketChainState = async (marketId) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const [yes, no, state, result] = await Promise.all([
      fetchMapping('yes_pools',     marketId, controller.signal),
      fetchMapping('no_pools',      marketId, controller.signal),
      fetchMapping('market_states', marketId, controller.signal),
      fetchMapping('market_results', marketId, controller.signal),
    ]);
    return {
      yes_pool: yes  ?? 0,
      no_pool:  no   ?? 0,
      state:    state ?? 0,
      result:   result === 1,
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

// ── Format AdminCap record for contract input ────────────────────────────────
const formatAdminCapInput = (record) => {
  if (!record) return '';
  if (typeof record === 'string') return record;
  if (record.plaintext) return record.plaintext;
  const data = record.data || {};
  const owner = record.owner || data.owner;
  const nonce = record.nonce || record._nonce || data.nonce || data._nonce;
  if (owner && nonce) {
    const version = data._version || '1u8.public';
    return `{\n  owner: ${owner}.private,\n  _nonce: ${nonce},\n  _version: ${version}\n}`;
  }
  if (record.recordCiphertext) return record.recordCiphertext;
  return JSON.stringify(record);
};

// ── State helpers ────────────────────────────────────────────────────────────
const STATE_LABEL = { 0: 'Open', 1: 'Paused', 3: 'Resolved' };
const STATE_CLASS  = {
  0: 'bg-green-100  text-green-800',
  1: 'bg-yellow-100 text-yellow-800',
  3: 'bg-gray-100   text-gray-800',
};

// ── Implied YES probability (Fixed: YES = yes_pool / total) ──────────────────
const impliedYesPct = (yes, no) => {
  const total = yes + no;
  return total === 0 ? 50 : Math.round((yes / total) * 100);
};

// ── AdminResolve Component ──────────────────────────────────────────────────
function AdminResolve() {
  const { wallet, address: publicKey } = useWallet();

  const [markets,   setMarkets]   = useState([]);
  const [adminCap,  setAdminCap]  = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [resolving, setResolving] = useState(null);
  const [error,     setError]     = useState('');
  const [txStatus,  setTxStatus]  = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualText, setManualText] = useState('');
  const [explorerTxId, setExplorerTxId] = useState('');
  const [scanning, setScanning] = useState(false);

  const extractTxId = (r) =>
    typeof r === 'string' ? r : (r?.transactionId ?? JSON.stringify(r));

  // ── Fetch and Decrypt Records ─────────────────────────────────────────────
  const handleFetchMarkets = async () => {
    if (!publicKey) { setError('Connect your wallet first.'); return; }
    setLoading(true);
    setError('');
    setTxStatus('');

    try {
      const rawRecords = await wallet.adapter.requestRecords(PROGRAM_ID);
      console.log('[AdminResolve] fetched records:', rawRecords?.length);

      // 1. Decrypt AdminCap sequentially
      let activeAdminCap = null;
      const capCandidates = (rawRecords || []).filter(r => r.recordName === 'AdminCap' && !r.spent);

      for (const rec of capCandidates) {
        if (rec.data && Object.keys(rec.data).length > 0) {
          activeAdminCap = rec;
          break;
        }
        if (rec.recordCiphertext) {
          try {
            const adapter = wallet.adapter;
            const dec = adapter.decryptRecord
              ? await adapter.decryptRecord(rec.recordCiphertext)
              : (adapter.decrypt ? await adapter.decrypt(rec.recordCiphertext) : null);
            if (dec) { activeAdminCap = { ...rec, plaintext: dec }; break; }
          } catch (e) { console.warn('AdminCap decrypt failed', e); }
        }
      }
      setAdminCap(activeAdminCap);

      // 2. Filter MarketInfo
      const infoCandidates = (rawRecords || []).filter(r => r.recordName === 'MarketInfo' && !r.spent);

      // 3. Decrypt MarketInfo sequentially
      const decryptedInfos = [];
      for (const rec of infoCandidates) {
        if (rec.data && Object.keys(rec.data).length === 0 && rec.plaintext) { // Already decrypted by wallet
          decryptedInfos.push(rec);
          continue;
        }
        if (rec.recordCiphertext) {
          try {
            const adapter = wallet.adapter;
            const dec = adapter.decryptRecord
              ? await adapter.decryptRecord(rec.recordCiphertext)
              : (adapter.decrypt ? await adapter.decrypt(rec.recordCiphertext) : null);
            if (dec) decryptedInfos.push({ ...rec, plaintext: dec });
          } catch (e) { console.warn('MarketInfo decrypt failed', e); }
        }
        await new Promise(r => setTimeout(r, 100)); // breathe
      }

      if (decryptedInfos.length === 0) {
        setMarkets([]);
        if (infoCandidates.length > 0) {
          setError('Could not decrypt MarketInfo records. Ensure "Allow Decrypt" is enabled in Shield Settings.');
        }
        return;
      }

      // 4. Enrich
      const enriched = await Promise.all(decryptedInfos.map(async (rec) => {
        let d = rec.data || {};

        // Manual parse if only plaintext exists
        if (Object.keys(d).length === 0 && rec.plaintext) {
          const pairs = rec.plaintext.match(/(\w+):\s*([^,{}]+)/g);
          if (pairs) pairs.forEach(p => {
            const [k, v] = p.split(':').map(s => s.trim());
            d[k] = v;
          });
        }

        const marketId = stripSuffix(d.market_id);
        const metaCid  = stripSuffix(d.metadata_cid);
        if (!marketId) return null;

        let question = 'Unknown market';
        let category = 'General';
        let image    = null;
        if (metaCid) {
          try {
            const meta = await fetchFromIPFS(metaCid);
            question = meta?.question || question;
            category = meta?.category || category;
            image    = meta?.image    || null;
          } catch {}
        }

        const chain = await fetchMarketChainState(marketId);

        return {
          market_id: marketId,
          record: rec,
          question,
          category,
          image,
          resolution_time: parseInt(stripSuffix(d.resolution_time)) || 0,
          ...chain,
        };
      }));

      setMarkets(enriched.filter(m => m !== null));
    } catch (err) {
      console.error('[AdminResolve] error:', err);
      setError(err.message?.includes('Decryption not allowed')
        ? 'Decryption not allowed. Enable it in Shield Settings.'
        : `Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleManualImport = async () => {
    if (!manualText.trim()) return;
    try {
      setError('');
      let d = {};
      const pairs = manualText.match(/(\w+):\s*([^,{}]+)/g);
      if (pairs) pairs.forEach(p => {
        const [k, v] = p.split(':').map(s => s.trim());
        d[k] = v;
      });

      if (manualText.includes('AdminCap')) {
        setAdminCap({ plaintext: manualText, recordName: 'AdminCap' });
        setTxStatus('✅ AdminCap imported manually!');
        setManualText('');
        setShowManual(false);
        return;
      }

      const marketId = stripSuffix(d.market_id);
      if (!marketId) throw new Error('Could not find market_id in plaintext.');

      setLoading(true);
      const chain = await fetchMarketChainState(marketId);
      const metaCid = stripSuffix(d.metadata_cid);
      let question = 'Manually Imported Market';
      if (metaCid) {
        try {
          const meta = await fetchFromIPFS(metaCid);
          question = meta?.question || question;
        } catch {}
      }

      const newM = {
        market_id: marketId,
        record: { plaintext: manualText },
        question,
        resolution_time: parseInt(stripSuffix(d.resolution_time)) || 0,
        ...chain,
      };

      setMarkets(prev => {
        const exists = prev.find(m => m.market_id === marketId);
        if (exists) return prev.map(m => m.market_id === marketId ? newM : m);
        return [...prev, newM];
      });

      setManualText('');
      setShowManual(false);
      setTxStatus('✅ Market imported manually!');
    } catch (e) {
      setError('Import failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── 5. Scan Explorer (Blockchain Scanner) ──────────────────────────────────
  const handleScanExplorer = async () => {
    if (!explorerTxId.trim() || !wallet?.adapter) return;
    setScanning(true);
    setError('');
    setTxStatus('');

    try {
      const scanId = explorerTxId.trim();
      let txData = null;
      const endpoints = [
        `${EXPLORER}/transactions/${scanId}`,
        `${EXPLORER}/find/transition/${scanId}`
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

      if (!txData) throw new Error('Transaction/Transition not found on Explorer.');

      // V2 structure: execution.transitions
      const transitions = txData.execution?.transitions || txData.transitions || (txData.transition ? [txData] : []);
      const newPotential = [];

      for (const t of transitions) {
        if (t.outputs) {
          for (const out of t.outputs) {
            const val = out.value || out.ciphertext;
            if (val && (val.startsWith('record1') || val.startsWith('ciphertext1'))) {
              newPotential.push(val);
            }
          }
        }
      }

      if (newPotential.length === 0) throw new Error('No ciphertexts found.');

      setTxStatus(`Found ${newPotential.length} outputs. Attempting decryption...`);

      let successCount = 0;
      let decryptBlockedByWallet = false;
      for (const ciphertext of newPotential) {
        try {
          const adapter = wallet.adapter;
          const plaintext = adapter.decryptRecord
            ? await adapter.decryptRecord(ciphertext)
            : (adapter.decrypt ? await adapter.decrypt(ciphertext) : null);

          if (plaintext) {
            let d = {};
            const pairs = plaintext.match(/(\w+):\s*([^,{}]+)/g);
            if (pairs) pairs.forEach(p => {
              const [k, v] = p.split(':').map(s => s.trim());
              d[k] = v;
            });

            if (plaintext.includes('AdminCap')) {
              setAdminCap({ plaintext, recordName: 'AdminCap' });
              successCount++;
            } else if (plaintext.includes('MarketInfo')) {
              const marketId = stripSuffix(d.market_id);
              if (marketId) {
                const chain = await fetchMarketChainState(marketId);
                const metaCid = stripSuffix(d.metadata_cid);
                let question = 'Explorer Imported Market';
                if (metaCid) {
                  try {
                    const meta = await fetchFromIPFS(metaCid);
                    question = meta?.question || question;
                  } catch {}
                }
                const newM = {
                  market_id: marketId,
                  record: { plaintext },
                  question,
                  resolution_time: parseInt(stripSuffix(d.resolution_time)) || 0,
                  ...chain,
                };
                setMarkets(prev => {
                  const exists = prev.find(m => m.market_id === marketId);
                  if (exists) return prev.map(m => m.market_id === marketId ? newM : m);
                  return [...prev, newM];
                });
                successCount++;
              }
            }
          }
        } catch (e) {
          console.warn('Scan decryption failed for one output:', e.message);
          if (e.message?.includes('Decryption not allowed')) {
            decryptBlockedByWallet = true;
          }
        }
      }

      if (successCount > 0) {
        setTxStatus(` Success! Imported ${successCount} record(s) from blockchain.`);
        setExplorerTxId('');
        setShowManual(false);
      } else if (decryptBlockedByWallet) {
        setError('Found the transaction, but Shield Wallet blocked decryption. Please enable "Allow Decrypt" in your Wallet Settings.');
      } else {
        setError('Transaction found, but no relevant records (AdminCap/MarketInfo) could be decrypted. Are they yours?');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  };

  // Fetch on mount when wallet connects
  useEffect(() => {
    if (publicKey) handleFetchMarkets();
  }, [publicKey]); // eslint-disable-line

  // ── Resolve ──────────────────────────────────────────────────────────────
  const handleResolve = async (market, outcome) => {
    if (!publicKey)  { setError('Connect your wallet first.'); return; }
    if (!adminCap)   { setError('No AdminCap loaded — click Refresh first.'); return; }

    setResolving(market.market_id);
    setError('');
    setTxStatus('');

    try {
      const adminCapInput = formatAdminCapInput(adminCap);

      // market_id already stripped of suffixes in fetchMarkets.
      // Ensure it ends with "field" as Leo expects.
      const marketIdInput = market.market_id.endsWith('field')
        ? market.market_id
        : `${market.market_id}field`;

      console.log('[AdminResolve] resolve_market inputs:', {
        adminCapInput,
        marketIdInput,
        outcome,
      });

      const tx = createAleoTransaction(
        publicKey,
        PROGRAM_ID,
        'resolve_market',
        [
          adminCapInput,
          marketIdInput,    // public market_id: field
          `${outcome}`,     // public winning_outcome: bool
        ],
        2_000_000,          // 2 Aleo credits — was 5000 (0.005) which is far too low
        false
      );

      setTxStatus('Submitting resolve_market…');
      const txId = extractTxId(await wallet.adapter.executeTransaction(tx));
      setTxStatus(`✅ Resolved! TX: ${txId}\nWinner: ${outcome ? 'YES' : 'NO'}`);

      // Optimistic state update
      setMarkets(prev => prev.map(m =>
        m.market_id === market.market_id
          ? { ...m, state: 3, result: outcome }
          : m
      ));
    } catch (err) {
      console.error('[AdminResolve] resolve error:', err);
      setError('Failed to resolve: ' + (err.message || JSON.stringify(err)));
    } finally {
      setResolving(null);
    }
  };

  // ── Pause / Resume ───────────────────────────────────────────────────────
  const handlePause = async (market) => {
    if (!adminCap) { setError('No AdminCap loaded.'); return; }
    setResolving(market.market_id);
    setError('');
    try {
      const tx = createAleoTransaction(
        publicKey, PROGRAM_ID,
        market.state === 0 ? 'pause_market' : 'resume_market',
        [
          formatAdminCapInput(adminCap),
          market.market_id.endsWith('field') ? market.market_id : `${market.market_id}field`,
        ],
        1_000_000,
        false
      );
      const txId = extractTxId(await wallet.adapter.executeTransaction(tx));
      setTxStatus(`TX: ${txId}`);
      setMarkets(prev => prev.map(m =>
        m.market_id === market.market_id
          ? { ...m, state: m.state === 0 ? 1 : 0 }
          : m
      ));
    } catch (err) {
      setError('Failed: ' + (err.message || JSON.stringify(err)));
    } finally {
      setResolving(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Resolve Markets</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {adminCap
              ? ' AdminCap loaded'
              : ' No AdminCap — connect wallet and click Refresh'}
          </p>
        </div>
        <button onClick={handleFetchMarkets} disabled={loading || !publicKey}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors">
          {loading ? 'Loading…' : 'Refresh Markets'}
        </button>
      </div>

      {/* Wallet gate */}
      {!publicKey && (
        <div className="p-4 mb-6 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
          Connect your wallet to view markets.
        </div>
      )}

      {/* Error / status */}
      {error    && <div className="p-4 mb-4 rounded-lg bg-red-50   border border-red-200   text-red-700   text-sm">{error}</div>}
      {txStatus && <div className="p-4 mb-4 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm whitespace-pre-wrap">{txStatus}</div>}

      {/* Markets */}
      <div className="space-y-4">
        {error.includes('decrypt') && (
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg mb-4">
             <div className="flex items-center justify-between">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Wallet blocked? You can import records manually.
                </p>
                <button
                  onClick={() => setShowManual(!showManual)}
                  className="text-sm font-bold text-blue-600 hover:underline"
                >
                  {showManual ? 'Close Import' : 'Open Manual Import'}
                </button>
             </div>

             {showManual && (
               <div className="mt-4 space-y-3">
                 <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                   Paste record plaintext from Shield Wallet &rarr; Records &rarr; Select Record &rarr; Copy Plaintext:
                 </p>
                 <textarea
                   className="w-full h-32 p-3 text-xs font-mono border rounded-lg dark:bg-slate-900 dark:border-slate-700"
                   placeholder="{ owner: aleo1..., market_id: ... }"
                   value={manualText}
                   onChange={(e) => setManualText(e.target.value)}
                 />
                 <div className="flex gap-2">
                   <button
                     onClick={handleManualImport}
                     className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg"
                   >
                     Import Record
                   </button>
                 </div>
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

        {markets.map((market) => {
          const yesPct      = impliedYesPct(market.yes_pool, market.no_pool);
          const isResolved  = market.state === 3;
          const canResolve  = market.state === 0 || market.state === 1;
          const isResolving = resolving === market.market_id;
          const resDate     = market.resolution_time
            ? new Date(market.resolution_time * 1000).toLocaleDateString()
            : '—';

          return (
            <div key={market.market_id}
              className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">

              {/* Title row */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 pr-4">
                  <div className="flex flex-wrap gap-2 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      market.category === 'Politics' ? 'bg-blue-100 text-blue-800' :
                      market.category === 'Crypto'   ? 'bg-orange-100 text-orange-800' :
                      market.category === 'Sports'   ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>{market.category}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATE_CLASS[market.state] ?? 'bg-gray-100 text-gray-800'}`}>
                      {STATE_LABEL[market.state] ?? 'Unknown'}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">{market.question}</h3>
                  <p className="text-xs text-gray-400 mt-1 font-mono truncate">ID: {market.market_id}</p>
                </div>
                {market.image && (
                  <img src={`https://gateway.pinata.cloud/ipfs/${market.image}`} alt=""
                    className="w-16 h-16 rounded-lg object-cover shrink-0"
                    onError={e => { e.target.style.display = 'none'; }} />
                )}
              </div>

              {/* Pool stats — pulled from chain */}
              <div className="grid grid-cols-4 gap-3 mb-4 p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg text-center text-sm">
                <div>
                  <div className="text-gray-400 text-xs mb-0.5">YES prob</div>
                  <div className="font-bold text-green-600">{yesPct}%</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs mb-0.5">NO prob</div>
                  <div className="font-bold text-red-500">{100 - yesPct}%</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs mb-0.5">YES pool</div>
                  <div className="font-semibold text-gray-700 dark:text-gray-200">
                    {(market.yes_pool / 1_000_000).toFixed(2)} USDCx
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs mb-0.5">NO pool</div>
                  <div className="font-semibold text-gray-700 dark:text-gray-200">
                    {(market.no_pool / 1_000_000).toFixed(2)} USDCx
                  </div>
                </div>
              </div>

              {/* Resolution date */}
              <p className="text-xs text-gray-400 mb-4">Resolves: {resDate}</p>

              {/* Resolved banner */}
              {isResolved && (
                <div className={`mb-4 p-3 rounded-lg font-semibold text-sm ${
                  market.result
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-red-50   border border-red-200   text-red-800'
                }`}>
                  ✓ Resolved — {market.result ? 'YES' : 'NO'} wins
                </div>
              )}

              {/* Action buttons */}
              {canResolve && (
                <div className="flex gap-2">
                  <button onClick={() => handleResolve(market, true)}
                    disabled={isResolving || !adminCap}
                    className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors">
                    {isResolving ? 'Submitting…' : '✓ Resolve YES'}
                  </button>
                  <button onClick={() => handleResolve(market, false)}
                    disabled={isResolving || !adminCap}
                    className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors">
                    {isResolving ? 'Submitting…' : '✗ Resolve NO'}
                  </button>
                  <button onClick={() => handlePause(market)}
                    disabled={isResolving || !adminCap}
                    className="py-2 px-4 bg-slate-600 hover:bg-slate-700 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors">
                    {market.state === 0 ? 'Pause' : 'Resume'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AdminResolve;
