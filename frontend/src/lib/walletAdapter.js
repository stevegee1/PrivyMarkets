/**
 * walletAdapter.js — Enhanced wallet dispatch for Aleo wallets
 *
 * Key insight from Veiled Markets (wallet.ts):
 *   The ProvableHQ alpha adapter uses requestTransaction() internally, but
 *   requestExecution() is the CORRECT method for executing program functions.
 *   We bypass the adapter and call the wallet extension directly, with a
 *   multi-method fallback chain.
 *
 * Call order:
 *   1. window.leoWallet.requestExecution({ chainId: 'testnetbeta', ... })
 *   2. window.leoWallet.requestExecution({ chainId: 'testnet', ... })
 *   3. window.leoWallet.requestTransaction({ chainId: 'testnetbeta', ... })
 *   4. window.leoWallet.requestTransaction({ chainId: 'testnet', ... })
 *   5. adapter.executeTransaction() fallback (Shield / Puzzle)
 */

// ── Wallet detection ──────────────────────────────────────────────────────────
export function getInstalledWallets() {
  const installed = [];
  if (window.shieldWallet || window.shield) installed.push('shield');
  if (window.leoWallet   || window.leo)   installed.push('leo');
  if (window.puzzleWalletClient)           installed.push('puzzle');
  if (window.foxWallet)                    installed.push('fox');
  return installed;
}

export function isShieldWalletInstalled() {
  return !!(window.shieldWallet || window.shield);
}

export function isLeoWalletInstalled() {
  return !!(window.leoWallet || window.leo);
}

// ── Poll for on-chain transaction ID ─────────────────────────────────────────
// Leo Wallet returns a UUID event ID, not the at1... tx ID.
// ZK proving for complex programs takes 1-3 min — poll every 5s.
export async function pollForTransactionId(eventId, maxAttempts = 40, onChainVerify = null) {
  console.log('[walletAdapter] Polling for on-chain tx ID:', eventId);

  const leoWallet = window.leoWallet || window.leo;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Strategy 1: Manual on-chain verification (source of truth)
    if (onChainVerify && attempt > 0 && attempt % 2 === 0) {
      try {
        const verified = await onChainVerify();
        if (verified) {
          console.log('[walletAdapter] Dual-Polling: confirmed via manual on-chain verification!');
          return 'confirmed_manual';
        }
      } catch (e) { console.warn('[walletAdapter] Manual verify error:', e); }
    }

    // Strategy 2: Wallet status API
    try {
      if (leoWallet && typeof leoWallet.transactionStatus === 'function') {
        const status = await leoWallet.transactionStatus(eventId);

        if (status) {
          const statusStr = status.status || '';
          if (statusStr === 'Failed' || statusStr === 'Rejected') return null;

          const onChainId = status.transactionId || status.transaction_id || status.txId || status.id;
          if (onChainId && typeof onChainId === 'string' && onChainId.startsWith('at1')) return onChainId;

          if ((statusStr === 'Finalized' || statusStr === 'Completed') && status.transaction?.id?.startsWith('at1')) {
            return status.transaction.id;
          }
        }
      }
    } catch (err) { /* wait and retry */ }

    // Strategy 3: Check explorer directly for the eventId (if supported)
    if (attempt > 5 && attempt % 3 === 0 && !eventId.startsWith('at1')) {
      try {
        const resp = await fetch(`https://api.explorer.provable.com/v1/testnet/transaction/${eventId}`);
        if (resp.ok) return eventId;
      } catch { /* wait and retry */ }
    }

    await new Promise(r => setTimeout(r, 6000));
  }

  return null;
}

/**
 * Dispatch an Aleo transaction with full fallback chain.
 *
 * @param {object} adapter     - The ProvableHQ adapter from useWallet()
 * @param {object} request     - { programId, functionName, inputs, fee, onChainVerify }
 * @returns {Promise<string>}  - Transaction ID (at1... or UUID event ID)
 */
export async function requestTransaction(adapter, { programId, functionName, inputs, fee = 0.5, onChainVerify = null }, address = null) {
  // Input validation
  if (!Array.isArray(inputs)) throw new Error('inputs must be an array');
  for (let i = 0; i < inputs.length; i++) {
    if (typeof inputs[i] !== 'string' || !inputs[i]) {
      throw new Error(`Input ${i} must be a non-empty string`);
    }
  }

  const leoWallet = window.leoWallet || window.leo;

  // Fee: callers pass in ALEO, Leo Wallet expects MICROCREDITS (integer)
  const feeInMicrocredits = Math.round(fee * 1_000_000);

  // Veiled Markets found Leo Wallet requires the address field to correctly
  // route the transaction to the right account
  const txData = {
    ...(address ? { address } : {}),
    chainId: 'testnetbeta',
    transitions: [{ program: programId, functionName, inputs }],
    fee: feeInMicrocredits,
    feePrivate: false,
  };

  let result = null;

  if (leoWallet) {
    // 1. requestExecution, chainId=testnetbeta (best method)
    if (typeof leoWallet.requestExecution === 'function') {
      try {
        console.log('[walletAdapter] Method 1: requestExecution (testnetbeta)');
        result = await leoWallet.requestExecution(txData);
      } catch (err) {
        console.warn('[walletAdapter] Method 1 failed:', err?.message);

        // 2. requestExecution, chainId=testnet
        try {
          console.log('[walletAdapter] Method 2: requestExecution (testnet)');
          result = await leoWallet.requestExecution({ ...txData, chainId: 'testnet' });
        } catch (err2) {
          console.warn('[walletAdapter] Method 2 failed:', err2?.message);
        }
      }
    }

    // 3. requestTransaction, chainId=testnetbeta
    if (!result && typeof leoWallet.requestTransaction === 'function') {
      try {
        console.log('[walletAdapter] Method 3: requestTransaction (testnetbeta)');
        result = await leoWallet.requestTransaction(txData);
      } catch (err) {
        console.warn('[walletAdapter] Method 3 failed:', err?.message);

        // 4. requestTransaction, chainId=testnet
        try {
          console.log('[walletAdapter] Method 4: requestTransaction (testnet)');
          result = await leoWallet.requestTransaction({ ...txData, chainId: 'testnet' });
        } catch (err2) {
          console.warn('[walletAdapter] Method 4 failed:', err2?.message);
        }
      }
    }
  }

  // 5. Adapter fallback (Shield, Puzzle, Fox wallets)
  if (!result) {
    console.log('[walletAdapter] Method 5: adapter.executeTransaction fallback');
    result = await adapter.executeTransaction({
      program: programId,
      function: functionName,
      inputs,
      fee: feeInMicrocredits,
      privateFee: false,
    });
  }

  if (!result) throw new Error('All wallet dispatch methods failed');

  // Extract transaction ID
  let txId = null;
  if (typeof result === 'string') {
    txId = result;
  } else if (result && typeof result === 'object') {
    txId =
      result.transactionId ||
      result.txId ||
      result.id ||
      result.transaction_id ||
      result.aleoTransactionId;
  }

  if (!txId) throw new Error('No transaction ID returned from wallet');

  console.log('[walletAdapter] Got tx ID:', txId);

  // If it's a UUID event ID (not at1...), try to get the real on-chain tx ID with Dual-Polling
  if (!txId.startsWith('at1') && txId.includes('-')) {
    console.log('[walletAdapter] UUID event ID detected, polling for at1... ID with Dual-Polling');
    const realTxId = await pollForTransactionId(txId, 40, onChainVerify);
    if (realTxId === 'confirmed_manual') return txId; // Keep UUID but treat as confirmed
    if (realTxId) return realTxId;
  }

  return txId;
}

// ── Error normalizer ──────────────────────────────────────────────────────────
export function normalizeWalletError(error) {
  const msg = error?.message || String(error);

  if (msg.includes('User rejected') || msg.includes('denied') || msg.includes('rejected')) {
    return new Error('Transaction rejected by user');
  }
  if (msg.includes('Insufficient') || msg.includes('balance')) {
    return new Error('Insufficient balance for this transaction');
  }
  if (msg.includes('not found') || msg.includes('does not exist')) {
    return new Error('Program or function not found on blockchain');
  }
  if (msg.includes('timeout') || msg.includes('Timeout')) {
    return new Error('Wallet connection timed out — please try again');
  }
  if (msg.includes('not installed') || msg.includes('No wallet')) {
    return new Error('No compatible Aleo wallet found — install Leo or Shield wallet');
  }

  return new Error(`Transaction failed: ${msg}`);
}
