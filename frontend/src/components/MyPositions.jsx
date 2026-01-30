import { useState, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { fetchFromIPFS } from '../utils/ipfs';
import { PROGRAM_ID } from "../core/constants.js";
import { createAleoTransaction } from "../core/transaction-helper.js";

function MyPositions() {
  const { wallet, address: publicKey, requestRecords, requestTransaction } = useWallet();
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(null);
  const [error, setError] = useState('');

  // Fetch user's Position records
  const handleFetchPositions = async () => {
    if (!publicKey) {
      setError('Please connect your wallet first');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const records = await requestRecords(PROGRAM_ID);
      console.log('All records:', records);

      // Filter for Position records (have yes_shares and no_shares fields)
      const positionRecords = records.filter(record =>
        record.data &&
        (record.data.yes_shares !== undefined || record.data.no_shares !== undefined)
      );

      console.log('Position records:', positionRecords);

      if (positionRecords.length === 0) {
        setPositions([]);
        setLoading(false);
        return;
      }

      // For each position, we need to find the corresponding market
      // We'll need to fetch all Market records and match by market_id
      const allRecords = await requestRecords(PROGRAM_ID);
      const marketRecords = allRecords.filter(record =>
        record.data && record.data.market_id && record.data.yes_pool !== undefined
      );

      console.log('Market records:', marketRecords);

      // Enrich positions with market data
      const enriched = await Promise.all(positionRecords.map(async (posRecord) => {
        const posData = posRecord.data;

        // Find matching market by market_id
        const matchingMarket = marketRecords.find(m =>
          m.data.market_id === posData.market_id
        );

        let marketData = {
          question: 'Market not found in wallet',
          category: 'Unknown',
          state: 0,
          result: false,
          yes_pool: 0,
          no_pool: 0,
          recordPlaintext: null
        };

        if (matchingMarket) {
          marketData.state = parseInt(matchingMarket.data.state) || 0;
          marketData.result = matchingMarket.data.result === 'true';
          marketData.yes_pool = parseInt(matchingMarket.data.yes_pool) || 0;
          marketData.no_pool = parseInt(matchingMarket.data.no_pool) || 0;
          marketData.recordPlaintext = matchingMarket.plaintext;

          // Fetch metadata
          if (matchingMarket.data.metadata_cid) {
            try {
              const cid = matchingMarket.data.metadata_cid.replace(/field|u64|u8|\.public|\.private/g, '').trim();
              const metadata = await fetchFromIPFS(cid);
              marketData.question = metadata.question || 'Unknown';
              marketData.category = metadata.category || 'General';
              marketData.image = metadata.image;
            } catch (e) {
              console.error('Failed to fetch metadata:', e);
            }
          }
        }

        return {
          positionPlaintext: posRecord.plaintext,
          positionData: posData,
          market_id: posData.market_id,
          yes_shares: parseInt(posData.yes_shares) || 0,
          no_shares: parseInt(posData.no_shares) || 0,
          timestamp: parseInt(posData.timestamp) || 0,
          ...marketData
        };
      }));

      setPositions(enriched);

    } catch (err) {
      console.error('Error fetching positions:', err);
      setError(`Failed to fetch positions: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount
  useEffect(() => {
    if (publicKey) {
      handleFetchPositions();
    }
  }, [publicKey]);

  // Claim winnings
  const handleClaim = async (position) => {
    if (!wallet || !publicKey) {
      setError('Please connect your wallet');
      return;
    }

    if (!position.recordPlaintext) {
      setError('Market record not found in wallet. You may need to sync your records.');
      return;
    }

    setClaiming(position.market_id);
    setError('');

    try {
      const inputs = [
        position.recordPlaintext,      // Market record
        position.positionPlaintext     // Position record
      ];

      console.log('Claiming winnings with inputs:', inputs);

      const aleoTransaction = createAleoTransaction(
        publicKey,
        PROGRAM_ID,
        'claim_winning',
        inputs,
        5000,
        false
      );

      const txId = await requestTransaction(aleoTransaction);
      console.log('Claim transaction submitted:', txId);

      // Calculate payout
      const payout = position.result ? position.yes_shares : position.no_shares;

      alert(`Winnings claimed! Transaction: ${txId}\n\nPayout: ${(payout / 1_000_000).toFixed(2)} credits`);

      // Remove claimed position from list (optimistic)
      setPositions(prev => prev.filter(p => p.market_id !== position.market_id));

    } catch (err) {
      console.error('Error claiming winnings:', err);
      setError(`Failed to claim winnings: ${err.message}`);
    } finally {
      setClaiming(null);
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

  const calculatePayout = (position) => {
    if (position.state !== 3) {
      // Market not resolved yet
      return {
        status: 'pending',
        amount: 0,
        isWinner: null
      };
    }

    const isWinner = position.result
      ? position.yes_shares > 0
      : position.no_shares > 0;

    const payout = position.result
      ? position.yes_shares
      : position.no_shares;

    return {
      status: 'resolved',
      amount: payout,
      isWinner
    };
  };

  const calculateOdds = (yes_pool, no_pool) => {
    const total = yes_pool + no_pool;
    if (total === 0) return 50;
    return Math.round((yes_pool / total) * 100);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">My Positions</h2>
        <p className="text-gray-600 dark:text-gray-400">View your positions and claim winnings from resolved markets</p>
      </div>

      {/* Wallet Connection */}
      {!publicKey ? (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <p className="text-yellow-800 dark:text-yellow-200">Please connect your wallet to view your positions</p>
        </div>
      ) : (
        <button
          onClick={handleFetchPositions}
          disabled={loading}
          className="mb-6 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Fetching...' : 'Refresh Positions'}
        </button>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {positions.length === 0 && !loading && publicKey && (
        <div className="text-center py-12 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-200 dark:bg-slate-700 mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-300 mb-2">No positions found</h3>
          <p className="text-gray-500 dark:text-gray-400">Place a bet on a market to create your first position</p>
        </div>
      )}

      {/* Positions List */}
      <div className="space-y-4">
        {positions.map((position) => {
          const payout = calculatePayout(position);
          const yesOdds = calculateOdds(position.yes_pool, position.no_pool);
          const hasYesShares = position.yes_shares > 0;
          const hasNoShares = position.no_shares > 0;

          return (
            <div
              key={position.market_id}
              className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      position.category === 'Politics' ? 'bg-blue-100 text-blue-800' :
                      position.category === 'Crypto' ? 'bg-orange-100 text-orange-800' :
                      position.category === 'Sports' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {position.category}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      position.state === 3
                        ? 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                        : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    }`}>
                      {getStateLabel(position.state)}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    {position.question}
                  </h3>
                </div>
              </div>

              {/* Position Details */}
              <div className="grid grid-cols-2 gap-4 mb-4 p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Your Position</p>
                  <div className="flex items-center space-x-2 mt-1">
                    {hasYesShares && (
                      <span className="px-2 py-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded font-semibold text-sm">
                        YES: {(position.yes_shares / 1_000_000).toFixed(2)} shares
                      </span>
                    )}
                    {hasNoShares && (
                      <span className="px-2 py-1 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded font-semibold text-sm">
                        NO: {(position.no_shares / 1_000_000).toFixed(2)} shares
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Current Odds</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white mt-1">
                    {yesOdds}% YES / {100 - yesOdds}% NO
                  </p>
                </div>
              </div>

              {/* Payout Info */}
              {payout.status === 'resolved' && (
                <div className={`mb-4 p-4 rounded-lg border ${
                  payout.isWinner
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700'
                }`}>
                  {payout.isWinner ? (
                    <>
                      <p className="text-green-800 dark:text-green-200 font-semibold mb-1">
                        🎉 You Won!
                      </p>
                      <p className="text-green-700 dark:text-green-300">
                        Payout: <span className="font-bold">{(payout.amount / 1_000_000).toFixed(2)} credits</span>
                      </p>
                      <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                        Market resolved: {position.result ? 'YES' : 'NO'} won
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-gray-700 dark:text-gray-300 font-semibold mb-1">
                        Market Resolved
                      </p>
                      <p className="text-gray-600 dark:text-gray-400">
                        Your position did not win. Payout: 0 credits
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                        Market resolved: {position.result ? 'YES' : 'NO'} won
                      </p>
                    </>
                  )}
                </div>
              )}

              {payout.status === 'pending' && (
                <div className="mb-4 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <p className="text-blue-800 dark:text-blue-200">
                    ⏳ Market still open - waiting for resolution
                  </p>
                </div>
              )}

              {/* Claim Button */}
              {payout.status === 'resolved' && payout.isWinner && payout.amount > 0 && (
                <button
                  onClick={() => handleClaim(position)}
                  disabled={claiming === position.market_id}
                  className="w-full py-3 px-4 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
                >
                  {claiming === position.market_id ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Claiming...
                    </span>
                  ) : (
                    `Claim ${(payout.amount / 1_000_000).toFixed(2)} Credits`
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Privacy Reminder */}
      {positions.length > 0 && (
        <div className="mt-8 p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
          <p className="text-sm text-purple-800 dark:text-purple-200">
            🔒 <span className="font-semibold">Privacy Protected:</span> Only you can see your positions. Your bets are encrypted on-chain.
          </p>
        </div>
      )}
    </div>
  );
}

export default MyPositions;
