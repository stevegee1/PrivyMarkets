import { useState, useEffect, useCallback } from 'react';
import { WalletMultiButton } from '@provablehq/aleo-wallet-adaptor-react-ui';
import MarketBrowser from './components/MarketBrowser';
import AdminMarketCreate from './components/AdminMarketCreate';
import AdminResolve from './components/AdminResolve';
import MyPositions from './components/MyPositions';
import HowItWorks from './components/HowItWorks';
import RegistryManager from './components/RegistryManager';
import { WalletWrapper } from './core/WalletWrapper';
import { loadAllMarkets } from './core/marketRegistry';
import { fetchFromIPFS } from './utils/ipfs';
import './index.css';

function AppInner() {
  const [markets,    setMarkets]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState('markets');

  // ── Single source of truth: on-chain ─────────────────────────────────────
  // loadAllMarkets() discovers market_ids from chain transitions,
  // fetches live pool state, then enriches with IPFS metadata.
  // No localStorage, no props-passed stale data.
  const refreshMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await loadAllMarkets();

      // Enrich with IPFS metadata where the registry didn't already have it
      // (chain-discovered markets know metadata_cid but not question/image yet)
      const enriched = await Promise.all(raw.map(async (m) => {
        if (m.question) return m;
        if (!m.metadata_cid) return m;
        try {
          const ipfs = await fetchFromIPFS(m.metadata_cid);
          return { ...m, ...ipfs };
        } catch {
          return m;
        }
      }));

      setMarkets(enriched);
    } catch (e) {
      console.error('Failed to load markets:', e);
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshMarkets(); }, [refreshMarkets]);

  // ── After admin creates a market, wait for chain confirmation then refresh ─
  // The TX needs to finalize before the mapping is queryable (~30-60s on testnet).
  // We do a delayed refresh rather than optimistic local state.
  const handleMarketCreated = () => {
    setActiveTab('markets');
    // First refresh immediately (may not see it yet)
    refreshMarkets();
    // Second refresh after 60s to catch finalized state
    setTimeout(() => refreshMarkets(), 60_000);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <header className="border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-50 backdrop-blur-md bg-opacity-90 dark:bg-opacity-90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">

            {/* Logo */}
            <div
              className="flex items-center space-x-2 group cursor-pointer min-w-[200px]"
              onClick={() => setActiveTab('markets')}
            >
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:scale-105 transition-transform">
                <span className="text-white font-bold text-lg">P</span>
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300">
                PrivyMarkets
              </span>
            </div>

            {/* Nav */}
            <div className="hidden md:flex flex-1 justify-center">
              <nav className="flex items-center p-1 space-x-1 bg-gray-100 dark:bg-slate-800/80 rounded-full border border-gray-200 dark:border-slate-700">
                {['markets', 'positions', 'admin'].map((tab, i) => (
                  <div key={tab} className="flex items-center">
                    {i === 2 && <div className="w-px h-4 bg-gray-300 dark:bg-slate-600 mx-1" />}
                    <button
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                        activeTab === tab
                          ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      {tab === 'markets' ? 'Markets' : tab === 'positions' ? 'My Positions' : 'Admin'}
                    </button>
                  </div>
                ))}
              </nav>
            </div>

            {/* Right */}
            <div className="flex items-center justify-end space-x-4 min-w-[200px]">
              <HowItWorks />
              <WalletMultiButton className="!bg-blue-600 hover:!bg-blue-700 !rounded-lg !px-4 !py-2 !h-auto !text-sm !font-semibold" />
            </div>
          </div>
        </div>
      </header>

      <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-slate-800 dark:to-slate-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
            <span className="font-medium">Your predictions stay completely private</span>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {activeTab === 'markets' && (
          <>
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Active Markets</h2>
                <p className="text-gray-600 dark:text-gray-400">Predict on outcomes without revealing your positions</p>
              </div>
              <button
                onClick={refreshMarkets}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-40 transition-all"
                title="Refresh from chain"
              >
                <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            <MarketBrowser markets={markets} loading={loading} />
          </>
        )}

        {activeTab === 'positions' && <MyPositions />}

        {activeTab === 'admin' && (
          <div className="space-y-8">
            <AdminMarketCreate onMarketCreated={handleMarketCreated} />
            <RegistryManager />
            <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
              <AdminResolve />
            </div>
          </div>
        )}

      </main>

      <footer className="border-t border-gray-200 dark:border-gray-700 mt-16 bg-gray-50 dark:bg-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-gray-500 dark:text-gray-400 text-sm">
            <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">PrivyMarkets — Private Prediction Markets on Aleo</p>
            <p>Privacy-First · Zero-Knowledge Proofs · Encrypted Positions</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function App() {
  return (
    <WalletWrapper>
      <AppInner />
    </WalletWrapper>
  );
}

export default App;
