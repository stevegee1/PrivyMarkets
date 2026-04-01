import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { useWalletModal } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { Search, RotateCw, Plus, X } from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';
import { loadAllMarkets } from '../core/marketRegistry';
import MarketRow from '../components/MarketRow';
import MarketCard from '../components/MarketCard';
import CreateMarketModal from '../components/CreateMarketModal';

// ── Category tabs (exactly like Polymarket) ───────────────────────────────────
const TABS = [
  { id: 'All',           label: '🔥 Trending' },
  { id: 'Crypto',        label: 'Crypto' },
  { id: 'AI',            label: 'AI' },
  { id: 'Tech',          label: 'Tech' },
  { id: 'Macro',         label: 'Finance' },
  { id: 'Defi',          label: 'DeFi' },
  { id: 'Politics',      label: 'Politics' },
  { id: 'Sports',        label: 'Sports' },
  { id: 'General',       label: 'General' },
];

const SORTS = [
  { id: 'volume',  label: 'Volume' },
  { id: 'ending',  label: 'Ending Soon' },
  { id: 'newest',  label: 'Newest' },
];

function yesPct(yes_pool, no_pool) {
  const t = (yes_pool || 0) + (no_pool || 0);
  return t ? Math.round((yes_pool / t) * 100) : 50;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const { address } = useWallet();
  const { setVisible } = useWalletModal();

  const [markets,    setMarkets]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState('');
  const [category,   setCategory]   = useState('All');
  const [sort,       setSort]       = useState('volume');
  const [viewMode,   setViewMode]   = useState('list');
  const [page,       setPage]       = useState(20);
  const [showCreate, setShowCreate] = useState(false);

  const loadMarkets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const raw = await loadAllMarkets();
      setMarkets(raw);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadMarkets();
    const t = setInterval(() => loadMarkets(true), 30_000);
    return () => clearInterval(t);
  }, [loadMarkets]);

  const filtered = useMemo(() => {
    if (!Array.isArray(markets)) return [];
    let list = markets.filter(m => m && !m.resolved && m.state !== 3);
    if (category !== 'All') list = list.filter(m =>
      (m.category || 'General').toLowerCase() === category.toLowerCase()
    );
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m => m.question?.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (sort === 'volume') return ((b.yes_pool||0)+(b.no_pool||0)) - ((a.yes_pool||0)+(a.no_pool||0));
      if (sort === 'ending') return (a.resolution_time||0) - (b.resolution_time||0);
      return (b.resolution_time||0) - (a.resolution_time||0);
    });
  }, [markets, category, sort, search]);

  const visible = filtered.slice(0, page);
  const addr = address ? `${address.slice(0,6)}…${address.slice(-4)}` : '';

  // Total volume for stats
  const totalVol = markets.reduce((s, m) => s + (m.yes_pool||0) + (m.no_pool||0), 0);

  return (
    <div className="min-h-screen bg-bg dark:bg-gray-900 font-sans">

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-4 h-14">
          {/* Logo */}
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-7 h-7 rounded-md bg-pm-blue flex items-center justify-center">
              <span className="text-white font-black text-xs">P</span>
            </div>
            <span className="font-bold text-gray-900 dark:text-white hidden sm:block">PrivyMarkets</span>
          </button>

          {/* Search — exactly Polymarket's wide centered search */}
          <div className="flex-1 max-w-xl relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(20); }}
              placeholder="Search markets"
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gray-100 dark:bg-slate-800 text-sm text-gray-900 dark:text-slate-100
                         placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pm-blue/20
                         focus:bg-white dark:focus:bg-slate-700 border border-transparent focus:border-gray-200 dark:border-slate-600 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-1">
            <button onClick={() => navigate('/positions')}
              className="filter-btn">My Bets</button>
            <ThemeToggle />
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold
                         bg-pm-blue text-white hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Create
            </button>
          </nav>

          {/* Wallet pill / Connect button */}
          {addr ? (
            <button className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700
                               text-xs font-mono text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors flex-shrink-0">
              <span className="w-2 h-2 rounded-full bg-yes-DEFAULT" />
              {addr}
            </button>
          ) : (
            <button
              onClick={() => setVisible(true)}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors flex-shrink-0 shadow-sm"
            >
              Connect Wallet
            </button>
          )}
        </div>

        {/* ── Category tabs (Polymarket-style horizontal scroll) ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-1 overflow-x-auto pb-0 border-t border-gray-100 dark:border-gray-800 hide-scrollbar">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => { setCategory(id); setPage(20); }}
                className={`flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  category === id
                    ? 'border-pm-blue text-pm-blue font-semibold'
                    : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main layout: feed + right sidebar ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex gap-6">

        {/* ── Market Feed ── */}
        <main className="flex-1 min-w-0">

          {/* Controls bar */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-slate-400">
                <span className="font-semibold text-gray-900 dark:text-slate-100">{filtered.length}</span> markets
                {category !== 'All' && <span className="text-pm-blue"> · {category}</span>}
              </span>
              {refreshing && <RotateCw className="w-3.5 h-3.5 text-gray-400 animate-spin" />}
            </div>

            <div className="flex items-center gap-2">
              {/* Sort */}
              <div className="flex items-center gap-1">
                {SORTS.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setSort(id)}
                    className={sort === id ? 'filter-btn-active' : 'filter-btn'}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* View toggle */}
              <div className="flex border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-2.5 py-1.5 text-xs transition-colors ${
                    viewMode === 'list' ? 'bg-gray-900 text-white' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                  }`}
                >☰</button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-2.5 py-1.5 text-xs transition-colors ${
                    viewMode === 'grid' ? 'bg-gray-900 text-white' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                  }`}
                >⊞</button>
              </div>
            </div>
          </div>

          {/* Skeletons */}
          {loading && (
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="pm-card p-4 flex items-center gap-4">
                  <div className="skeleton w-12 h-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-4 w-3/4" />
                    <div className="skeleton h-3 w-1/3" />
                  </div>
                  <div className="skeleton w-16 h-8 rounded-lg" />
                </div>
              ))}
            </div>
          )}

          {/* Empty */}
          {!loading && filtered.length === 0 && (
            <div className="pm-card p-12 text-center">
              <p className="text-gray-400 font-medium">No markets found</p>
              <p className="text-sm text-gray-400 mt-1">
                {search ? 'Try a different search' : 'Be the first to create a market'}
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 px-4 py-2 bg-pm-blue text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                Create Market
              </button>
            </div>
          )}

          {/* List view */}
          {!loading && viewMode === 'list' && (
            <div className="pm-card divide-y divide-gray-100 dark:divide-slate-700 overflow-hidden">
              {visible.map(m => (
                <MarketRow
                  key={m.id}
                  market={m}
                  onClick={() => navigate(`/market/${encodeURIComponent(m.id)}`)}
                />
              ))}
            </div>
          )}

          {/* Grid view */}
          {!loading && viewMode === 'grid' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {visible.map(m => (
                <MarketCard
                  key={m.id}
                  market={m}
                  onClick={() => navigate(`/market/${encodeURIComponent(m.id)}`)}
                />
              ))}
            </div>
          )}

          {/* Load more */}
          {!loading && filtered.length > page && (
            <button
              onClick={() => setPage(p => p + 20)}
              className="w-full mt-4 py-3 rounded-xl text-sm font-semibold text-pm-blue
                         bg-pm-blueLight dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
            >
              Show more markets
            </button>
          )}
        </main>

        {/* ── Right Sidebar ── */}
        <aside className="hidden lg:flex flex-col gap-4 w-72 flex-shrink-0">

          {/* Stats summary — like Polymarket's "Breaking" panel */}
          <div className="pm-card p-4">
            <h3 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              📊 Market Stats
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Active Markets', value: markets.filter(m => !m.resolved).length },
                { label: 'Total Volume',   value: `${(totalVol / 1_000_000).toFixed(0)} USDCx` },
                { label: 'Avg YES Prob',    value: markets.length
                    ? `${Math.round(markets.reduce((s,m)=>s+yesPct(m.yes_pool,m.no_pool), 0)/markets.length)}%`
                    : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-slate-400">{label}</span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hot markets — top 3 by volume */}
          <div className="pm-card p-4">
            <h3 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              🔥 Hot Topics
            </h3>
            <div className="space-y-2">
              {markets
                .filter(m => !m.resolved)
                .sort((a,b) => ((b.yes_pool||0)+(b.no_pool||0)) - ((a.yes_pool||0)+(a.no_pool||0)))
                .slice(0, 5)
                .map((m, i) => (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/market/${encodeURIComponent(m.id)}`)}
                    className="w-full flex items-center gap-2 text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors group"
                  >
                    <span className="text-xs text-gray-400 dark:text-slate-500 w-4 text-center">{i+1}</span>
                    <span className="text-sm text-gray-700 dark:text-slate-300 group-hover:text-gray-900 dark:group-hover:text-white line-clamp-1 flex-1">
                      {m.category || 'Market'}
                    </span>
                    <span className="text-xs text-gray-400 font-mono flex-shrink-0">
                      {Math.round(((m.yes_pool||0)+(m.no_pool||0))/1_000_000)}k
                    </span>
                  </button>
                ))}
              {markets.length === 0 && !loading && (
                <p className="text-sm text-gray-400">No markets yet</p>
              )}
            </div>
          </div>

          {/* Privacy badge — PrivyMarkets differentiator */}
          <div className="pm-card p-4 bg-pm-blueLight border-pm-blue/20">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-pm-blue"></span>
              <h3 className="text-sm font-bold text-pm-blue">ZK Privacy Active</h3>
            </div>
            <p className="text-xs text-blue-600 leading-relaxed">
              All bet directions are zero-knowledge proofs. Your position is never visible on-chain.
            </p>
          </div>
        </aside>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
             onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CreateMarketModal
              onClose={() => setShowCreate(false)}
              onCreated={(newMarket) => { 
                console.log("Market created and handled in dashboard:", newMarket);
                setShowCreate(false); 
                loadMarkets(true); 
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
