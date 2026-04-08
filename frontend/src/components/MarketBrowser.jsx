import { useState } from 'react';
import PredictionModal from './PredictionModal';

// MarketBrowser is display-only.
// All data fetching (chain discovery, IPFS metadata, live pools)
// happens in the parent via loadAllMarkets() from marketRegistry.js.
// PredictionModal re-fetches fresh pools on open and before every submit.

function MarketBrowser({ markets = [], loading = false }) {
  const [selectedMarket, setSelectedMarket] = useState(null);

  // AMM implied YES price = no_pool / total.
  // Pools arrive as raw micro-USDCx from loadAllMarkets().
  const impliedYesPct = (yes_pool, no_pool) => {
    const total = yes_pool + no_pool;
    if (total === 0) return 50;
    // Standard AMM Price: Pool_A / (Pool_A + Pool_B)
    return Math.round((yes_pool / total) * 100);
  };

  const formatTimeRemaining = (timestamp) => {
    const now  = Date.now() / 1000;
    const diff = timestamp - now;
    const days = Math.floor(diff / 86400);
    if (days < 0)   return 'Ended';
    if (days > 30)  return `${Math.floor(days / 30)} months`;
    if (days === 0) return 'Today';
    return `${days}d`;
  };

  // Pools are raw micro-USDCx (u64).
  const formatVolume = (microTotal) => {
    const usdcx = microTotal / 1_000_000;
    if (usdcx >= 1000) return `$${(usdcx / 1000).toFixed(1)}k`;
    return `$${usdcx.toFixed(2)}`;
  };

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden animate-pulse">
            <div className="p-4 flex items-start space-x-3">
              <div className="w-12 h-12 rounded-lg bg-slate-700" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-700 rounded w-3/4" />
                <div className="h-3 bg-slate-700 rounded w-1/4" />
              </div>
            </div>
            <div className="px-4 mb-4">
              <div className="h-8 bg-slate-700 rounded mb-2" />
              <div className="h-1.5 bg-slate-700 rounded-full" />
            </div>
            <div className="px-4 pb-4 grid grid-cols-2 gap-2">
              <div className="h-9 bg-slate-700 rounded-lg" />
              <div className="h-9 bg-slate-700 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (markets.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-gray-600 mb-2">No markets yet</h3>
        <p className="text-gray-400">Be the first to create a prediction market!</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {markets.map((market) => {
          const yesPct      = impliedYesPct(market.yes_pool, market.no_pool);
          const noPct       = 100 - yesPct;
          const totalVolume = (market.yes_pool || 0) + (market.no_pool || 0);
          const category    = market.category || 'General';

          return (
            <div
              key={market.id}
              className="group relative flex flex-col bg-slate-800 border border-slate-700 hover:border-slate-500 rounded-xl overflow-hidden transition-all duration-200 cursor-pointer shadow-lg"
              onClick={() => setSelectedMarket(market)}
            >
              {/* Card Header */}
              <div className="p-4 flex items-start space-x-3">
                <div className="flex-shrink-0">
                  {market.image ? (
                    <img
                      src={`https://gateway.pinata.cloud/ipfs/${market.image}`}
                      alt="icon"
                      className="w-12 h-12 rounded-lg object-cover bg-slate-700"
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl">
                      {(market.question || '?').charAt(0)}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-semibold text-base leading-snug line-clamp-3 mb-1 group-hover:text-blue-400 transition-colors">
                    {market.question || <span className="text-slate-500 italic">Loading…</span>}
                  </h3>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                    {category}
                  </span>
                </div>
              </div>

              {/* Odds */}
              <div className="px-4 mb-4 flex-1">
                <div className="flex items-end justify-between mb-2">
                  <div className="flex flex-col">
                    <span className="text-2xl font-bold text-green-500">{yesPct}%</span>
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Yes</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-2xl font-bold text-red-500">{noPct}%</span>
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">No</span>
                  </div>
                </div>
                <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden flex">
                  <div className="h-full bg-green-500 transition-all" style={{ width: `${yesPct}%` }} />
                  <div className="h-full bg-red-500   transition-all" style={{ width: `${noPct}%`  }} />
                </div>
              </div>

              {/* Bet buttons */}
              <div className="px-4 pb-4 grid grid-cols-2 gap-2 mt-auto">
                <button
                  className="flex items-center justify-center py-2 rounded-lg bg-green-500/10 text-green-500 font-semibold text-sm hover:bg-green-500 hover:text-white transition-all border border-green-500/20 hover:border-green-500"
                  onClick={e => { e.stopPropagation(); setSelectedMarket(market); }}
                >
                  Bet Yes
                </button>
                <button
                  className="flex items-center justify-center py-2 rounded-lg bg-red-500/10 text-red-500 font-semibold text-sm hover:bg-red-500 hover:text-white transition-all border border-red-500/20 hover:border-red-500"
                  onClick={e => { e.stopPropagation(); setSelectedMarket(market); }}
                >
                  Bet No
                </button>
              </div>

              {/* Footer */}
              <div className="border-t border-slate-700 px-4 py-3 bg-slate-800/50 flex items-center justify-between text-xs text-slate-400 font-medium">
                <div className="flex items-center space-x-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{formatVolume(totalVolume)}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{formatTimeRemaining(market.resolution_time)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedMarket && (
        <PredictionModal
          market={selectedMarket}
          onClose={() => setSelectedMarket(null)}
        />
      )}
    </>
  );
}

export default MarketBrowser;
