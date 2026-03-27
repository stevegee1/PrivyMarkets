import { useState, useCallback } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { uploadToIPFS, uploadImageToIPFS } from '../utils/ipfs';
import { PROGRAM_ID, USDCX_PROGRAM_ID } from "../core/constants.js";
import { createAleoTransaction } from "../core/transaction-helper.js";

// ── Shared UI helpers ────────────────────────────────────────────────────────
function StepBadge({ n, done }) {
  return (
    <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${
      done ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'
    }`}>
      {done ? '✓' : n}
    </span>
  );
}

// ── Field encoding ───────────────────────────────────────────────────────────
// Truncate SHA-256 to fit in an Aleo field element (< ~8×10^76).
// We take the first 60 hex chars (240 bits) which is safely below
// the BLS12-377 scalar field modulus.
const toField = (buf) => {
  const hex = Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return `${BigInt('0x' + hex.substring(0, 60)).toString()}field`;
};

// ── Market ID resolution ─────────────────────────────────────────────────────
// The contract computes: market_id = BHP256::hash_to_field(metadata_hash)
// We CANNOT reproduce BHP256 in JS, so we CANNOT pre-compute market_id.
// Instead, after TX confirms we read the MarketInfo record from the wallet —
// it contains market_id as a plaintext field we can use directly.
const extractMarketIdFromRecord = (record) => {
  // Handles both decrypted object shape and plaintext string shape.
  if (!record) return null;

  // Object shape: { data: { market_id: { ... } } }
  if (typeof record === 'object') {
    const raw = record?.data?.market_id;
    if (raw) {
      const s = typeof raw === 'object' ? (raw.value ?? raw.plaintext ?? JSON.stringify(raw)) : String(raw);
      // Strip ".private" / ".public" suffix and trailing "field" type annotation
      return s.replace(/\.(private|public)$/, '').trim();
    }
    // Plaintext string stored on record directly
    if (record.market_id) return String(record.market_id).replace(/\.(private|public)$/, '').trim();
  }

  // Plaintext string shape: "{ owner: ..., market_id: 123456field.private, ... }"
  if (typeof record === 'string') {
    const m = record.match(/market_id\s*:\s*([\d\-]+field)/);
    if (m) return m[1];
  }

  return null;
};

// ── Poll for MarketInfo record ────────────────────────────────────────────────
// Polls wallet.requestRecords until a fresh unspent MarketInfo record appears
// whose metadata_hash matches what we just submitted.
const pollForMarketInfo = async (adapter, metadataHashField, maxWaitMs = 120_000) => {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const records = await adapter.requestRecords(PROGRAM_ID);
      const candidates = (records || []).filter(r =>
        r.recordName === 'MarketInfo' && r.spent === false
      );
      for (const rec of candidates) {
        // Match on metadata_hash field
        const hash = typeof rec === 'object'
          ? (rec?.data?.metadata_hash?.value ?? rec?.data?.metadata_hash ?? rec?.metadata_hash)
          : null;
        const hashStr = hash ? String(hash).replace(/\.(private|public)$/, '').trim() : '';
        // metadataHashField is e.g. "12345field" — compare core number
        const expectedCore = metadataHashField.replace('field', '');
        if (hashStr === expectedCore || hashStr === metadataHashField) {
          return rec;
        }
      }
      // Also return the most recently created MarketInfo if only one exists
      if (candidates.length === 1) return candidates[0];
    } catch { /* keep polling */ }
    await new Promise(r => setTimeout(r, 5_000));
  }
  return null;
};

function AdminMarketCreate({ onMarketCreated }) {
  const { wallet, address: publicKey } = useWallet();

  const [formData, setFormData] = useState({
    question:          '',
    description:       '',
    category:          'Crypto',
    resolutionDate:    '',
    initialLiquidity:  '10',
    sourceOfTruth:     '',
    resolverAuthority: '',
  });

  const [imageFile,    setImageFile]    = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [adminCap,     setAdminCap]     = useState('');

  // Step state
  const [approveLoading,    setApproveLoading]    = useState(false);
  const [approveDone,       setApproveDone]        = useState(false);
  const [approveTxId,       setApproveTxId]        = useState('');
  const [approveConfirming, setApproveConfirming]  = useState(false);
  const [createLoading,     setCreateLoading]      = useState(false);
  const [awaitingRecord,    setAwaitingRecord]      = useState(false);
  const [status,            setStatus]             = useState('');
  const [error,             setError]              = useState('');
  const [createdMarket,     setCreatedMarket]       = useState(null);
  const [registryCopied,    setRegistryCopied]      = useState(false);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const extractTxId = (result) =>
    typeof result === 'string' ? result : (result?.transactionId ?? JSON.stringify(result));

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please select a valid image file'); return; }
    if (file.size > 5 * 1024 * 1024)    { setError('Image size must be less than 5MB');  return; }
    setImageFile(file);
    setError('');
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const formatRecordInput = (record) => {
    if (typeof record === 'string') return record;
    if (record.plaintext)           return record.plaintext;
    const owner = record.owner;
    const data  = record.data || {};
    const nonce = record.nonce || record._nonce || data.nonce || data._nonce;
    if (owner && nonce) {
      const version = data._version || '1u8.public';
      return `{\n  owner: ${owner}.private,\n  _nonce: ${nonce},\n  _version: ${version}\n}`;
    }
    if (record.recordCiphertext) return record.recordCiphertext;
    return JSON.stringify(record);
  };

  // ── Fetch AdminCap ────────────────────────────────────────────────────────
  const handleFetchRecords = async () => {
    if (!wallet?.adapter) return;
    setCreateLoading(true);
    setError('');
    setStatus('Fetching AdminCap records from wallet...');
    try {
      if (!wallet.adapter.requestRecords) {
        setError('Wallet does not support record fetching.');
        return;
      }
      const records = await wallet.adapter.requestRecords(PROGRAM_ID);
      const adminCapRecords = (records || []).filter(r =>
        r.recordName === 'AdminCap' && r.spent === false
      );
      if (adminCapRecords.length === 0) {
        setStatus('No AdminCap found. Run Initialize first.');
        return;
      }
      const raw = adminCapRecords[0];
      if (raw.owner && raw.data) {
        setAdminCap(raw);
        setStatus('Loaded AdminCap (decrypted).');
        return;
      }
      if (raw.recordCiphertext) {
        setStatus('Decrypting AdminCap record...');
        const adapter = wallet.adapter;
        let plaintext = null;
        try {
          if (adapter.decryptRecord) plaintext = await adapter.decryptRecord(raw.recordCiphertext);
          else if (adapter.decrypt)  plaintext = await adapter.decrypt(raw.recordCiphertext);
        } catch (decryptErr) {
          console.warn('Decrypt attempt failed:', decryptErr);
        }
        if (plaintext) {
          setAdminCap(plaintext);
          setStatus('AdminCap decrypted and loaded.');
        } else {
          setAdminCap(raw.recordCiphertext);
          setStatus('AdminCap loaded as ciphertext. Shield will decrypt on submit.');
        }
        return;
      }
      setAdminCap('');
      setStatus('Unexpected record format. Paste AdminCap plaintext manually.\n\nRaw:\n' + JSON.stringify(raw, null, 2));
    } catch (err) {
      setError('Failed to fetch records: ' + (err.message || JSON.stringify(err)));
    } finally {
      setCreateLoading(false);
    }
  };

  // ── Initialize ────────────────────────────────────────────────────────────
  const handleInitialize = async () => {
    if (!publicKey) return;
    setCreateLoading(true);
    setStatus('Minting AdminCap...');
    try {
      const tx = createAleoTransaction(publicKey, PROGRAM_ID, 'initialize', [], 500_000);
      const txId = extractTxId(await wallet.adapter.executeTransaction(tx));
      setStatus(`Initialized! TX: ${txId}\nClick "Fetch AdminCap" once confirmed.`);
    } catch (err) {
      setError('Initialize failed: ' + (err.message || JSON.stringify(err)));
    } finally {
      setCreateLoading(false);
    }
  };

  // ── Poll TX confirmation ──────────────────────────────────────────────────
  const pollTxConfirmed = useCallback(async (shieldTxId, intervalMs = 4000, maxWaitMs = 180_000) => {
    const adapter  = wallet?.adapter;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      try {
        const rawStatus = await adapter.transactionStatus(shieldTxId);
        const s = (
          typeof rawStatus === 'string'
            ? rawStatus
            : rawStatus?.status ?? rawStatus?.transactionStatus ?? rawStatus?.state ?? ''
        ).toLowerCase().trim();
        setStatus(`Waiting for approval to confirm on-chain...\nShield status: ${s || '(pending)'}`);
        if (s === 'finalized' || s === 'completed' || s === 'accepted') return true;
        if (s === 'rejected'  || s === 'failed')                        return false;
      } catch { /* blip — keep polling */ }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
  }, [wallet?.adapter]);

  // ── Step 1: Approve ───────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!publicKey) { setError('Connect your wallet first.'); return; }
    setError('');
    setApproveLoading(true);
    setStatus('Requesting USDCx approval...');
    try {
      const amountMicro = BigInt(formData.initialLiquidity || 2) * 1_000_000n;
      const tx = createAleoTransaction(
        publicKey, USDCX_PROGRAM_ID, 'approve_public',
        [`${PROGRAM_ID}`, `${amountMicro}u128`],
        500_000
      );
      const txId = extractTxId(await wallet.adapter.executeTransaction(tx));
      setApproveTxId(txId);
      setApproveLoading(false);
      setApproveConfirming(true);
      setStatus(`Approval submitted (TX: ${txId}).\nWaiting for on-chain confirmation...`);
      const confirmed = await pollTxConfirmed(txId);
      if (confirmed) {
        setApproveDone(true);
        setStatus('Approval confirmed. You can now create the market.');
      } else {
        setError(`Approval TX rejected or timed out.\nhttps://explorer.provable.com/transaction/${txId}`);
      }
    } catch (err) {
      setError('Approval failed: ' + (err.message || JSON.stringify(err)));
      setApproveLoading(false);
    } finally {
      setApproveConfirming(false);
    }
  };

  // ── Step 2: Create Market ─────────────────────────────────────────────────
  const handleCreateMarket = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('');

    if (!publicKey)   { setError('Connect your wallet first.'); return; }
    if (!adminCap)    { setError('AdminCap record required. Click "Fetch AdminCap" above.'); return; }
    if (!approveDone) { setError('Complete Step 1 (Approve USDCx) before creating a market.'); return; }

    setCreateLoading(true);
    try {
      // ── Upload image ────────────────────────────────
      let imageCid = null;
      if (imageFile) {
        setStatus('Uploading image to IPFS...');
        try { imageCid = await uploadImageToIPFS(imageFile); } catch { /* continue without image */ }
      }

      // ── Upload metadata ─────────────────────────────
      setStatus('Uploading metadata to IPFS...');
      const metadata = {
        question:            formData.question,
        description:         formData.description || '',
        image:               imageCid,
        outcomes:            ['YES', 'NO'],
        category:            formData.category,
        resolution_criteria: formData.description,
        source_of_truth:     formData.sourceOfTruth,
        resolver_authority:  formData.resolverAuthority || publicKey,
        dispute_rules:       'Standard Optimistic Oracle',
        created_at:          new Date().toISOString(),
      };
      const cid = await uploadToIPFS(metadata);

      // ── Encode fields ───────────────────────────────
      const enc           = new TextEncoder();
      const jsonBytes     = enc.encode(JSON.stringify(metadata));
      const cidBytes      = enc.encode(cid);
      const metaHashBuf   = await crypto.subtle.digest('SHA-256', jsonBytes);
      const cidHashBuf    = await crypto.subtle.digest('SHA-256', cidBytes);

      // These are passed as-is to the contract.
      // The contract derives market_id = BHP256::hash_to_field(metadata_hash)
      // which we cannot reproduce in JS — see Step 3 below.
      const metadataHashField  = toField(metaHashBuf);
      const metadataCidField   = toField(cidHashBuf);
      const resolutionTime     = Math.floor(new Date(formData.resolutionDate).getTime() / 1000);
      const initialAmountMicro = BigInt(formData.initialLiquidity) * 1_000_000n;
      const adminCapInput      = formatRecordInput(adminCap);

      // ── Submit TX ───────────────────────────────────
      setStatus('Submitting create_market transaction...');
      const tx = createAleoTransaction(
        publicKey, PROGRAM_ID, 'create_market',
        [
          adminCapInput,
          metadataCidField,
          metadataHashField,
          `${resolutionTime}u64`,
          `${initialAmountMicro}u128`,
        ],
        3_000_000,
        false
      );
      const txId = extractTxId(await wallet.adapter.executeTransaction(tx));
      setStatus(`Market TX submitted! TX: ${txId}\n\nNow waiting for MarketInfo record to appear in your wallet so we can read the on-chain market_id.\nThis usually takes 1–2 minutes...`);

      // ── Step 3: Read market_id from MarketInfo record ──
      // We CANNOT compute BHP256::hash_to_field(metadata_hash) in JS.
      // The only reliable source of truth is the MarketInfo record
      // the contract emits — it contains market_id as a plaintext field.
      setAwaitingRecord(true);
      const marketInfoRecord = await pollForMarketInfo(
        wallet.adapter,
        metadataHashField,
        120_000
      );
      setAwaitingRecord(false);

      let marketId = null;
      if (marketInfoRecord) {
        marketId = extractMarketIdFromRecord(marketInfoRecord);
        setStatus(` Market created! TX: ${txId}\nOn-chain market_id: ${marketId}`);
      } else {
        // Fallback: couldn't read record in time (wallet sync lag).
        setStatus(
          `Market TX confirmed: ${txId}\n\n` +
          `⚠️ Could not auto-read market_id from wallet within 2 minutes.\n` +
          `Open your Shield wallet → Records → MarketInfo and copy the market_id field.\n` +
          `Replace PENDING_... below with the real market_id before adding to markets.json.`
        );
        marketId = `PENDING_${metadataHashField}`;
      }

      // Build the registry entry the admin needs to paste into public/markets.json
      setCreatedMarket({
        market_id:       marketId,
        question:        formData.question,
        description:     formData.description || '',
        category:        formData.category,
        image:           imageCid || null,
        resolution_time: resolutionTime,
        metadata_cid:    cid || null,
        source_of_truth: formData.sourceOfTruth || null,
      });

      onMarketCreated({
        id:              marketId,
        market_id:       marketId,
        question:        formData.question,
        description:     formData.description,
        outcomes:        ['YES', 'NO'],
        category:        formData.category,
        image:           imageCid,
        yes_pool:        Number(formData.initialLiquidity) / 2,
        no_pool:         Number(formData.initialLiquidity) / 2,
        resolution_time: resolutionTime,
        state:           0,
        resolved:        false,
        ipfs_cid:        cid,
      });

      setApproveDone(false);
      setApproveTxId('');
    } catch (err) {
      let msg = err.message || 'Failed to create market.';
      if (msg.includes('No records for fee'))
        msg = 'Insufficient credits (need 3.0 Aleo). Get tokens from the Aleo Faucet.';
      setError(msg);
    } finally {
      setCreateLoading(false);
      setAwaitingRecord(false);
    }
  };

  const busy = approveLoading || approveConfirming || createLoading || awaitingRecord;

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-md overflow-hidden p-8 border border-gray-100">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-purple-100 rounded-lg">
            <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800">Create Private Market</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={handleFetchRecords} disabled={busy}
            className="text-sm font-medium py-2 px-4 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 disabled:opacity-40 transition-colors">
            Fetch AdminCap
          </button>
          <button onClick={handleInitialize} disabled={busy}
            className="text-sm font-medium py-2 px-4 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-40 transition-colors">
            Initialize Protocol
          </button>
        </div>
      </div>

      <form onSubmit={handleCreateMarket} className="space-y-6">

        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
          <label className="block text-sm font-medium text-yellow-800 mb-1">Admin Capability Record</label>
          <textarea
            value={typeof adminCap === 'object' ? JSON.stringify(adminCap, null, 2) : (adminCap || '')}
            onChange={(e) => setAdminCap(e.target.value)}
            placeholder={'{\n  owner: aleo1abc....private,\n  _nonce: 626231...group.public,\n  _version: 1u8.public\n}'}
            className="w-full px-4 py-2 rounded-lg border border-yellow-300 focus:ring-2 focus:ring-yellow-500 text-sm font-mono"
            rows="5"
          />
          <p className="text-xs text-yellow-700 mt-1">
            Click "Fetch AdminCap" to auto-load, or paste the plaintext record manually from your Shield wallet.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Market Question</label>
          <input type="text" name="question" required
            placeholder="e.g., Will BTC hit $100k by end of 2025?"
            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 transition-all"
            value={formData.question} onChange={handleChange} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Market Image (optional)</label>
          <input type="file" accept="image/*" onChange={handleImageChange}
            className="w-full px-4 py-2 rounded-lg border border-gray-300 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100" />
          <p className="text-xs text-gray-500 mt-1">Max 5 MB — JPG / PNG / GIF</p>
          {imagePreview && (
            <img src={imagePreview} alt="preview"
              className="mt-3 max-w-xs rounded-lg border border-gray-200 shadow-sm" />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select name="category"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 transition-all"
              value={formData.category} onChange={handleChange}>
              <option>Crypto</option><option>Politics</option>
              <option>Sports</option><option>Tech</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source of Truth (URL)</label>
            <input type="text" name="sourceOfTruth" placeholder="e.g. binance.com/btc"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 transition-all"
              value={formData.sourceOfTruth} onChange={handleChange} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Resolution Criteria / Description</label>
          <textarea name="description" rows="3"
            placeholder="Detailed resolution criteria..."
            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 transition-all"
            value={formData.description} onChange={handleChange} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Resolution Date</label>
            <input type="date" name="resolutionDate" required
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 transition-all"
              value={formData.resolutionDate} onChange={handleChange} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Initial Liquidity (USDCx)</label>
            <input type="number" name="initialLiquidity" required min="2"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 transition-all"
              value={formData.initialLiquidity} onChange={handleChange} />
            <p className="text-xs text-gray-500 mt-1">
              Min 2 USDCx — Get testnet tokens at{' '}
              <a href="https://usdcx.aleo.dev/" target="_blank" rel="noreferrer"
                className="text-purple-600 underline">usdcx.aleo.dev</a>
            </p>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-amber-50 border border-amber-300">
          <div className="flex items-center gap-2 mb-2">
            <StepBadge n="1" done={approveDone} />
            <h3 className="text-sm font-semibold text-amber-800">
              Approve USDCx spending
              {approveDone && <span className="ml-2 text-green-600 font-normal">— confirmed ✓</span>}
            </h3>
          </div>
          <p className="text-xs text-amber-700 mb-3">
            Authorises the contract to pull the initial liquidity from your public USDCx balance.
            Must be confirmed on-chain before Step 2.
          </p>
          <button type="button" onClick={handleApprove}
            disabled={approveLoading || approveConfirming || approveDone || !publicKey}
            className={`w-full py-2.5 px-4 rounded-lg text-white text-sm font-semibold transition-colors mb-2 ${
              approveDone
                ? 'bg-green-500 cursor-default'
                : approveLoading || !publicKey
                  ? 'bg-amber-300 cursor-not-allowed'
                  : 'bg-amber-500 hover:bg-amber-600'
            }`}>
            {approveLoading    ? 'Sending…'
             : approveConfirming ? 'Waiting for confirmation…'
             : approveDone       ? 'Approved ✓'
             :                    'Approve in Wallet'}
          </button>
          {publicKey && !approveDone && (
            <button
              onClick={() => {
                const amountMicro = BigInt(formData.initialLiquidity || 2) * 1_000_000n;
                const cmd = `snarkos developer execute ${USDCX_PROGRAM_ID} approve_public "${PROGRAM_ID}" "${amountMicro}u128" --private-key YOUR_PRIVATE_KEY --query https://api.provable.com/v2/testnet --priority-fee 1000000`;
                navigator.clipboard.writeText(cmd);
                alert('CLI command copied!');
              }}
              className="w-full py-1 text-[10px] text-amber-700 font-mono hover:underline"
            >
              📋 Copy snarkos CLI Approve command
            </button>
          )}
          {approveTxId && (
            <p className="text-xs text-amber-700 mt-2 break-all">
              TX: <span className="font-mono">{approveTxId}</span>
            </p>
          )}
        </div>

        <div className="p-4 rounded-lg bg-purple-50 border border-purple-200">
          <div className="flex items-center gap-2 mb-2">
            <StepBadge n="2" done={false} />
            <h3 className="text-sm font-semibold text-purple-800">Create Market on Aleo</h3>
          </div>
          <p className="text-xs text-purple-700 mb-3">
            Uploads metadata to IPFS, submits the <code>create_market</code> transaction, then
            reads the <code>MarketInfo</code> record from your wallet to get the correct on-chain{' '}
            <code>market_id</code>.
          </p>
          <button type="submit" disabled={busy || !approveDone}
            className={`w-full py-3 px-6 text-white font-semibold rounded-lg shadow-md transition-all mb-2 ${
              busy || !approveDone
                ? 'bg-purple-300 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:shadow-lg hover:-translate-y-0.5'
            }`}>
            {awaitingRecord ? 'Reading market_id from wallet…'
             : createLoading ? 'Creating Market…'
             :                 'Create Market'}
          </button>
          {publicKey && approveDone && !busy && (
            <button
              onClick={async (e) => {
                e.preventDefault();
                // We'd need to pre-compute hashes here for the CLI, similar to handleCreateMarket logic
                alert('For Create Market CLI, metadata needs to be uploaded to IPFS first. Use the Web UI for the metadata step if possible.');
              }}
              className="w-full py-1 text-[10px] text-purple-600 font-mono hover:underline text-center"
            >
              ℹ️ CLI for Create Market is complex (IPFS required)
            </button>
          )}
          {awaitingRecord && (
            <p className="text-xs text-purple-600 mt-2 text-center animate-pulse">
              Waiting for MarketInfo record to appear in your wallet (up to 2 min)…
            </p>
          )}
        </div>

        {error  && <div className="p-4 bg-red-50   text-red-700  rounded-lg border border-red-200   text-sm">{error}</div>}
        {status && <div className="p-4 bg-blue-50  text-blue-700 rounded-lg border border-blue-200  text-sm whitespace-pre-wrap">{status}</div>}
      </form>

      {createdMarket && (
        <div className="mt-8 p-5 rounded-xl border-2 border-green-400 bg-green-50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-green-600 text-xl">🎉</span>
              <h3 className="text-base font-bold text-green-800">Step 3 — Add to Market Registry</h3>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  JSON.stringify(createdMarket, null, 2)
                );
                setRegistryCopied(true);
                setTimeout(() => setRegistryCopied(false), 2000);
              }}
              className="text-xs font-semibold py-1.5 px-3 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
            >
              {registryCopied ? '✓ Copied!' : 'Copy JSON'}
            </button>
          </div>
          <p className="text-xs text-green-700 mb-3">
            Copy this entry and add it to{' '}
            <code className="font-mono bg-green-100 px-1 rounded">frontend/public/markets.json</code>.
            {createdMarket.market_id.startsWith('PENDING_') && (
              <span className="text-amber-700 font-semibold"> Replace the PENDING_... market_id with the real value from your Shield wallet → Records → MarketInfo.</span>
            )}
          </p>
          <pre className="text-xs font-mono bg-white border border-green-200 rounded-lg p-3 overflow-x-auto text-gray-700 whitespace-pre">
            {JSON.stringify(createdMarket, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default AdminMarketCreate;
