import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { useWalletModal } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { fetchMarketOnChainState, loadAllMarkets } from '../core/marketRegistry';
import PredictionModal from '../components/PredictionModal';
import ThemeToggle from '../components/ThemeToggle';

function yesPct(yes, no) {
  const t = (yes||0)+(no||0);
  return t ? Math.round((yes/t)*100) : 50;
}

function formatUSDCx(micro) {
  return (micro/1_000_000).toFixed(2);
}

function timeLeft(ts) {
  if (!ts) return { label: '—', urgent: false };
  const diff = ts - Date.now()/1000;
  if (diff <= 0) return { label: 'Market ended', urgent: true };
  const d = Math.floor(diff/86400);
  if (d > 30) return { label: `${Math.floor(d/30)}mo left`, urgent: false };
  if (d === 0) {
    const h = Math.floor(diff/3600);
    return { label: `${h}h left`, urgent: h < 6 };
  }
  return { label: `${d}d left`, urgent: d < 2 };
}

const CATEGORY_EMOJI = {
  Crypto: '₿', Sports: '⚽', Politics: '🏛', Tech: '💻',
  Entertainment: '🎬', Science: '🔬', Economics: '📈', General: '🌐',
};

export default function MarketDetail() {
  const { marketId } = useParams();
  const navigate = useNavigate();
  const { address } = useWallet();
  const { setVisible } = useWalletModal();
  const addr = address ? `${address.slice(0,6)}…${address.slice(-4)}` : '';

  const getStored = () => {
    try {
      const raw = sessionStorage.getItem('privy_market_detail');
      if (!raw) return null;
      const m = JSON.parse(raw);
      return m.id === decodeURIComponent(marketId) ? m : null;
    } catch { return null; }
  };

  const [market, setMarket] = useState(getStored());
  const [chain,  setChain]  = useState(null);
  const [loading, setLoading] = useState(!market);
  const [showBet, setShowBet] = useState(false);
  const [betSide, setBetSide] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const id = decodeURIComponent(marketId);

  const loadFullMarket = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      // 1. Fetch chain state
      const state = await fetchMarketOnChainState(id);
      setChain(state);

      // 2. If metadata is missing (direct hit), fetch it from registry
      if (!market) {
        const all = await loadAllMarkets();
        const found = all.find(m => m.id === id);
        if (found) setMarket(found);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [id, market]);

  useEffect(() => {
    loadFullMarket();
    const t = setInterval(() => loadFullMarket(true), 15_000);
    return () => clearInterval(t);
  }, [loadFullMarket]);

  const yes_pool = chain?.yes_pool ?? market?.yes_pool ?? 0;
  const no_pool  = chain?.no_pool  ?? market?.no_pool  ?? 0;
  const totalVol = yes_pool + no_pool;
  const yPct     = yesPct(yes_pool, no_pool);
  const nPct     = 100 - yPct;
  const deadline = timeLeft(market?.resolution_time);
  const isResolved = chain?.resolved || chain?.state === 3;
  const result     = chain?.result;

  const mergedMarket = { ...market, yes_pool, no_pool, market_id: market?.market_id ?? id, id };

  return (
    <div className="min-h-screen bg-bg dark:bg-gray-900 font-sans">

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm h-14 flex items-center px-4 sm:px-6 lg:px-8 gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-md bg-pm-blue flex items-center justify-center">
            <span className="text-white font-black text-[10px]">P</span>
          </div>
          <span className="font-semibold text-gray-600 dark:text-gray-300 text-sm hidden sm:block">PrivyMarkets</span>
        </div>
        <span className="text-gray-300 dark:text-gray-700 hidden sm:block">/</span>
        <span className="text-sm text-gray-700 dark:text-gray-200 font-medium truncate max-w-sm hidden sm:block">
          {market?.category || 'Market'}
        </span>
        {refreshing && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin ml-auto" />}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {addr ? (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-mono text-gray-600 dark:text-slate-300">
              <span className="w-2 h-2 rounded-full bg-yes-DEFAULT" />
              {addr}
            </div>
          ) : (
            <button
              onClick={() => setVisible(true)}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors flex-shrink-0 shadow-sm"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid lg:grid-cols-3 gap-6">

          {/* ── Left ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Title card */}
            <div className="pm-card overflow-hidden">
              {market?.image && (
                <img src={`https://gateway.pinata.cloud/ipfs/${market.image}`}
                     alt="" className="w-full h-44 object-cover"
                     onError={e => e.currentTarget.style.display='none'} />
              )}
              <div className="p-6">
                <div className="flex items-center gap-2 text-xs text-gray-400 font-medium mb-3">
                  <span>{CATEGORY_EMOJI[market?.category] || '🔮'}</span>
                  <span>{market?.category || 'General'}</span>
                  <span>·</span>
                  <span className={deadline.urgent ? 'text-red-500 font-semibold' : ''}>{deadline.label}</span>
                  {isResolved && (
                    <>
                      <span>·</span>
                      <span className={result ? 'text-yes-dark font-bold' : 'text-no-dark font-bold'}>
                        Resolved: {result ? 'YES' : 'NO'}
                      </span>
                    </>
                  )}
                </div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-snug mb-2">
                  {loading && !market?.question
                    ? <span className="skeleton block h-6 w-3/4 rounded" />
                    : market?.question || '…'}
                </h1>
                {market?.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                    {market.description}
                  </p>
                )}
              </div>
            </div>

            {/* Pool Stats */}
            <div className="pm-card p-6">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-5">Market Data</h2>

              {/* YES / NO probability bars */}
              {[
                { label: 'Yes', pct: yPct, pool: yes_pool, barColor: 'bg-yes-DEFAULT', textColor: 'text-yes-dark' },
                { label: 'No',  pct: nPct, pool: no_pool,  barColor: 'bg-no-DEFAULT',  textColor: 'text-no-dark' },
              ].map(({ label, pct, pool, barColor, textColor }) => (
                <div key={label} className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-bold ${textColor}`}>{label}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-gray-400 font-mono">{formatUSDCx(pool)} USDCx</span>
                      <span className={`text-lg font-black ${textColor}`}>{pct}%</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full transition-all duration-700`}
                         style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3 mt-5 pt-5 border-t border-gray-100 dark:border-gray-800">
                {[
                  { label: 'Total Volume', value: `${formatUSDCx(totalVol)} USDCx` },
                  { label: 'Liquidity √k', value: totalVol > 0 ? `${(Math.sqrt(yes_pool * no_pool)/1e6).toFixed(2)}` : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4">
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{label}</p>
                    <p className="text-base font-bold text-gray-900 dark:text-white font-mono">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Source */}
            {market?.source_of_truth && (
              <div className="pm-card p-4 flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <a href={market.source_of_truth} target="_blank" rel="noopener noreferrer"
                   className="text-sm text-pm-blue hover:underline truncate">
                  {market.source_of_truth}
                </a>
              </div>
            )}
          </div>

          {/* ── Right: Trade Panel ── */}
          <div>
            <div className="pm-card p-5 sticky top-20">
              {isResolved ? (
                <div className="text-center py-6">
                  <div className={`text-2xl font-black mb-1 ${result ? 'text-yes-dark' : 'text-no-dark'}`}>
                    {result ? '🎉 YES Won' : '❌ NO Won'}
                  </div>
                  <p className="text-sm text-gray-400">This market is resolved.</p>
                </div>
              ) : (
                <>
                  <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-4">Place a Bet</h2>

                  {/* Big YES / NO probability display */}
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <button
                      onClick={() => { setBetSide(true); setShowBet(true); }}
                      className="flex flex-col items-center py-5 rounded-xl
                                 bg-yes-light text-yes-dark border-2 border-transparent
                                 hover:bg-yes-DEFAULT hover:text-white hover:border-yes-dark
                                 font-bold transition-all duration-200"
                    >
                      <span className="text-3xl font-black">{yPct}¢</span>
                      <span className="text-sm mt-1">Yes</span>
                    </button>
                    <button
                      onClick={() => { setBetSide(false); setShowBet(true); }}
                      className="flex flex-col items-center py-5 rounded-xl
                                 bg-no-light text-no-dark border-2 border-transparent
                                 hover:bg-no-DEFAULT hover:text-white hover:border-no-dark
                                 font-bold transition-all duration-200"
                    >
                      <span className="text-3xl font-black">{nPct}¢</span>
                      <span className="text-sm mt-1">No</span>
                    </button>
                  </div>

                  {/* Privacy note */}
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-pm-blueLight text-xs text-pm-blue">
                    <span className="text-base leading-none mt-0.5">🔒</span>
                    <span><strong>Private</strong> — your bet direction is a ZK proof and is never visible on-chain.</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {showBet && !isResolved && (
        <PredictionModal
          market={{ ...mergedMarket, position: betSide }}
          onClose={() => setShowBet(false)}
        />
      )}
    </div>
  );
}
