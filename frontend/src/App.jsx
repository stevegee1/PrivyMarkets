import { useState, useEffect } from 'react';
import { WalletMultiButton } from '@provablehq/aleo-wallet-adaptor-react-ui';
import MarketBrowser from './components/MarketBrowser';
import AdminMarketCreate from './components/AdminMarketCreate';
import AdminResolve from './components/AdminResolve';
import MyPositions from './components/MyPositions';
import HowItWorks from './components/HowItWorks';
import { WalletWrapper } from './core/WalletWrapper';
import './index.css';

const MARKETS_STORAGE_KEY = 'privymarkets_active_markets';

function App() {
  // Load markets from localStorage on mount
  const [markets, setMarkets] = useState(() => {
    try {
      const stored = localStorage.getItem(MARKETS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load markets from localStorage:', error);
      return [];
    }
  });
  const [activeTab, setActiveTab] = useState('markets'); // 'markets' | 'positions' | 'admin'

  // Save markets to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(MARKETS_STORAGE_KEY, JSON.stringify(markets));
    } catch (error) {
      console.error('Failed to save markets to localStorage:', error);
    }
  }, [markets]);

  // Check for Shareable Link Import
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const marketData = params.get('market');
    if (marketData) {
        try {
            const market = JSON.parse(decodeURIComponent(marketData));
            if (market && market.id) {
                // Check if already exists to avoid duplicates
                setMarkets(prev => {
                    if (prev.find(m => m.id === market.id)) return prev;
                    // If new, add it
                    setTimeout(() => alert(`Market "${market.question}" imported successfully!`), 500);
                    return [...prev, market];
                });
                // Clean URL
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        } catch (e) {
            console.error("Failed to import market from URL:", e);
        }
    }
  }, []);

  const handleMarketCreated = (newMarket) => {
    // Add new market to state (Optimistic UI)
    setMarkets((prev) => [...prev, newMarket]);
  };

  return (
    <WalletWrapper>
      <div className="min-h-screen bg-white dark:bg-slate-900">
        <header className="border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-50 backdrop-blur-md bg-opacity-90 dark:bg-opacity-90">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">

              {/* LEFT: Logo */}
              <div
                className="flex items-center cursor-pointer min-w-[200px]"
                onClick={() => handleMarketCreated({})} // Hack to reset or just nav home? Better: setActiveTab('markets')
              >
                  <div
                    onClick={() => setActiveTab('markets')}
                    className="flex items-center space-x-2 group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:scale-105 transition-transform">
                      <span className="text-white font-bold text-lg">P</span>
                    </div>
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300">
                        PrivyMarkets
                    </span>
                  </div>
              </div>

              {/* CENTER: Navigation Pills */}
              <div className="hidden md:flex flex-1 justify-center">
                <nav className="flex items-center p-1 space-x-1 bg-gray-100 dark:bg-slate-800/80 rounded-full border border-gray-200 dark:border-slate-700 backdrop-blur-sm">
                  <button
                    onClick={() => setActiveTab('markets')}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                      activeTab === 'markets'
                        ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    Markets
                  </button>
                  <button
                    onClick={() => setActiveTab('positions')}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                      activeTab === 'positions'
                        ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    My Positions
                  </button>
                  <div className="w-px h-4 bg-gray-300 dark:bg-slate-600 mx-1"></div>
                  <button
                    onClick={() => {
                        const code = prompt("Paste Market JSON Code here:");
                        if (code) {
                            try {
                                const market = JSON.parse(code);
                                if (!market.id) throw new Error("Invalid market code (missing id)");
                                handleMarketCreated(market);
                                alert("Market Imported Successfully!");
                            } catch (e) {
                                alert("Invalid Market Code: " + e.message);
                            }
                        }
                    }}
                    className="flex items-center px-4 py-1.5 rounded-full text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    <span className="mr-1.5">📥</span> Import
                  </button>
                  <button
                    onClick={() => setActiveTab('admin')}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                      activeTab === 'admin'
                        ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    Admin
                  </button>
                </nav>
              </div>

              {/* RIGHT: Actions */}
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
                <div className="mb-8">
                  <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Active Markets</h2>
                  <p className="text-gray-600 dark:text-gray-400">Predict on outcomes without revealing your positions</p>
                </div>
                <MarketBrowser markets={markets} />
             </>
          )}

          {activeTab === 'positions' && (
            <MyPositions />
          )}

          {activeTab === 'admin' && (
            <div className="space-y-8">
              <div className="flex justify-end">
                  <button
                    onClick={() => {
                        if(window.confirm("Are you sure you want to delete ALL stored markets? This cannot be undone.")) {
                            localStorage.removeItem(MARKETS_STORAGE_KEY);
                            setMarkets([]);
                        }
                    }}
                    className="text-red-500 hover:text-red-700 text-sm font-medium hover:underline"
                  >
                    Clear All Stored Markets
                  </button>
              </div>
              <AdminMarketCreate onMarketCreated={handleMarketCreated} />
              <div className="border-t border-gray-200 dark:border-gray-700 pt-8">
                <AdminResolve />
              </div>
            </div>
          )}
        </main>
        <footer className="border-t border-gray-200 dark:border-gray-700 mt-16 bg-gray-50 dark:bg-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="text-center text-gray-500 dark:text-gray-400 text-sm">
              <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">PrivyMarkets - Private Prediction Markets on Aleo</p>
              <p>Privacy-First • Zero-Knowledge Proofs • Encrypted Positions</p>
            </div>
          </div>
        </footer>
      </div>
    </WalletWrapper>
  );
}

export default App;
