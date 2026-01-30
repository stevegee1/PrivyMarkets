import { useState, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { fetchFromIPFS } from '../utils/ipfs';
import { PROGRAM_ID } from "../core/constants.js";
import { createAleoTransaction } from "../core/transaction-helper.js";

function AdminResolve() {
  const { wallet, address: publicKey, requestRecords, requestTransaction } = useWallet();
  const [markets, setMarkets] = useState([]);
  const [adminCaps, setAdminCaps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(null);
  const [error, setError] = useState('');

  // Helper to convert record to plaintext
  const convertRecordToPlaintext = (record) => {
    const fields = [];
    fields.push(`  owner: ${record.owner}.public`);
    for (const [key, value] of Object.entries(record)) {
      if (key === 'owner') continue;
      if (key === '_nonce') continue;
      fields.push(`  ${key}: ${value}.public`);
    }
    return `{\n${fields.join(',\n')}\n}`;
  };

  // Fetch admin's Market records and AdminCap records
  const handleFetchMarkets = async () => {
    if (!publicKey) {
      setError('Please connect your wallet first');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Fetch Market records
      const marketRecords = await requestRecords(PROGRAM_ID);
      console.log('All records:', marketRecords);

      // Filter for Market records (have market_id field)
      const myMarkets = marketRecords.filter(record =>
        record.data && record.data.market_id
      );

      // Enrich with metadata
      const enriched = await Promise.all(myMarkets.map(async (record) => {
        const data = record.data;

        // Fetch metadata from IPFS if available
        let metadata = { question: 'Loading...', category: 'General' };
        if (data.metadata_cid) {
          try {
            const cid = data.metadata_cid.replace(/field|u64|u8|\.public|\.private/g, '').trim();
            // Convert field to CID string (this is simplified - you may need actual conversion)
            metadata = await fetchFromIPFS(cid);
          } catch (e) {
            console.error('Failed to fetch metadata:', e);
            metadata.question = 'Failed to load metadata';
          }
        }

        return {
          recordPlaintext: record.plaintext,
          recordData: data,
          question: metadata.question,
          category: metadata.category || 'General',
          image: metadata.image,
          yes_pool: 0, // State is now in Mappings (not in Record)
          no_pool: 0,
          state: 0,    // State is in Mappings
          result: false,
          resolution_time: parseInt(data.resolution_time) || 0,

          market_id: data.market_id
        };
      }));

      setMarkets(enriched);

      // Also fetch AdminCap records
      const adminCapRecords = marketRecords.filter(record =>
        record.data && record.data.owner && !record.data.market_id
      );

      if (adminCapRecords.length === 0) {
        setError('No AdminCap found. You may need to initialize or you are not an admin.');
      }

      setAdminCaps(adminCapRecords);

    } catch (err) {
      console.error('Error fetching markets:', err);
      setError(`Failed to fetch markets: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount
  useEffect(() => {
    if (publicKey) {
      handleFetchMarkets();
    }
  }, [publicKey]);

  // Resolve market
  const handleResolve = async (market, outcome) => {
    if (!wallet || !publicKey) {
      setError('Please connect your wallet');
      return;
    }

    if (adminCaps.length === 0) {
      setError('No AdminCap found. You must be an admin to resolve markets.');
      return;
    }

    setResolving(market.market_id);
    setError('');

    try {
      // Use first available AdminCap
      const adminCapPlaintext = adminCaps[0].plaintext;
      const marketId = market.market_id;

      console.log('Resolving market with outcome:', outcome);
      console.log('AdminCap:', adminCapPlaintext);
      console.log('Market ID:', marketId);

      const resolveInputs = [
        adminCapPlaintext,
        marketId,     // Pass the FIELD (not the record)
        `${outcome}`  // "true" for YES wins, "false" for NO wins
      ];

      const aleoTransaction = createAleoTransaction(
        publicKey,
        PROGRAM_ID,
        'resolve_market',
        resolveInputs,
        5000,
        false
      );

      const txId = await requestTransaction(aleoTransaction);
      console.log('Resolution transaction submitted:', txId);

      // Optimistic update
      setMarkets(prev => prev.map(m =>
        m.market_id === market.market_id
          ? { ...m, state: 3, result: outcome }
          : m
      ));

      alert(`Market resolved! Transaction: ${txId}\n\nWinner: ${outcome ? 'YES' : 'NO'}`);

    } catch (err) {
      console.error('Error resolving market:', err);
      setError(`Failed to resolve market: ${err.message}`);
    } finally {
      setResolving(null);
    }
  };

  const getStateLabel = (state) => {
    switch(state) {
      case 0: return 'Open';
      case 1: return 'Paused';
      case 2: return 'Resolving';
      case 3: return 'Resolved';
      default: return 'Unknown';
    }
  };

  const getStateBadgeClass = (state) => {
    switch(state) {
      case 0: return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 1: return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 2: return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 3: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const calculateOdds = (yes_pool, no_pool) => {
    const total = yes_pool + no_pool;
    if (total === 0) return 50;
    return Math.round((yes_pool / total) * 100);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Resolve Markets</h2>
        <p className="text-gray-600 dark:text-gray-400">Manage and resolve your created markets</p>
      </div>

      {/* Fetch Markets Button */}
      {!publicKey ? (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <p className="text-yellow-800 dark:text-yellow-200">Please connect your wallet to view your markets</p>
        </div>
      ) : (
        <button
          onClick={handleFetchMarkets}
          disabled={loading}
          className="mb-6 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Fetching...' : 'Refresh Markets'}
        </button>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Markets List */}
      {markets.length === 0 && !loading && publicKey && (
        <div className="text-center py-12 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-200 dark:bg-slate-700 mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-2">No markets found</h3>
          <p className="text-gray-500 dark:text-gray-400">You haven't created any markets yet, or they're not in your wallet records</p>
        </div>
      )}

      <div className="space-y-4">
        {markets.map((market) => {
          const yesOdds = calculateOdds(market.yes_pool, market.no_pool);
          const totalVolume = market.yes_pool + market.no_pool;
          const isResolved = market.state === 3;
          const canResolve = market.state === 0 || market.state === 1;

          return (
            <div
              key={market.market_id}
              className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      market.category === 'Politics' ? 'bg-blue-100 text-blue-800' :
                      market.category === 'Crypto' ? 'bg-orange-100 text-orange-800' :
                      market.category === 'Sports' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {market.category}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${getStateBadgeClass(market.state)}`}>
                      {getStateLabel(market.state)}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    {market.question}
                  </h3>
                </div>
              </div>

              {/* Market Stats */}
              <div className="grid grid-cols-2 gap-4 mb-4 p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">YES Odds</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">{yesOdds}%</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">NO Odds</p>
                  <p className="text-xl font-bold text-red-600 dark:text-red-400">{100 - yesOdds}%</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Total Volume</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {(totalVolume / 1_000_000).toFixed(2)} credits
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Pool Ratio</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {(market.yes_pool / 1_000_000).toFixed(1)}k / {(market.no_pool / 1_000_000).toFixed(1)}k
                  </p>
                </div>
              </div>

              {/* Resolution Result (if resolved) */}
              {isResolved && (
                <div className={`mb-4 p-4 rounded-lg ${
                  market.result
                    ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                }`}>
                  <p className={`font-semibold ${
                    market.result ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
                  }`}>
                    ✓ Resolved: {market.result ? 'YES' : 'NO'} wins
                  </p>
                </div>
              )}

              {/* Resolve Buttons */}
              {canResolve && (
                <div className="flex space-x-3">
                  <button
                    onClick={() => handleResolve(market, true)}
                    disabled={resolving === market.market_id}
                    className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resolving === market.market_id ? 'Resolving...' : 'Resolve YES'}
                  </button>
                  <button
                    onClick={() => handleResolve(market, false)}
                    disabled={resolving === market.market_id}
                    className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resolving === market.market_id ? 'Resolving...' : 'Resolve NO'}
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
