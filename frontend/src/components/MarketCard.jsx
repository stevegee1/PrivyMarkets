// MarketCard.jsx — Polymarket grid card with full dark mode support

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
  return `<$1k`;
}

function timeLeft(ts) {
  if (!ts) return null;
  const diff = ts - Date.now()/1000;
  if (diff <= 0) return 'Ended';
  const d = Math.floor(diff/86400);
  if (d > 30) return `${Math.floor(d/30)}mo`;
  return d === 0 ? '<1d' : `${d}d`;
}

export default function MarketCard({ market, onClick }) {
  const yes   = yesPct(market.yes_pool, market.no_pool);
  const no    = 100 - yes;
  const vol   = (market.yes_pool||0)+(market.no_pool||0);
  const emoji  = CATEGORY_EMOJI[market.category] || '🌐';
  const tl    = timeLeft(market.resolution_time);

  return (
    <div
      onClick={onClick}
      className="pm-card cursor-pointer hover:shadow-md dark:hover:shadow-slate-900/50
                 transition-shadow flex flex-col"
    >
      {/* Image or icon header */}
      {market.image
        ? <img src={`https://gateway.pinata.cloud/ipfs/${market.image}`}
               alt="" className="w-full h-32 object-cover rounded-t-xl"
               onError={e => e.currentTarget.style.display='none'} />
        : <div className="w-full h-24 bg-gray-50 dark:bg-slate-700/50
                           rounded-t-xl flex items-center justify-center
                           text-4xl border-b border-gray-100 dark:border-slate-700">
            {emoji}
          </div>
      }

      <div className="p-4 flex flex-col flex-1">
        {/* Category */}
        <p className="text-xs text-gray-400 dark:text-slate-400 font-medium mb-1">
          {market.category || 'General'}
        </p>

        {/* Question */}
        <p className="text-sm font-semibold text-gray-900 dark:text-slate-100
                      line-clamp-2 leading-snug flex-1 mb-4">
          {market.question || <span className="text-gray-400 italic">Loading…</span>}
        </p>

        {/* Probability bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-green-700 dark:text-green-400">Yes {yes}%</span>
            <span className="text-xs font-semibold text-red-700 dark:text-red-400">No {no}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden flex">
            <div className="h-full bg-green-500 rounded-l-full" style={{ width: `${yes}%` }} />
            <div className="h-full bg-red-500 rounded-r-full"  style={{ width: `${no}%` }} />
          </div>
        </div>

        {/* Bet buttons */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={e => { e.stopPropagation(); onClick?.(); }} className="btn-yes py-2 text-center">
            Buy Yes
          </button>
          <button onClick={e => { e.stopPropagation(); onClick?.(); }} className="btn-no py-2 text-center">
            Buy No
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs
                        text-gray-400 dark:text-slate-500
                        border-t border-gray-100 dark:border-slate-700 pt-3">
          <span>{formatVol(vol)} Vol.</span>
          {tl && <span className={tl === 'Ended' ? 'text-red-500 font-medium' : ''}>{tl} left</span>}
        </div>
      </div>
    </div>
  );
}
