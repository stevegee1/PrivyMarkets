// MarketRow.jsx — Polymarket-style list row with full dark mode support

const CATEGORY_EMOJI = {
  Crypto: '₿', Sports: '⚽', Politics: '🏛', Tech: '💻',
  Entertainment: '🎬', Science: '🔬', Economics: '📈', General: '🌐',
};

function yesPct(yes_pool, no_pool) {
  const t = (yes_pool||0)+(no_pool||0);
  return t ? Math.round((yes_pool/t)*100) : 50;
}

function formatVol(micro) {
  const v = micro/1_000_000;
  if (v >= 1000) return `$${(v/1000).toFixed(1)}M`;
  if (v >= 1)    return `$${v.toFixed(0)}k`;
  return `$${(v*1000).toFixed(0)}`;
}

function timeLeft(ts) {
  if (!ts) return null;
  const diff = ts - Date.now()/1000;
  if (diff <= 0) return 'Ended';
  const d = Math.floor(diff/86400);
  if (d > 30) return `${Math.floor(d/30)}mo`;
  if (d === 0) {
    const h = Math.floor(diff/3600);
    return h > 0 ? `${h}h` : '<1h';
  }
  return `${d}d`;
}

export default function MarketRow({ market, onClick }) {
  const yes   = yesPct(market.yes_pool, market.no_pool);
  const no    = 100 - yes;
  const vol   = (market.yes_pool||0)+(market.no_pool||0);
  const tl    = timeLeft(market.resolution_time);
  const emoji = CATEGORY_EMOJI[market.category] || '🌐';

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 px-4 py-3.5 cursor-pointer
                 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors group"
    >
      {/* Thumbnail */}
      <div className="w-11 h-11 rounded-xl bg-gray-100 dark:bg-slate-700
                      flex items-center justify-center text-xl flex-shrink-0
                      overflow-hidden border border-gray-200 dark:border-slate-600">
        {market.image
          ? <img src={`https://gateway.pinata.cloud/ipfs/${market.image}`}
                 alt="" className="w-full h-full object-cover"
                 onError={e => { e.currentTarget.style.display='none'; }} />
          : emoji}
      </div>

      {/* Middle */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 dark:text-slate-400 font-medium mb-0.5">
          {market.category || 'General'}
        </p>
        <p className="text-sm font-semibold text-gray-900 dark:text-slate-100
                      line-clamp-1 group-hover:text-pm-blue transition-colors">
          {market.question || <span className="text-gray-400">Loading…</span>}
        </p>
        <div className="flex items-center gap-3 mt-1">
          {vol > 0 && (
            <span className="text-xs text-gray-400 dark:text-slate-500">{formatVol(vol)} Vol.</span>
          )}
          {tl && (
            <span className={`text-xs ${tl === 'Ended' ? 'text-red-500 font-medium' : 'text-gray-400 dark:text-slate-500'}`}>
              {tl} left
            </span>
          )}
        </div>
      </div>

      {/* Right: big % + YES/NO buttons */}
      <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
        <div className="text-right w-12">
          <div className="text-sm font-bold text-green-700 dark:text-green-400">{yes}%</div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">chance</div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={e => { e.stopPropagation(); onClick?.(); }}
            className="btn-yes"
          >
            Yes {yes}¢
          </button>
          <button
            onClick={e => { e.stopPropagation(); onClick?.(); }}
            className="btn-no"
          >
            No {no}¢
          </button>
        </div>
      </div>

      {/* Mobile */}
      <div className="sm:hidden flex-shrink-0">
        <span className="text-sm font-bold text-green-700 dark:text-green-400">{yes}%</span>
      </div>
    </div>
  );
}
