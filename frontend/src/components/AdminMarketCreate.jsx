import { useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { uploadToIPFS, uploadImageToIPFS } from '../utils/ipfs';
import { PROGRAM_ID } from "../core/constants.js";
import { createAleoTransaction } from "../core/transaction-helper.js";



function AdminMarketCreate({ onMarketCreated }) {
  const { wallet, address: publicKey } = useWallet();
  const [formData, setFormData] = useState({
    question: '',
    description: '',
    category: 'Crypto',
    resolutionDate: '',
    initialLiquidity: '5',
    sourceOfTruth: '',
    resolverAuthority: '',
  });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please select a valid image file');
        return;
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Image size must be less than 5MB');
        return;
      }

      setImageFile(file);
      setError('');

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const [adminCap, setAdminCap] = useState(''); // Store the AdminCap record string
  const [availableRecords, setAvailableRecords] = useState([]);

  const handleFetchRecords = async () => {
      if (!wallet || !wallet.adapter) return;
      setLoading(true);
      setStatus("Fetching AdminCap records from wallet...");
      try {
          if (wallet.adapter.requestRecords) {
              const records = await wallet.adapter.requestRecords(PROGRAM_ID);
              console.log("=== ALL FETCHED RECORDS ===");
              console.log("Total count:", records ? records.length : 0);
              if (records) {
                  records.forEach((r, idx) => {
                      console.log(`\n--- Record ${idx} ---`);
                      console.log("recordName:", r.recordName);
                      console.log("program_id:", r.program_id);
                      console.log("owner:", r.owner);
                      console.log("spent:", r.spent);
                      console.log("data keys:", r.data ? Object.keys(r.data) : 'NO DATA');
                      console.log("Full record:", r);
                  });
              }

              // Filter for AdminCap records only (not Market records) AND exclude spent ones
              const adminCapRecords = records ? records.filter(r =>
                  (r.recordName === 'AdminCap' || (r.data && !r.data.market_id)) &&
                  r.spent === false  // CRITICAL: Only use unspent records!
              ) : [];

              console.log("\n=== FILTERED AdminCap RECORDS ===");
              console.log("AdminCap count:", adminCapRecords.length);
              console.log("Unspent AdminCap records:", adminCapRecords);
              setAvailableRecords(adminCapRecords);

              // Auto-select the first AdminCap record if available
              if (adminCapRecords && adminCapRecords.length > 0) {
                  const firstRecord = adminCapRecords[0];

                  console.log("✅ Selected UNSPENT AdminCap record:", firstRecord);
                  console.log("Record ID:", firstRecord.id);
                  console.log("Record spent status:", firstRecord.spent);

                  // Store the record object directly - browser wallet uses objects, not plaintext
                  setAdminCap(firstRecord);
                  setStatus(`Loaded unspent AdminCap (ID: ${firstRecord.id.substring(0, 8)}...)`);
              } else {
                  setStatus("No AdminCap records found in wallet. Please run Initialize first or paste manually.");
              }
          } else {
              setError("Wallet does not support record fetching");
          }
      } catch (err) {
          console.error("Failed to fetch records:", err);
          setError("Failed to fetch records: " + (err.message || JSON.stringify(err)));
      } finally {
          setLoading(false);
      }
  };

  // Robust Record Input Formatter
  // Returns Plaintext String (if possible) OR Record Object (if nonce missing)
  const formatRecordInput = (record) => {
      // 1. If explicit plaintext exists, use it
      if (record.plaintext) return record.plaintext;

      // 2. Extract properties
      const owner = record.owner;
      const data = record.data || {};

      // Try to find nonce in various places
      const nonce = record.nonce || record._nonce || data.nonce || data._nonce;

      if (!nonce) {
          console.warn("Missing nonce for record, passing Object reference:", record);
          // Fallback: Return the Object itself. The Wallet Adapter can often look it up by ID.
          // Do NOT JSON.stringify it (that creates an invalid string).
          return record;
      }

      // 3. Construct specific record plaintext if we have nonce
      // AdminCap
      if (record.recordName === 'AdminCap' || (data._version && !data.microcredits)) {
             return `{
  owner: ${owner}.private,
  _nonce: ${nonce},
  _version: ${data._version || '1u8.public'}
}`;
      }

      // Credits
      if (record.program_id === 'credits.aleo' || data.microcredits) {
          return `{
  owner: ${owner}.private,
  microcredits: ${data.microcredits},
  _nonce: ${nonce}
}`;
      }

      // Generic reconstruction
      let fields = [`  owner: ${owner}.private`];
      if (nonce) fields.push(`  _nonce: ${nonce}`);
      for (const [key, val] of Object.entries(data)) {
          if (key === '_nonce') continue;
          fields.push(`  ${key}: ${val}`);
      }
      return `{\n${fields.join(',\n')}\n}`;
  };

  const handleInitialize = async () => {
      if (!publicKey) return;
      setLoading(true);
      setStatus("Initializing protocol (Minting AdminCap)...");
      try {
          const transaction = createAleoTransaction(
              publicKey,
              PROGRAM_ID,
              'initialize',
              [],
              10000
          );
          if (wallet.adapter && wallet.adapter.executeTransaction) {
              const txId = await wallet.adapter.executeTransaction(transaction);
              setStatus(`Initialization Sent! ID: ${txId}. Wait for it to settle, then copy your AdminCap record from your wallet.`);
          }
      } catch (err) {
          console.error("Initialize Error:", err);
          let msg = err.message || JSON.stringify(err);
          if (msg.includes("No records for fee")) {
              msg = "Insufficient public credits for transaction fee (3.0 credits). Please request tokens from the Aleo Faucet.";
          }
          setError("Initialization failed: " + msg);
      } finally {
          setLoading(false);
      }
  };

  // Helper to convert public credits to private
  const handleShield = async (amount) => {
    try {
      setStatus('Requesting Public -> Private conversion...');

      const amountMicrocredits = BigInt(amount) * 1_000_000n;
      // Inputs: [receiver, amount]
      const inputs = [
        publicKey,                      // receiver (self)
        `${amountMicrocredits}u64`      // amount
      ];

      const transaction = createAleoTransaction(
        publicKey,
        'credits.aleo',
        'transfer_public_to_private',
        inputs,
        200000,
        false
      );

      const tx = await wallet.adapter.executeTransaction(transaction);

      console.log('Shield Transaction:', tx);
      alert('Conversion submitted! Please wait for it to confirm, then try creating the market again.');
      setStatus('');
      setLoading(false);
    } catch (err) {
      console.error('Shield failed:', err);
      alert('Shielding failed: ' + err.message);
      setStatus('');
      setLoading(false);
    }
  };

  const handleCreateMarket = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('');

    if (!publicKey) {
      setError('Please connect your wallet first.');
      return;
    }

    if (!adminCap) {
        setError('Please provide an AdminCap record. Run Initialize if you have none.');
        return;
    }

    setLoading(true);
    try {
      // 1. Upload Image to IPFS (if provided)
      let imageCid = null;
      if (imageFile) {
        setStatus('Uploading image to IPFS...');
        try {
          imageCid = await uploadImageToIPFS(imageFile);
          console.log('Image CID:', imageCid);
        } catch (imgError) {
          console.error('Image upload failed:', imgError);
          setError('Image upload failed. Continuing without image...');
          // Continue without image
        }
      }

      // 2. Upload Metadata to IPFS
      setStatus('Uploading metadata to IPFS...');
      const metadata = {
        question: formData.question,
        description: formData.description || '',
        image: imageCid, // Add image CID to metadata
        outcomes: ["YES", "NO"], // Binary for now
        category: formData.category,
        resolution_criteria: formData.description, // Using description as criteria for now
        source_of_truth: formData.sourceOfTruth,
        resolver_authority: formData.resolverAuthority || publicKey, // Default to creator
        dispute_rules: "Standard Optimistic Oracle",
        created_at: new Date().toISOString(),
      };
      const cid = await uploadToIPFS(metadata);
      console.log('IPFS CID:', cid);

      // 2. Prepare Aleo Transaction
      setStatus('Preparing transaction...');

      // Convert Date to Unix Timestamp (u64)
      const resolutionTime = Math.floor(new Date(formData.resolutionDate).getTime() / 1000);

      // Hash CID to Field (Simplified for Hackathon: Use a placeholder or hash)
      // Since we can't easily hash a string to field in JS compatible with Poseidon on-chain without strict encoding,
      // we will use a random field or a simple numeric representation for the uniqueness.
      // Ideally: hash of the question text.
      // For now: We'll pass a random field value as 'question_hash' and assume off-chain indexing links it to IPFS.
      // A better approach in production: Store CID on-chain (as u128 chunks).

      // 3. Compute Hashes
      const jsonString = JSON.stringify(metadata);
      const encoder = new TextEncoder();
      const data = encoder.encode(jsonString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const metadataHashBigInt = BigInt('0x' + hashHex.substring(0, 60)); // Safe fit for u256/field

      const cidData = encoder.encode(cid);
      const cidHashBuffer = await crypto.subtle.digest('SHA-256', cidData);
      const cidHashArray = Array.from(new Uint8Array(cidHashBuffer));
      const cidHashHex = cidHashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      const metadataCidBigInt = BigInt('0x' + cidHashHex.substring(0, 60));

      // Log the AdminCap for debugging
      console.log('AdminCap being used:', adminCap);

      // Validate AdminCap
      let adminCapInput = formatRecordInput(adminCap);
      if (typeof adminCapInput !== 'string' && !adminCapInput.id) {
           console.warn("Admin Cap input is questionable:", adminCapInput);
      }

      // If string, verify owner. If object, assume valid.
      if (typeof adminCapInput === 'string' && !adminCapInput.includes('owner')) {
          throw new Error('Invalid AdminCap format: ' + adminCapInput);
      }

      // --- NEW: Find Credit Record for Initial Liquidity ---
      setStatus('Finding credit record for liquidity...');
      let suitableCreditRecord = null;

      if (wallet.adapter && wallet.adapter.requestRecords) {
          try {
              const credits = await wallet.adapter.requestRecords("credits.aleo");
              const requiredMicrocredits = BigInt(formData.initialLiquidity) * 1_000_000n;

              // Find a record with enough balance
              suitableCreditRecord = credits.find(r => {
                  if (r.spent) return false;
                  // Handle different data formats (e.g. "1000u64.private")
                  let amount = 0n;
                  if (r.data && r.data.microcredits) {
                      // Correctly parse '100u64.private' -> '100'
                      // Split by 'u' to ignore the suffix (u64)
                      const cleanAmount = r.data.microcredits.split('u')[0];
                      try {
                          amount = BigInt(cleanAmount);
                      } catch (e) {
                          console.error("Error parsing amount:", r.data.microcredits, e);
                      }
                  }
                  return amount >= requiredMicrocredits;
              });

              if (!suitableCreditRecord) {
                   const shouldShield = confirm(
                     `Insufficient PRIVATE credits detected.\n\n` +
                     `Required: ${formData.initialLiquidity} Private ALEO\n` +
                     `Would you like to convert Public ALEO to Private ALEO now?`
                   );

                   if (shouldShield) {
                      await handleShield(formData.initialLiquidity);
                      return; // Exit to let shielding complete
                   }

                   throw new Error(
                     `No SINGLE unspent PRIVATE credit record found with at least ${formData.initialLiquidity} credits.\n` +
                     `1. Check your **Private** balance (not Public).\n` +
                     `2. Convert Public -> Private in your wallet if needed (Privacy tab).\n` +
                     `3. If split across records, send credits to yourself to merge.`
                   );
              }
              console.log(" Selected Credit Record:", suitableCreditRecord);
          } catch (fetchErr) {
              console.error("Error fetching credit records:", fetchErr);
              setStatus('');
              setLoading(false);
              // Allow error to bubble up or handle gracefully
              if (fetchErr.message.includes('No SINGLE unspent')) {
                 alert(fetchErr.message);
                 return;
              }
              throw new Error("Failed to find credit records in wallet. Ensure you have enough credits.");
          }
      } else {
          throw new Error("Wallet does not support record fetching.");
      }

      // Convert to microcredits for the transaction (1 credit = 1,000,000 microcredits)
      const initialAmountMicrocredits = BigInt(formData.initialLiquidity) * 1_000_000n;

      // Generate a unique Market ID (field)
      const marketIdVal = BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 1000));
      const marketIdField = `${marketIdVal}field`;

      const inputs = [
        adminCapInput,                              // 1. admin
        marketIdField,                              // 2. market_id (NEW)
        `${metadataCidBigInt.toString()}field`,     // 2. metadata_cid
        `${metadataHashBigInt.toString()}field`,    // 3. metadata_hash
        `${resolutionTime}u64`,                     // 4. resolution_time
        formatRecordInput(suitableCreditRecord),    // 5. initial_credits (Use Formatter)
        `${initialAmountMicrocredits.toString()}u64` // 6. initial_amount
      ];

      console.log('Transaction inputs:', inputs);

      const transaction = createAleoTransaction(
        publicKey,
        PROGRAM_ID,
        'create_market',
        inputs,
        5000,
        false
      );


      setStatus('Requesting wallet signature...');
      if (wallet.adapter && wallet.adapter.executeTransaction) {
         const txId = await wallet.adapter.executeTransaction(transaction);
         setStatus(`Transaction Sent! ID: ${txId}`);

         // Notify parent (OPTIMISTIC API UPDATE for Hackathon demo)
         // In real app: Wait for tx confirmation or indexer
          // Construct the full market object
          const newMarket = {
              id: marketIdField, // Using the Actual Market ID
              market_id: marketIdField, // explicit field for trading
              question: formData.question,
              description: formData.description,
              outcomes: ["Yes", "No"],
              category: formData.category,
              image: imageCid,
              yes_pool: Number(formData.initialLiquidity) / 2,
              no_pool: Number(formData.initialLiquidity) / 2,
              resolution_time: resolutionTime,
              state: 0,
              resolved: false,
              recordPlaintext: null // Not needed for Public Mapping markets
          };

          // Update local state (Optimistic)
          onMarketCreated(newMarket);

          // Generate Shareable Link
          const shareLink = `${window.location.origin}/?market=${encodeURIComponent(JSON.stringify(newMarket))}`;

          // Update Status with Shareable Link
          setStatus(
            `✅ Market created! \n\n` +
            `� **SHAREABLE LINK** (Send this to users):\n\n` +
            shareLink
          );


          // Copy to clipboard safely
          if (navigator.clipboard) {
              navigator.clipboard.writeText(shareLink).then(() => alert("Link copied to clipboard!")).catch(console.error);
          }
          // Let's rely on user copying from the status box for MVP, effectively replacing the JSON block.

          // Auto-refresh AdminCap - DISABLED to keep Success Status visible
          // setTimeout(async () => {
          //   try {
          //      await handleFetchRecords();
          //   } catch (ignore) {}
          // }, 1500);
       } else {
           throw new Error("Wallet adapter does not support transaction request");
       }

    } catch (err) {
      console.error('Market creation failed:', err);
      // Detailed error logging
      console.error('Error details:', {
          message: err.message,
          stack: err.stack,
          full: err
      });
      let errorMsg = err.message || 'Failed to create market.';
      if (errorMsg.includes('No records for fee')) {
          errorMsg = 'Insufficient credits for transaction fee (3.0 credits). Please request tokens from the Aleo Faucet.';
      }
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };


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
              <button
                  onClick={handleFetchRecords}
                  disabled={loading}
                  className={`text-sm font-medium py-2 px-4 rounded-lg transition-colors ${
                      loading
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-100 hover:bg-blue-200 text-blue-700'
                  }`}
              >
                  {loading ? 'Fetching...' : 'Fetch AdminCap'}
              </button>
              <button
                  onClick={handleInitialize}
                  disabled={loading}
                  className={`text-sm font-medium py-2 px-4 rounded-lg transition-colors ${
                      loading
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
              >
                  {loading ? 'Initializing...' : 'Initialize Protocol'}
              </button>
          </div>
      </div>

      <form onSubmit={handleCreateMarket} className="space-y-6">
        {/* Admin Cap Input */}
        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200 mb-6">
            <label className="block text-sm font-medium text-yellow-800 mb-1">
                Admin Capability Record
            </label>
            <textarea
                value={typeof adminCap === 'object' ? JSON.stringify(adminCap, null, 2) : (adminCap || '')}
                onChange={(e) => setAdminCap(e.target.value)}
                placeholder={`{\n  owner: aleo1abc...,\n  _nonce: 123...group.public,\n  _version: 1u8.public\n}`}
                className="w-full px-4 py-2 rounded-lg border border-yellow-300 focus:ring-2 focus:ring-yellow-500 text-sm font-mono"
                rows="5"
                readOnly={typeof adminCap === 'object'}
            />
            <p className="text-xs text-yellow-700 mt-1">
                Click "Fetch AdminCap" above to auto-load from wallet, or paste manually from CLI output.
            </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Market Question</label>
          <input
            type="text"
            name="question"
            required
            placeholder="e.g., Will BTC hit $100k by 2025?"
            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            value={formData.question}
            onChange={handleChange}
          />
        </div>

        {/* Image Upload Field */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Market Image (Optional)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 transition-all file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
          />
          <p className="text-xs text-gray-500 mt-1">
            Upload an image for your market (max 5MB, JPG/PNG/GIF)
          </p>
          {imagePreview && (
            <div className="mt-3">
              <p className="text-sm text-gray-600 mb-2">Preview:</p>
              <img
                src={imagePreview}
                alt="Market preview"
                className="max-w-xs rounded-lg border border-gray-200 shadow-sm"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                    name="category"
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 transition-all"
                    value={formData.category}
                    onChange={handleChange}
                >
                    <option value="Crypto">Crypto</option>
                    <option value="Politics">Politics</option>
                    <option value="Sports">Sports</option>
                    <option value="Tech">Tech</option>
                </select>
             </div>
             <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source of Truth (URL)</label>
                <input
                    type="text"
                    name="sourceOfTruth"
                    placeholder="e.g. binance.com/btc"
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 transition-all"
                    value={formData.sourceOfTruth}
                    onChange={handleChange}
                />
             </div>
        </div>

        <div>
           <label className="block text-sm font-medium text-gray-700 mb-1">Resolution Criteria / Description</label>
           <textarea
             name="description"
             rows="3"
             placeholder="Detailed resolution criteria..."
             className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
             value={formData.description}
             onChange={handleChange}
           />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Resolution Date</label>
            <input
              type="date"
              name="resolutionDate"
              required
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              value={formData.resolutionDate}
              onChange={handleChange}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Initial Liquidity (Credits)</label>
            <input
              type="number"
              name="initialLiquidity"
              required
              min="2"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              value={formData.initialLiquidity}
              onChange={handleChange}
            />
          </div>
        </div>

        {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
                {error}
            </div>
        )}

        {status && (
            <div className="p-4 bg-blue-50 text-blue-700 rounded-lg border border-blue-200">
                {status}
            </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className={`w-full py-3 px-6 text-white font-semibold rounded-lg shadow-md transition-all ${
            loading
              ? 'bg-purple-300 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:shadow-lg transform hover:-translate-y-0.5'
          }`}
        >
          {loading ? 'Creating Market...' : 'Create Market on Aleo'}
        </button>
      </form>
    </div>
  );
}

export default AdminMarketCreate;
