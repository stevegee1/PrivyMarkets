import { useState, useEffect } from 'react';
import { loadAllMarkets } from '../core/marketRegistry';

function RegistryManager() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      // We use loadAllMarkets but we want the raw data where possible
      const data = await loadAllMarkets();
      setMarkets(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const copyToClipboard = (market) => {
    const entry = {
      market_id: market.market_id,
      question: market.question,
      description: market.description,
      category: market.category,
      image: market.image,
      resolution_time: market.resolution_time,
      metadata_cid: market.metadata_cid,
      source_of_truth: market.source_of_truth
    };
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    setCopyStatus(market.market_id);
    setTimeout(() => setCopyStatus(null), 2000);
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-gray-200 dark:border-slate-700 p-6 mt-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Market Registry Manager</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">View and manage markets registered in <code>public/markets.json</code></p>
        </div>
        <button 
          onClick={refresh}
          className="p-2 rounded-lg bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
          disabled={loading}
        >
          <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : markets.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-lg">
          <p className="text-gray-500 dark:text-gray-400">No markets found in registry.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {markets.map((m) => (
            <div key={m.market_id} className="p-4 rounded-lg bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 dark:text-white truncate">{m.question}</h4>
                  <p className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate mt-1">{m.market_id}</p>
                </div>
                <button 
                  onClick={() => copyToClipboard(m)}
                  className="ml-4 px-3 py-1 text-xs font-medium rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                >
                  {copyStatus === m.market_id ? '✓ Copied' : 'Copy JSON'}
                </button>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
                <div className="text-center p-2 rounded bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
                  <span className="block text-[10px] text-gray-400 uppercase font-bold">State</span>
                  <span className={`text-sm font-semibold ${m.state === 0 ? 'text-green-500' : 'text-amber-500'}`}>
                    {m.state === 0 ? 'Open' : m.state === 3 ? 'Resolved' : 'Paused'}
                  </span>
                </div>
                <div className="text-center p-2 rounded bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
                  <span className="block text-[10px] text-gray-400 uppercase font-bold">Yes Pool</span>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{(m.yes_pool / 1_000_000).toFixed(2)}</span>
                </div>
                <div className="text-center p-2 rounded bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
                  <span className="block text-[10px] text-gray-400 uppercase font-bold">No Pool</span>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{(m.no_pool / 1_000_000).toFixed(2)}</span>
                </div>
                <div className="text-center p-2 rounded bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
                  <span className="block text-[10px] text-gray-400 uppercase font-bold">Category</span>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{m.category}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 pt-6 border-t border-gray-100 dark:border-slate-700">
        <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">How to add a market</h4>
        <ol className="text-xs text-gray-500 dark:text-gray-400 space-y-2 list-decimal ml-4">
          <li>Create a market using the form above.</li>
          <li>After success, copy the generated JSON from the "Add to Registry" panel.</li>
          <li>Paste the JSON into <code>frontend/public/markets.json</code> and save the file.</li>
          <li>The market will now appear in the Market Browser for all users.</li>
        </ol>
      </div>
    </div>
  );
}

export default RegistryManager;
