import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { PROGRAM_ID, USDCX_PROGRAM_ID } from "../core/constants.js";
import { requestTransaction, normalizeWalletError } from "../lib/walletAdapter.js";
import { addPosition } from "../lib/usePositionsStore.js";

// (extractTxId no longer needed — walletAdapter.requestTransaction returns a plain string)

// ─── AMM helpers — mirrors Leo finalize exactly ──────────────────────────────
//
// BUY YES:  money into YES pool → shares = old_NO - new_NO
// BUY NO:   money into NO pool  → shares = old_YES - new_YES
// SELL YES: shares into YES pool → payout = old_NO - new_NO  (wait, check sell)
// SELL YES: shares into YES pool → payout = old_YES - new_YES (YES payout from YES pool shrink)
//
// Invariant: k = yes_pool × no_pool

function ammBuy(yes, no, amount, outcome) {
  const y = BigInt(yes), n = BigInt(no), a = BigInt(amount);
  const k = y * n;
  if (outcome) {
    const newYes = y + a;
    const newNo  = k / newYes;
    return { shares: Number(n - newNo), newYes: Number(newYes), newNo: Number(newNo) };
  } else {
    const newNo  = n + a;
    const newYes = k / newNo;
    return { shares: Number(y - newYes), newYes: Number(newYes), newNo: Number(newNo) };
  }
}

function ammSell(yes, no, shares, outcome) {
  const y = BigInt(yes), n = BigInt(no), s = BigInt(shares);
  const k = y * n;
  if (outcome) {
    // SELL YES: shares return to YES pool, payout comes from YES pool shrink
    const newNo  = n + s;
    const newYes = k / newNo;
    return { payout: Number(y - newYes), newYes: Number(newYes), newNo: Number(newNo) };
  } else {
    // SELL NO: shares return to NO pool, payout comes from NO pool shrink
    const newYes = y + s;
    const newNo  = k / newYes;
    return { payout: Number(n - newNo), newYes: Number(newYes), newNo: Number(newNo) };
  }
}

function impliedProb(yes, no) {
  const total = yes + no;
  if (total === 0) return 50;
  // Standard AMM Price: Pool_A / (Pool_A + Pool_B)
  return Math.round((yes / total) * 100);
}

// ─── Slippage helpers ────────────────────────────────────────────────────────
const DEFAULT_SLIPPAGE_BPS = 50; // 0.5% default — same as Uniswap default

function applySlippage(amount, bps) {
  return Math.floor(amount * (10_000 - bps) / 10_000);
}

// Max payout if winner — (shares * vault_after) / win_pool_after
function maxWinPayout(preview, amtMicro, yesPool, noPool, outcome) {
  const vaultAfter   = yesPool + noPool + amtMicro;
  const winPoolAfter = outcome ? preview.newYes : preview.newNo;
  return (preview.shares * vaultAfter) / winPoolAfter;
}

// ────────────────────────────────────────────────────────────────────────────
function PredictionModal({ market, onClose }) {
  const { wallet, address: publicKey } = useWallet();

  const [position,      setPosition]      = useState(true);  // YES=true NO=false
  const [isBuy,         setIsBuy]         = useState(true);
  const [amount,        setAmount]        = useState('');
  const [sharesToSell,  setSharesToSell]  = useState('');
  const [posRecord,     setPosRecord]     = useState('');
  const [slippageBps,   setSlippageBps]   = useState(DEFAULT_SLIPPAGE_BPS);
  const [showSlippage,  setShowSlippage]  = useState(false);

  const [loading,        setLoading]        = useState(false);
  const [txStatus,       setTxStatus]       = useState('');
  const [txError,        setTxError]        = useState('');
  const [approved,       setApproved]       = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);

  // Pool state (micro-USDCx)
  const [yesPool,      setYesPool]      = useState(Math.floor((market.yes_pool || 0) * 1_000_000));
  const [noPool,       setNoPool]       = useState(Math.floor((market.no_pool  || 0) * 1_000_000));
  const [currentBlock, setCurrentBlock] = useState(0);

  // ── Fetch chain state ─────────────────────────────────────────────────────
  const fetchChainState = useCallback(async () => {
    if (!market.market_id) return null;
    const base = `https://api.provable.com/v2/testnet`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // Ensure mapping key ends with field
    const mid = market.market_id.toString().trim().endsWith('field')
      ? market.market_id
      : `${market.market_id}field`;

    try {
      const [yr, nr, br] = await Promise.all([
        window.fetch(`${base}/program/${PROGRAM_ID}/mapping/yes_pools/${mid}`, { signal: controller.signal }),
        window.fetch(`${base}/program/${PROGRAM_ID}/mapping/no_pools/${mid}`,  { signal: controller.signal }),
        window.fetch(`${base}/block/height/latest`, { signal: controller.signal }),
      ]);
      clearTimeout(timeoutId);
      let yes = yesPool, no = noPool, block = currentBlock;

      if (yr.status === 200) {
        const v = await yr.json();
        const s = v.value?.toString().replace(/"/g, "") || v?.toString().replace(/"/g, "");
        const m = s.match(/(\d+)/);
        if (m) yes = +m[1];
      }
      if (nr.status === 200) {
        const v = await nr.json();
        const s = v.value?.toString().replace(/"/g, "") || v?.toString().replace(/"/g, "");
        const m = s.match(/(\d+)/);
        if (m) no = +m[1];
      }
      if (br.status === 200) {
        const v = await br.json();
        const s = v.value?.toString().replace(/"/g, "") || v?.toString().replace(/"/g, "");
        const m = s.match(/(\d+)/);
        if (m) block = +m[1];
      }
      setYesPool(yes);
      setNoPool(no);
      setCurrentBlock(block);
      return { yes, no, block };
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        console.warn('Chain state fetch timed out');
      } else {
        console.warn('Chain state fetch error:', e);
      }
      return null;
    }
  }, [market.market_id]); // eslint-disable-line

  useEffect(() => { fetchChainState(); }, [market.market_id]); // eslint-disable-line

  // ── Derived values ────────────────────────────────────────────────────────
  const amtMicro    = Math.floor(parseFloat(amount      || '0') * 1_000_000);
  const sharesMicro = Math.floor(parseFloat(sharesToSell|| '0') * 1_000_000);

  const buyPreview  = amtMicro   >= 100_000 ? ammBuy (yesPool, noPool, amtMicro,    position) : null;
  const sellPreview = sharesMicro > 0        ? ammSell(yesPool, noPool, sharesMicro, position) : null;

  const yesPct = impliedProb(yesPool, noPool);
  const noPct  = 100 - yesPct;

  // Slippage-adjusted minimums — what gets submitted to contract
  const minSharesOut = buyPreview  ? applySlippage(buyPreview.shares,        slippageBps) : 0;
  const minPayoutOut = sellPreview ? applySlippage(sellPreview.payout,       slippageBps) : 0;

  // Max win payout for buy preview
  const winPayout    = buyPreview  ? maxWinPayout(buyPreview, amtMicro, yesPool, noPool, position) : 0;
  const slippagePct  = buyPreview  ? ((amtMicro - winPayout) / amtMicro) * 100 : 0;

  // Deadline = current block + 20 (~5 min on Aleo testnet)
  const DEADLINE_BLOCKS = 20;
  const deadline = currentBlock + DEADLINE_BLOCKS;

  const resetFlow = () => {
    setApproved(false);
    setTxStatus('');
    setTxError('');
  };

  // ── Step 1: Approve ───────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!publicKey)         { setTxError('Connect your wallet first.'); return; }
    if (amtMicro < 100_000) { setTxError('Minimum buy is 0.1 USDCx.'); return; }
    setTxError(''); setTxStatus('');
    setApproveLoading(true);
    setTxStatus('Requesting USDCx approval from wallet…');
    try {
      const txId = await requestTransaction(
        wallet?.adapter,
        {
          programId: USDCX_PROGRAM_ID,
          functionName: 'approve_public',
          inputs: [`${PROGRAM_ID}`, `${amtMicro}u128`],
          fee: 0.5,
        },
        publicKey
      );
      setApproved(true);
      setTxStatus(`✅ Approved! TX: ${txId}\nOnce confirmed on-chain (~30s), click Buy below.`);
    } catch (err) {
      setTxError(normalizeWalletError(err).message);
    } finally {
      setApproveLoading(false);
    }
  };

  // ── Step 2: Buy ───────────────────────────────────────────────────────────
  // Contract signature:
  //   buy_shares(market_id, amount, outcome, expected_yes, expected_no,
  //              min_shares_out, deadline, timestamp)
  const handleBuy = async () => {
    if (!publicKey) { setTxError('Connect your wallet first.'); return; }
    if (!approved)  { setTxError('Complete Step 1 (Approve) first.'); return; }
    setTxError(''); setTxStatus('');
    setLoading(true);
    try {
      setTxStatus('Fetching latest chain state…');
      const chain = await fetchChainState();

      const freshYes      = chain?.yes   ?? yesPool;
      const freshNo       = chain?.no    ?? noPool;
      const freshDeadline = (chain?.block ?? currentBlock) + DEADLINE_BLOCKS;
      const timestamp     = BigInt(Math.floor(Date.now() / 1000));

      // Compute min_shares_out from freshest pool snapshot
      const freshPreview = ammBuy(freshYes, freshNo, amtMicro, position);
      const freshMin     = applySlippage(freshPreview.shares, slippageBps);

      setTxStatus('Waiting for wallet approval (ZK proof may take 1-2 min)…');
      const txId = await requestTransaction(
        wallet?.adapter,
        {
          programId: PROGRAM_ID,
          functionName: 'buy_shares',
          inputs: [
            `${market.market_id}`,   // public market_id
            `${amtMicro}u128`,       // public amount
            `${position}`,           // private outcome — ZK hidden ✓
            `${freshYes}u64`,        // public expected_yes
            `${freshNo}u64`,         // public expected_no
            `${freshMin}u64`,        // public min_shares_out (slippage)
            `${freshDeadline}u32`,   // public deadline block
            `${timestamp}u64`,       // public timestamp
          ],
          fee: 2.0,
        },
        publicKey
      );
      setTxStatus(`✅ Buy submitted! TX: ${txId}\nYour Position record appears in your wallet once the block finalises.`);

      // Persist position immediately — shows up in MyPositions right away
      addPosition(publicKey, {
        txId,
        marketId:       market.market_id,
        marketQuestion: market.question,
        outcome:        position ? 'YES' : 'NO',
        amountMicro,
        shares:         freshPreview.shares,
      });

      // Optimistic pool update using the same snapshot sent to contract
      const p = ammBuy(freshYes, freshNo, amtMicro, position);
      setYesPool(p.newYes);
      setNoPool(p.newNo);
      setAmount('');
      resetFlow();
    } catch (err) {
      // If slippage revert — show helpful message
      const msg = err.message || '';
      if (msg.includes('assert') || msg.includes('revert')) {
        setTxError(
          `Transaction reverted — pool moved beyond your ${(slippageBps / 100).toFixed(1)}% slippage tolerance.\n` +
          `Increase slippage or try again with a fresh quote.`
        );
      } else {
        setTxError(msg || 'Transaction failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Sell ──────────────────────────────────────────────────────────────────
  const handleSell = async () => {
    if (!publicKey)        { setTxError('Connect your wallet first.'); return; }
    if (sharesMicro <= 0)  { setTxError('Enter shares to sell.'); return; }
    if (!posRecord.trim()) { setTxError('Paste your Position record.'); return; }
    setTxError(''); setTxStatus('');
    setLoading(true);
    try {
      setTxStatus('Fetching current block height…');
      const chain = await fetchChainState();
      const freshDeadline = (chain?.block ?? currentBlock) + DEADLINE_BLOCKS;

      // Recompute min_payout from fresh pools
      const freshSellPreview = ammSell(
        chain?.yes ?? yesPool,
        chain?.no  ?? noPool,
        sharesMicro,
        position
      );
      const freshMinPayout = applySlippage(freshSellPreview.payout, slippageBps);

      setTxStatus('Waiting for wallet approval (ZK proof may take 1-2 min)…');
      const txId = await requestTransaction(
        wallet?.adapter,
        {
          programId: PROGRAM_ID,
          functionName: 'sell_shares',
          inputs: [
            `${market.market_id}`,    // public market_id
            posRecord.trim(),          // private Position record — ZK hidden ✓
            `${position}`,             // private outcome — ZK hidden ✓
            `${sharesMicro}u64`,       // private share_amount — ZK hidden ✓
            `${freshMinPayout}u64`,    // public min_payout_out (slippage)
            `${freshDeadline}u32`,     // public deadline
          ],
          fee: 2.0,
        },
        publicKey
      );
      setTxStatus(`✅ Sell submitted! TX: ${txId}\nPayout appears in claimable balance — use Withdraw to collect.`);
      const sp = ammSell(chain?.yes ?? yesPool, chain?.no ?? noPool, sharesMicro, position);
      setYesPool(sp.newYes);
      setNoPool(sp.newNo);
      setSharesToSell('');
      setPosRecord('');
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('assert') || msg.includes('revert')) {
        setTxError(
          `Transaction reverted — pool moved beyond your ${(slippageBps / 100).toFixed(1)}% slippage tolerance.\n` +
          `Increase slippage or try again.`
        );
      } else {
        setTxError(msg || 'Transaction failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {market.image && (
          <img
            src={`https://gateway.pinata.cloud/ipfs/${market.image}`}
            alt={market.question}
            className="w-full h-40 object-cover rounded-t-xl"
            onError={e => { e.target.style.display = 'none'; }}
          />
        )}

        <div className="p-6">

          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex-1 pr-4">{market.question}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:text-slate-400 dark:hover:text-white shrink-0">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Pool state */}
          <div className="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <div className="text-gray-500 dark:text-slate-400 mb-1">YES pool</div>
              <div className="text-green-600 dark:text-green-400 font-semibold">{(yesPool / 1e6).toFixed(4)} USDCx</div>
            </div>
            <div>
              <div className="text-gray-500 dark:text-slate-400 mb-1">NO pool</div>
              <div className="text-red-600 dark:text-red-400 font-semibold">{(noPool / 1e6).toFixed(4)} USDCx</div>
            </div>
            <div>
              <div className="text-gray-500 dark:text-slate-400 mb-1">Block</div>
              <div className="text-gray-700 dark:text-slate-300 font-mono">{currentBlock || '—'}</div>
            </div>
          </div>

          {/* Buy / Sell tabs */}
          <div className="flex gap-1 mb-5 border-b-2 border-gray-100 dark:border-slate-700">
            {['Buy', 'Sell'].map((t, i) => (
              <button key={t}
                onClick={() => { setIsBuy(i === 0); resetFlow(); }}
                className={`flex-1 pb-3 text-base font-semibold transition-all ${
                  isBuy === (i === 0)
                    ? 'text-gray-900 dark:text-white border-b-2 border-cyan-500 -mb-0.5'
                    : 'text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-300'
                }`}>{t}</button>
            ))}
          </div>

          {/* YES / NO selector */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-300 mb-3">Select Outcome</label>
            <div className="grid grid-cols-2 gap-3">
              {[true, false].map(s => (
                <button key={String(s)} onClick={() => { setPosition(s); resetFlow(); }}
                  className={`px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                    position === s
                      ? s ? 'bg-green-600/30 border-2 border-green-500 text-green-700 dark:text-white'
                          : 'bg-red-600/30 border-2 border-red-500 text-red-700 dark:text-white'
                      : 'bg-gray-50 dark:bg-slate-800 border-2 border-gray-100 dark:border-slate-700 text-gray-400 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600'
                  }`}>
                  <div>{s ? 'YES' : 'NO'}</div>
                  <div className="text-xs font-normal opacity-80">{s ? yesPct : noPct}¢</div>
                </button>
              ))}
            </div>
          </div>

          {/* Slippage settings */}
          <div className="mb-4">
            <button
              onClick={() => setShowSlippage(v => !v)}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
            >
              ⚙️ Slippage tolerance: {(slippageBps / 100).toFixed(1)}%
              <span className="text-slate-600">{showSlippage ? '▲' : '▼'}</span>
            </button>
            {showSlippage && (
              <div className="mt-2 flex gap-2">
                {[25, 50, 100, 200].map(bps => (
                  <button key={bps}
                    onClick={() => setSlippageBps(bps)}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                      slippageBps === bps
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {(bps / 100).toFixed(1)}%
                  </button>
                ))}
                <input
                  type="number"
                  value={(slippageBps / 100).toFixed(1)}
                  onChange={e => setSlippageBps(Math.round(parseFloat(e.target.value || '0') * 100))}
                  className="w-16 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-white text-xs"
                  placeholder="0.5"
                  step="0.1"
                  min="0.1"
                  max="50"
                />
              </div>
            )}
          </div>

          {/* ── BUY FORM ──────────────────────────────────────────────────── */}
          {isBuy && (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">Amount (USDCx)</label>
                <input type="number" value={amount}
                  onChange={e => { setAmount(e.target.value); resetFlow(); }}
                  placeholder="0.00" min="0.1" step="0.1"
                  className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors" />
              </div>

              {/* Buy preview */}
              {buyPreview && (
                <div className="mb-4 space-y-2">
                  <div className="p-4 rounded-lg bg-slate-800 border border-slate-700 space-y-2 text-sm">

                    <div className="flex justify-between">
                      <span className="text-slate-400">Shares out (estimated)</span>
                      <div className="text-right">
                        <div className="text-white font-semibold">
                          {(buyPreview.shares / 1_000_000).toFixed(6)}
                        </div>
                        <div className="text-xs text-slate-500">
                          min guaranteed: {(minSharesOut / 1_000_000).toFixed(6)}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-400">Max payout if correct</span>
                      <span className={winPayout >= amtMicro ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                        {(winPayout / 1e6).toFixed(4)} USDCx
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-400">
                        New YES pool {position && <span className="text-green-500 text-xs">← in</span>}
                      </span>
                      <span className={position ? 'text-green-400' : 'text-white'}>
                        {(buyPreview.newYes / 1e6).toFixed(4)} USDCx
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-400">
                        New NO pool {!position && <span className="text-red-500 text-xs">← in</span>}
                      </span>
                      <span className={!position ? 'text-red-400' : 'text-white'}>
                        {(buyPreview.newNo / 1e6).toFixed(4)} USDCx
                      </span>
                    </div>

                    <div className="flex justify-between pt-1 border-t border-slate-700">
                      <span className="text-slate-400">New implied YES prob</span>
                      <span className="text-white">
                        {Math.round((buyPreview.newYes / (buyPreview.newYes + buyPreview.newNo)) * 100)}%
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-400">TX deadline</span>
                      <span className="text-slate-300 font-mono text-xs">
                        block {deadline} (~{DEADLINE_BLOCKS * 15}s)
                      </span>
                    </div>
                  </div>

                  {/* Slippage warning */}
                  {slippagePct > 5 && (
                    <div className={`p-3 rounded-lg border text-xs space-y-1 ${
                      slippagePct > 30
                        ? 'bg-red-900/40 border-red-600 text-red-300'
                        : 'bg-amber-900/40 border-amber-600 text-amber-300'
                    }`}>
                      <div className="font-bold text-sm">
                        {slippagePct > 30 ? '🚨' : '⚠️'} High price impact: {slippagePct.toFixed(1)}%
                      </div>
                      <div>
                        You pay <span className="font-semibold">{(amtMicro / 1e6).toFixed(4)} USDCx</span> but
                        max win is only <span className="font-semibold">{(winPayout / 1e6).toFixed(4)} USDCx</span>.
                      </div>
                      <div className="opacity-80">
                        Suggested max bet for &lt;5% impact:{' '}
                        <span className="font-semibold">
                          {((Math.min(yesPool, noPool) / 1e6) * 0.1).toFixed(2)} USDCx
                        </span>
                      </div>
                    </div>
                  )}

                  {slippagePct <= 5 && (
                    <div className="p-2 rounded-lg bg-green-900/20 border border-green-700/50 text-xs text-green-300">
                      ✓ Good trade size — price impact {slippagePct.toFixed(2)}%
                    </div>
                  )}
                </div>
              )}

              {/* Step 1: Approve */}
              <div className={`mb-3 p-4 rounded-lg border transition-all ${
                approved ? 'bg-green-900/20 border-green-500/40' : 'bg-amber-900/10 border-amber-700/40'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white ${approved ? 'bg-green-500' : 'bg-amber-500'}`}>
                    {approved ? '✓' : '1'}
                  </span>
                  <span className={`text-xs font-semibold ${approved ? 'text-green-300' : 'text-amber-300'}`}>
                    Approve USDCx {approved && '— done ✓'}
                  </span>
                </div>
                <button
                  onClick={handleApprove}
                  disabled={approveLoading || approved || amtMicro < 100_000}
                  className={`w-full py-2 px-4 rounded-lg text-xs font-semibold transition-all ${
                    approved
                      ? 'bg-green-600/20 text-green-400 cursor-default border border-green-500/30'
                      : approveLoading || amtMicro < 100_000
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  {approveLoading ? 'Approving…' : approved ? 'Approved ✓' : 'Step 1: Approve USDCx'}
                </button>
              </div>

              {/* Step 2: Buy */}
              <button
                onClick={handleBuy}
                disabled={loading || !approved || amtMicro < 100_000}
                className={`w-full py-3 px-6 rounded-lg font-semibold text-white text-sm transition-all shadow-lg ${
                  loading || !approved || amtMicro < 100_000
                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500'
                }`}
              >
                {loading ? 'Submitting…' : `Step 2: Buy ${position ? 'YES' : 'NO'}`}
              </button>
            </>
          )}

          {/* ── SELL FORM ─────────────────────────────────────────────────── */}
          {!isBuy && (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Shares to sell <span className="text-slate-500 font-normal">(human units)</span>
                </label>
                <input type="number" value={sharesToSell}
                  onChange={e => setSharesToSell(e.target.value)}
                  placeholder="1.200000" min="0" step="0.000001"
                  className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors" />
                <p className="text-xs text-slate-500 mt-1">
                  {sharesMicro > 0 && `= ${sharesMicro.toLocaleString()} micro-units`}
                </p>
              </div>

              {sellPreview && (
                <div className="mb-4 space-y-2">
                  <div className="p-4 rounded-lg bg-slate-800 border border-slate-700 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Estimated payout</span>
                      <div className="text-right">
                        <div className="text-green-400 font-semibold">
                          {(sellPreview.payout / 1e6).toFixed(6)} USDCx
                        </div>
                        <div className="text-xs text-slate-500">
                          min guaranteed: {(minPayoutOut / 1e6).toFixed(6)} USDCx
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">New YES pool</span>
                      <span className="text-white">{(sellPreview.newYes / 1e6).toFixed(4)} USDCx</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">New NO pool</span>
                      <span className="text-white">{(sellPreview.newNo / 1e6).toFixed(4)} USDCx</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  Paste your Position record
                </label>
                <textarea value={posRecord} onChange={e => setPosRecord(e.target.value)}
                  rows={4}
                  placeholder="{ owner: aleo1..., market_id: ...field.private, yes_shares: ...u64.private, ... }"
                  className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-green-600 dark:text-green-400 text-xs font-mono placeholder-gray-400 dark:placeholder-slate-600 focus:outline-none focus:border-cyan-500 resize-none" />
                <p className="text-xs text-slate-500 mt-1">
                  Find in your wallet under <strong>{PROGRAM_ID}</strong>.
                  Payout → <strong>claimable</strong> balance → use Withdraw to collect.
                </p>
              </div>

              <button onClick={handleSell}
                disabled={loading || sharesMicro <= 0 || !posRecord.trim()}
                className={`w-full py-3 px-6 rounded-lg font-semibold text-white text-sm transition-all ${
                  loading || sharesMicro <= 0 || !posRecord.trim()
                    ? 'bg-red-900 cursor-not-allowed opacity-50'
                    : 'bg-red-600 hover:bg-red-500'
                }`}>
                {loading ? 'Submitting…' : `Sell ${position ? 'YES' : 'NO'} shares`}
              </button>
            </>
          )}

          {/* Status / error */}
          {txError  && <div className="mt-4 p-3 rounded-lg bg-red-900/40 border border-red-700 text-red-300 text-sm whitespace-pre-wrap">{txError}</div>}
          {txStatus && (
            <div className="mt-4 p-3 rounded-lg bg-green-900/40 border border-green-700 text-green-300 text-sm break-all whitespace-pre-wrap flex flex-col gap-2">
              <div>{txStatus}</div>
              {txStatus.includes('submitted') && (
                <button
                  onClick={() => {
                    const cmd = `snarkos developer execute ${PROGRAM_ID} buy_shares "${market.market_id}" "${amtMicro}u128" "${position}" "${yesPool}u64" "${noPool}u64" "${minSharesOut}u64" "${deadline}u32" "${Math.floor(Date.now()/1000)}u64" --private-key YOUR_PRIVATE_KEY --query https://api.provable.com/v2/testnet --priority-fee 1000000`;
                    navigator.clipboard.writeText(cmd);
                    alert('CLI command copied to clipboard!\nRun this in snarkos if the wallet fails.');
                  }}
                  className="text-[10px] bg-green-800 hover:bg-green-700 text-white px-2 py-1 rounded w-fit font-mono"
                >
                  📋 Copy snarkos CLI command (Fallback)
                </button>
              )}
            </div>
          )}

          {/* Privacy note */}
          <div className="mt-5 p-3 rounded-lg bg-purple-900/30 border border-purple-700 text-sm text-purple-300 flex items-start gap-2">
            <span>
              <strong>ZK Privacy:</strong> your bet direction (<code>outcome</code>) is a private input —
              never visible in any transaction on-chain. Only the ZK proof is broadcast.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PredictionModal;
