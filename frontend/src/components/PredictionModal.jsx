import { useState, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { PROGRAM_ID } from "../core/constants.js";
import { createAleoTransaction } from "../core/transaction-helper.js";
import {
  formatRecordInput,
  requestDecryptedRecords,
  findPaymentRecord
} from "../core/utils.js";

function PredictionModal({ market, onClose }) {
  const { wallet, address: publicKey } = useWallet(); // Use 'address' from new adapter, alias as publicKey for minimal changes
  const [position, setPosition] = useState(true); // true = YES, false = NO
  const [isBuy, setIsBuy] = useState(true); // true = buy, false = sell
  const [amount, setAmount] = useState(''); // For BUY tab
  const [sharesToSell, setSharesToSell] = useState(''); // For SELL tab
  const [calculatedShares, setCalculatedShares] = useState(0); // Shares from BUY
  const [calculatedPayout, setCalculatedPayout] = useState(0); // Payout from SELL
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Real-time State (Normalized to Microcredits)
  const [currentYesPool, setCurrentYesPool] = useState(Math.floor(market.yes_pool * 1_000_000));
  const [currentNoPool, setCurrentNoPool] = useState(Math.floor(market.no_pool * 1_000_000));
  const [stateLoading, setStateLoading] = useState(false);

  // Fetch latest pool state when modal opens
  useEffect(() => {
      const fetchPools = async () => {
          if (!market.market_id) return;
          setStateLoading(true);
          try {
              // Fetch Yes Pool
              const yesRes = await fetch(`https://api.explorer.provable.com/v1/testnet/program/${PROGRAM_ID}/mapping/yes_pools/${market.market_id}`);
              if (yesRes.ok) {
                  const val = await yesRes.json();
                  if (val !== null) {
                      const match = val.toString().match(/(\d+)/);
                      if (match) setCurrentYesPool(parseInt(match[1]));
                  }
              }

              // Fetch No Pool
              const noRes = await fetch(`https://api.explorer.provable.com/v1/testnet/program/${PROGRAM_ID}/mapping/no_pools/${market.market_id}`);
              if (noRes.ok) {
                  const val = await noRes.json();
                  if (val !== null) {
                      const match = val.toString().match(/(\d+)/);
                      if (match) setCurrentNoPool(parseInt(match[1]));
                  }
              }
          } catch (e) {
              console.error("Failed to fetch pool state:", e);
          } finally {
              setStateLoading(false);
          }
      };

      fetchPools();
  }, [market.market_id]);

  // Calculate shares for BUY (spending credits)
  const calculateSharesToBuy = () => {
    if (!amount || parseFloat(amount) <= 0) return 0;

    const amountMicro = parseFloat(amount) * 1_000_000;
    const targetPool = position ? currentYesPool : currentNoPool;
    const otherPool = position ? currentNoPool : currentYesPool;

    // CPMM with slippage
    const totalBefore = targetPool + otherPool;
    const priceBefore = (targetPool / totalBefore) * 100;

    const newTargetPool = targetPool + amountMicro;
    const totalAfter = newTargetPool + otherPool;
    const priceAfter = (newTargetPool / totalAfter) * 100;

    const avgPrice = (priceBefore + priceAfter) / 2;
    return Math.floor((amountMicro * 100) / avgPrice);
  };

  // Calculate payout for SELL (selling owned shares)
  const calculatePayoutForSell = () => {
    if (!sharesToSell || parseFloat(sharesToSell) <= 0) return 0;

    const sharesVal = parseFloat(sharesToSell);
    const sharesMicro = sharesVal * 1_000_000;
    const targetPool = position ? currentYesPool : currentNoPool;
    const otherPool = position ? currentNoPool : currentYesPool;

    // Reverse CPMM - payout based on current price
    const total = targetPool + otherPool;
    const currentPrice = (targetPool / total) * 100;
    const payout = Math.floor((sharesMicro * currentPrice) / 100);

    return payout;
  };

  // Calculate new odds after trade
  const calculateNewOdds = () => {
    const currentTotal = currentYesPool + currentNoPool;
    if (currentTotal === 0) return 50;

    if (isBuy) {
      if (!amount || parseFloat(amount) <= 0) {
        return Math.round((currentYesPool / currentTotal) * 100);
      }

      const amountMicro = parseFloat(amount) * 1_000_000;
      const newYesPool = position ? currentYesPool + amountMicro : currentYesPool;
      const newNoPool = position ? currentNoPool : currentNoPool + amountMicro;
      const newTotal = newYesPool + newNoPool;
      return Math.round((newYesPool / newTotal) * 100);
    } else {
      if (!sharesToSell || parseFloat(sharesToSell) <= 0) {
         return Math.round((currentYesPool / currentTotal) * 100);
      }

      const payout = calculatePayoutForSell();
      const newYesPool = position ? currentYesPool - payout : currentYesPool;
      const newNoPool = position ? currentNoPool : currentNoPool - payout;

      const newTotal = newYesPool + newNoPool;
      if (newTotal === 0) return 50;
      return Math.round((newYesPool / newTotal) * 100);
    }
  };

  // Recalculate when inputs change
  useEffect(() => {
    if (isBuy) {
      const shares = calculateSharesToBuy();
      setCalculatedShares(shares);
    } else {
      const payout = calculatePayoutForSell();
      setCalculatedPayout(payout);
    }
  }, [amount, sharesToSell, position, isBuy]);

  const wouldTriggerCircuitBreaker = () => {
    const newOdds = calculateNewOdds();
    return newOdds > 99 || newOdds < 1;
  };

  // Helper to convert public credits to private
const handleShield = async (shieldAmount) => {
  try {
    const amountMicrocredits = BigInt(Math.floor(parseFloat(shieldAmount) * 1_000_000));

    const inputs = [
      publicKey,
      `${amountMicrocredits}u64`
    ];

    const transaction = createAleoTransaction(
      publicKey,
      'credits.aleo',
      'transfer_public_to_private',
      inputs,
      200000, // 0.2 credits fee
      false
    );

    const tx = await wallet.adapter.executeTransaction(transaction);
    console.log('Shield Transaction:', tx);

      alert('Conversion submitted! Please wait for it to confirm, then try buying again.');
      setIsSubmitting(false);
      onClose();
    } catch (err) {
      console.error('Shield failed:', err);
      alert('Shielding failed: ' + err.message);
      setIsSubmitting(false);
    }
  };

  const handlePlaceTrade = async () => {
    if (!publicKey) {
      alert('Please connect your wallet first');
      return;
    }

    if (isBuy) {
      if (!amount || parseFloat(amount) <= 0) {
        alert('Please enter a valid amount');
        return;
      }
    } else {
      if (!sharesToSell || parseFloat(sharesToSell) <= 0) {
        alert('Please enter number of shares to sell');
        return;
      }
      alert('SELL requires Position record management\n\nComing soon!');
      setIsSubmitting(false);
      return;
    }

    if (wouldTriggerCircuitBreaker()) {
      alert('This trade would trigger the circuit breaker (1%-99% limits)');
      return;
    }

    setIsSubmitting(true);

    try {
      const amountMicro = BigInt(Math.floor(parseFloat(amount) * 1_000_000));
      const timestamp = Math.floor(Date.now() / 1000);

      if (!wallet || !wallet.adapter) {
         throw new Error("Wallet not connected");
      }

      if (isBuy) {
        // --- BUY SHARES - Direct approach with clear error handling ---
        console.log('🔒 Preparing to buy shares...');

        const yesMicroVal = BigInt(currentYesPool);
        const noMicroVal = BigInt(currentNoPool);
        let inputs;

        // Fetch credit records from wallet
        console.log('Fetching credit records from wallet...');
        try {
          const creditRecords = await requestDecryptedRecords(wallet, "credits.aleo");
          console.log(`Found ${creditRecords.length} credit records`);

          // DEBUG: Log address formats
          console.log("🔍 DEBUG - Connected address:", publicKey);
          console.log("🔍 DEBUG - Sample record owner:", creditRecords[0]?.owner);
          console.log("🔍 DEBUG - Formats match?", creditRecords[0]?.owner === publicKey);

          // Try to find a usable record
          const paymentRecord = findPaymentRecord(creditRecords, amountMicro, publicKey);

          if (!paymentRecord) {
            // Check why no record was found
            const unformattableCount = creditRecords.filter(r => {
              if (r.spent) return false;
              if (r.owner !== publicKey) return false;
              return !formatRecordInput(r);
            }).length;

            if (unformattableCount > 0) {
              // Records exist but can't be formatted (missing nonce)
              console.warn(`${unformattableCount} records missing nonce - need to shield`);

              const shouldShield = window.confirm(
                `Wallet Records Incomplete\n\n` +
                `Your wallet has ${unformattableCount} record(s) missing required data (nonce).\n\n` +
                `This happens when records aren't fully decrypted.\n\n` +
                `SOLUTION: Convert public credits to private (creates fresh, usable records)\n\n` +
                `Convert ${amount} Aleo now?`
              );

              if (shouldShield) {
                await handleShield(amount);
                return;
              }

              throw new Error('Cannot use wallet records - missing nonce data');
            } else {
              // Insufficient funds
              const totalBalance = creditRecords
                .filter(r => !r.spent && r.owner === publicKey)
                .reduce((sum, r) => {
                  try {
                    const amt = BigInt(r.data?.microcredits?.split('u')[0] || '0');
                    return sum + amt;
                  } catch {
                    return sum;
                  }
                }, 0n);

              const shouldShield = window.confirm(
                `Insufficient Private Credits\n\n` +
                `Need: ${(Number(amountMicro) / 1_000_000).toFixed(6)} Aleo\n` +
                `Have: ${(Number(totalBalance) / 1_000_000).toFixed(6)} Aleo (private)\n\n` +
                `Convert public to private?`
              );

              if (shouldShield) {
                await handleShield(amount);
                return;
              }

              throw new Error('Insufficient private credits');
            }
          }

          // Format the record
          const formattedRecord = formatRecordInput(paymentRecord);
          if (!formattedRecord) {
            const shouldShield = window.confirm(
              ` Record Cannot Be Used\n\n` +
              `The selected record is missing required data (nonce).\n\n` +
              `Convert ${amount} Aleo from public to private to create a fresh record?`
            );

            if (shouldShield) {
              await handleShield(amount);
              return;
            }

            throw new Error('Record missing required fields (nonce)');
          }

          console.log('✅ Using record:', paymentRecord.id);

          // Build transaction inputs
          inputs = [
            market.market_id,
            formattedRecord,
            position,
            `${amountMicro}u64`,
            `${yesMicroVal}u64`,
            `${noMicroVal}u64`,
            `${timestamp}u64`
          ];

        } catch (error) {
          console.error('Error fetching records:', error);

          // Handle permission denied specifically
          if (error.message?.includes('PERMISSION_DENIED')) {
            alert(
              ` Permission Required\n\n` +
              `You must approve wallet access to view your private records.\n\n` +
              `Please:\n` +
              `1. Look for the wallet popup/notification\n` +
              `2. Click "Approve" or "Allow"\n` +
              `3. Try again`
            );
            setIsSubmitting(false);
            return;
          }

          // For other errors, rethrow to be handled by outer catch
          throw error;
        }

        // Build and submit transaction
        console.log('Building transaction with', inputs.length, 'parameters...');

        const transaction = createAleoTransaction(
          publicKey,
          PROGRAM_ID,
          'buy_shares',
          inputs,
          3_000_000,
          false
        );

        console.log('Submitting transaction to wallet...');
        const response = await wallet.adapter.executeTransaction(transaction);
        console.log('✅ Transaction submitted:', response);

        alert(
          `Shares Purchased Successfully!\n\n` +
          `Market: ${market.question}\n` +
          `Bought ${position ? 'YES' : 'NO'} shares\n` +
          `Amount: ${amount} Aleo\n` +
          `Shares: ${(calculatedShares / 1_000_000).toFixed(2)}\n\n` +
          `Transaction ID: ${response}`
        );

        onClose();

      } else {
        // --- SELL SHARES ---
        const sharesToSellVal = parseFloat(sharesToSell);
        if (sharesToSellVal <= 0) throw new Error("Invalid share amount");
        const sharesMicro = BigInt(Math.floor(sharesToSellVal * 1_000_000));

        console.log('Fetching position records...');
        let positionRecords;
        try {
          positionRecords = await wallet.adapter.requestRecords(PROGRAM_ID);
        } catch (recordError) {
          if (recordError.message?.includes('Permission')) {
            alert('Please approve access to your position records');
            setIsSubmitting(false);
            return;
          }
          throw recordError;
        }

        const positionRecord = positionRecords.find(r => {
          if (r.spent) return false;
          if (r.recordName !== 'Position') return false;
          if (!r.data || r.data.market_id !== market.market_id) return false;

          const ownedShares = position
            ? BigInt(r.data.yes_shares.split('u')[0])
            : BigInt(r.data.no_shares.split('u')[0]);

          return ownedShares >= sharesMicro;
        });

        if (!positionRecord) {
          throw new Error(`No position with enough ${position ? 'YES' : 'NO'} shares`);
        }

        console.log('Found position record:', positionRecord.id);

        const yesMicroVal = BigInt(currentYesPool);
        const noMicroVal = BigInt(currentNoPool);

        const inputs = [
          market.market_id,
          formatRecordInput(positionRecord),
          position,
          `${sharesMicro}u64`,
          `${yesMicroVal}u64`,
          `${noMicroVal}u64`
        ];

        const transaction = createAleoTransaction(
          publicKey,
          PROGRAM_ID,
          position ? 'buy_shares' : 'sell_shares',
          inputs,
          5000,
          false
        );

        const response = await wallet.adapter.executeTransaction(transaction);
        console.log('Transaction submitted:', response);

        alert(
          ` Shares Sold Successfully!\n\n` +
          `Market: ${market.question}\n` +
          `Sold ${position ? 'YES' : 'NO'} shares\n` +
          `Amount: ${sharesToSell}\n` +
          `Payout: ~${(calculatedPayout / 1_000_000).toFixed(3)} Credits\n\n` +
          `Transaction ID: ${response}`
        );

        onClose();
      }

    } catch (error) {
      console.error(' Transaction failed:', error);

      // Better error messages
      const errorMsg = error.message || error.toString();

      if (errorMsg.includes('Permission') || errorMsg.includes('denied')) {
        alert(
          `Permission Denied\n\n` +
          `Please approve wallet prompts to continue.\n` +
          `Try disconnecting and reconnecting your wallet.`
        );
      } else if (errorMsg.includes('Insufficient') || errorMsg.includes('No suitable')) {
        const shouldShield = window.confirm(
          `Insufficient Private Credits\n\n` +
          `Convert public Aleo to private Aleo now?`
        );
        if (shouldShield) {
          await handleShield(amount);
          return;
        }
      } else if (errorMsg.includes('rejected') || errorMsg.includes('cancelled')) {
        alert('Transaction cancelled');
      } else if (errorMsg.includes('record')) {
        alert(
          `Record Error\n\n` +
          `${errorMsg}\n\n` +
          `Try:\n` +
          `• Wait for wallet to sync\n` +
          `• Disconnect/reconnect wallet\n` +
          `• Use Leo Wallet`
        );
      } else {
        alert(`Transaction failed: ${errorMsg}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const newOdds = calculateNewOdds();
  const currentOdds = Math.round((market.yes_pool / (market.yes_pool + market.no_pool)) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-md bg-slate-900 dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-700 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Market Image */}
        {market.image && (
          <div className="mb-4">
            <img
              src={`https://gateway.pinata.cloud/ipfs/${market.image}`}
              alt={market.question}
              className="w-full h-48 object-cover rounded-t-xl"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          </div>
        )}

        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div className="flex-1 pr-4">
              <h3 className="text-lg font-bold text-white mb-2">{market.question}</h3>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Buy/Sell Tabs */}
          <div className="flex gap-1 mb-6 border-b-2 border-slate-700">
            <button
              onClick={() => setIsBuy(true)}
              className={`flex-1 pb-3 text-base font-semibold transition-all ${
                isBuy
                  ? 'text-white border-b-2 border-cyan-500 -mb-0.5'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Buy
            </button>
            <button
             onClick={() => setIsBuy(false)}
              className={`flex-1 pb-3 text-base font-semibold transition-all ${
                !isBuy
                  ? 'text-white border-b-2 border-cyan-500 -mb-0.5'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Sell
            </button>
          </div>

          {/* Position Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-3">Select Outcome</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setPosition(true)}
                className={`px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  position
                    ? 'bg-green-600/30 border-2 border-green-500 text-white shadow-lg shadow-green-500/20'
                    : 'bg-slate-800 border-2 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="mb-0.5">YES</div>
                <div className="text-xs font-normal opacity-80">{currentOdds}¢</div>
              </button>
              <button
                onClick={() => setPosition(false)}
                className={`px-3 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                  !position
                    ? 'bg-red-600/30 border-2 border-red-500 text-white shadow-lg shadow-red-500/20'
                    : 'bg-slate-800 border-2 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="mb-0.5">NO</div>
                <div className="text-xs font-normal opacity-80">{100 - currentOdds}¢</div>
              </button>
            </div>
          </div>

          {/* Input Section - conditional based on BUY/SELL */}
          {isBuy ? (
            <>
              {/* Amount Input for BUY */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Amount (Aleo credits)</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
                  min="0"
                  step="0.001"
                />
              </div>

              {/* Shares Display for BUY */}
              {amount && parseFloat(amount) > 0 && (
                <>
                  <div className="mb-4 p-4 rounded-lg bg-slate-800 border border-slate-700">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-slate-400">Shares</span>
                      <span className="text-lg font-bold text-white">{(calculatedShares / 1_000_000).toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Stats for BUY */}
                  <div className="mb-6 p-4 rounded-lg bg-slate-800 border border-slate-700 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-400">Total cost</span>
                      <span className="text-base font-semibold text-white">{amount} credits</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-400">Potential payout</span>
                      <span className="text-base font-semibold text-green-400">
                        {(calculatedShares / 1_000_000).toFixed(3)} credits
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-400">To win</span>
                      <span className="text-base font-semibold text-green-400">
                        +{((calculatedShares - parseFloat(amount) * 1_000_000) / 1_000_000).toFixed(3)} credits
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-slate-700">
                      <span className="text-sm text-slate-400">New odds</span>
                      <span className="text-base font-semibold text-cyan-400">{newOdds}%</span>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* Shares Input for SELL */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">Shares to sell</label>
                <input
                  type="number"
                  value={sharesToSell}
                  onChange={(e) => setSharesToSell(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
                  min="0"
                  step="1"
                />
                <p className="text-xs text-slate-500 mt-2">Enter the number of shares you want to sell</p>
              </div>

              {/* Payout Display for SELL */}
              {sharesToSell && parseFloat(sharesToSell) > 0 && (
                <div className="mb-6 p-4 rounded-lg bg-slate-800 border border-slate-700 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-400">Shares selling</span>
                    <span className="text-base font-semibold text-white">{parseFloat(sharesToSell).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-400">You'll receive</span>
                    <span className="text-base font-semibold text-green-400">
                      {(calculatedPayout / 1_000_000).toFixed(3)} credits
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-700">
                    <span className="text-sm text-slate-400">New odds</span>
                    <span className="text-base font-semibold text-cyan-400">{newOdds}%</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Circuit Breaker Warning */}
          {wouldTriggerCircuitBreaker() && (
            <div className="mb-6 p-3 rounded-lg bg-red-900/30 border border-red-700 flex items-start space-x-2">
              <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div>
                <div className="font-medium text-red-300 text-sm mb-1">Circuit Breaker Triggered</div>
                <p className="text-sm text-red-400">
                  This trade would push odds beyond 99% or below 1%. Please reduce your amount.
                </p>
              </div>
            </div>
          )}

          {/* Privacy Reminder */}
          <div className="mb-6 p-3 rounded-lg bg-purple-900/30 border border-purple-700 flex items-start space-x-2">
            <svg className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <div>
              <div className="font-medium text-purple-300 text-sm mb-1">Privacy Guarantee</div>
              <p className="text-sm text-purple-400">
                Your position, amount, and odds are completely private on Aleo.
              </p>
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={handlePlaceTrade}
            disabled={isSubmitting || !amount || wouldTriggerCircuitBreaker()}
            className={`w-full px-6 py-4 rounded-lg font-semibold text-lg transition-all ${
              isSubmitting || !amount || wouldTriggerCircuitBreaker()
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-cyan-600 text-white hover:bg-cyan-500 shadow-lg shadow-cyan-500/30'
            }`}
          >
            {isSubmitting ? 'Submitting...' : 'Trade'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PredictionModal;
