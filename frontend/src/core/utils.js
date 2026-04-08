/**
 * Format a record for use as a transaction input
 * @param {Object} record - Record object from wallet
 * @returns {string} Formatted record string or null if cannot format
 */
export function formatRecordInput(record) {
  if (!record) {
    console.error("formatRecordInput: No record provided");
    return null;
  }

  // Check if record has plaintext (fully decrypted)
  if (record.plaintext) {
    console.log("Using record.plaintext:", record.id);
    return record.plaintext;
  }

  // Check for nonce - required for manual formatting
  // Try multiple possible nonce locations (different wallets store it differently)
  const nonce =
    record.nonce || record._nonce || record.data?._nonce || record.data?.nonce;

  if (!nonce) {
    console.warn("Missing nonce for record, cannot format as input:", record);
    console.warn("Record structure:", Object.keys(record));
    if (record.data) {
      console.warn("Record.data structure:", Object.keys(record.data));
    }
    return null;
  }

  // Manual formatting from record components
  try {
    const owner = record.owner || record.data?.owner;

    if (!owner || !nonce) {
      console.error("Record missing required fields (owner or nonce)");
      return null;
    }

    // Build record string in Aleo format
    // Format: { owner: address, microcredits: amount, _nonce: group }
    let recordStr = "{\n";
    recordStr += `  owner: ${owner},\n`;

    // Add data fields
    if (record.data) {
      for (const [key, value] of Object.entries(record.data)) {
        if (key !== "owner" && !key.startsWith("_")) {
          recordStr += `  ${key}: ${value},\n`;
        }
      }
    }

    recordStr += `  _nonce: ${nonce}\n`;
    recordStr += "}";

    console.log("Formatted record:", recordStr);
    return recordStr;
  } catch (error) {
    console.error("Failed to format record:", error);
    return null;
  }
}

/**
 * Request permission to access records (for Leo Wallet and similar)
 * @param {Object} wallet - Wallet adapter
 * @param {string} programId - Program ID
 * @returns {Promise<boolean>} True if permission granted
 */
export async function requestRecordPermission(
  wallet,
  programId = "credits.aleo",
) {
  if (!wallet?.adapter) {
    return false;
  }

  // Check if wallet has explicit permission method
  if (typeof wallet.adapter.requestRecordPermission === "function") {
    try {
      console.log("Requesting record permission explicitly...");
      await wallet.adapter.requestRecordPermission(programId);
      return true;
    } catch (error) {
      console.error("Permission request failed:", error);
      return false;
    }
  }

  // For wallets without explicit permission method,
  // try a dummy requestRecords call to trigger permission prompt
  try {
    console.log("Triggering permission via requestRecords...");
    await wallet.adapter.requestRecords(programId);
    return true;
  } catch (error) {
    if (
      error.message?.includes("Permission") ||
      error.message?.includes("NOT_GRANTED")
    ) {
      return false;
    }
    // Other errors might be OK (like "no records found")
    return true;
  }
}

/**
 * Check if wallet can handle automatic record selection
 * @param {Object} wallet - Wallet adapter
 * @returns {boolean} True if wallet supports auto record selection
 */
export function walletSupportsAutoRecordSelection(wallet) {
  // Check if wallet has methods that suggest it can handle records internally
  return (
    wallet?.adapter?.requestTransaction &&
    typeof wallet.adapter.requestTransaction === "function"
  );
}

/**
 * Build transaction inputs without explicit record (for wallets that handle records internally)
 * @param {Object} params - Transaction parameters
 * @returns {Array} Transaction inputs
 */
export function buildTransactionInputsWithoutRecords(params) {
  const {
    marketId,
    publicKey,
    position,
    amountMicro,
    yesMicro,
    noMicro,
    timestamp,
  } = params;

  // Instead of passing the record, we pass a placeholder that tells
  // the wallet to select an appropriate record
  return [
    marketId,
    publicKey, // Wallet will use this to find records
    position,
    `${amountMicro}u64`,
    `${yesMicro}u64`,
    `${noMicro}u64`,
    `${timestamp}u64`,
  ];
}

/**
 * Request records with proper decryption
 * @param {Object} wallet - Wallet adapter
 * @param {string} programId - Program ID to fetch records from
 * @returns {Promise<Array>} Array of decrypted records
 */
export async function requestDecryptedRecords(
  wallet,
  programId = "credits.aleo",
) {
  if (!wallet?.adapter) {
    throw new Error("Wallet not connected");
  }

  console.log(`Requesting records for ${programId}...`);

  let permissionDenied = false; // Track if user denied permission

  // Strategy 0: Provable SDK NetworkRecordProvider
  // DISABLED: Leo Wallet doesn't support requestViewKey() method
  const USE_SDK_APPROACH = false; // TODO: Enable when wallet supports view key access

  if (USE_SDK_APPROACH) {
    // SDK code disabled - see comment above
  }

  // Strategy 1: Try requestRecordPlaintexts first (more reliable for getting nonces)
  try {
    console.log("Strategy 0: Trying Provable SDK NetworkRecordProvider...");

    // Request view key from wallet
    let viewKey;
    try {
      console.log("Requesting view key from wallet...");
      viewKey = await wallet.adapter.requestViewKey();
      console.log("View key received:", viewKey ? "YES" : "NO");
    } catch (vkError) {
      console.error("View key request failed:", vkError);
      throw vkError;
    }

    if (viewKey) {
      // Import SDK provider dynamically to avoid loading if not needed
      const { fetchRecordsViaSDK } = await import("./sdkRecordProvider.js");
      const records = await fetchRecordsViaSDK(viewKey, programId);

      if (records && records.length > 0) {
        console.log(
          `Got ${records.length} records via SDK NetworkRecordProvider`,
        );

        // Validate records have plaintexts
        const goodRecords = records.filter(
          (r) => r.plaintext || r.nonce || r._nonce || r.data?._nonce,
        );

        if (goodRecords.length > 0) {
          console.log(`${goodRecords.length} records have nonce/plaintext`);
          return goodRecords;
        }
      }
    } else {
      console.warn("No view key returned from wallet");
    }
  } catch (error) {
    console.error("SDK NetworkRecordProvider failed:", error);
    if (
      error.message?.includes("Permission") ||
      error.message?.includes("NOT_GRANTED") ||
      error.message?.includes("denied")
    ) {
      permissionDenied = true;
    }
    // Continue to wallet adapter fallback
  }

  // Strategy 1: Try requestRecordPlaintexts first (more reliable for getting nonces)
  // This explicitly asks for decrypted plaintexts which include all fields
  try {
    console.log(
      "Trying wallet.adapter.requestRecordPlaintexts() [preferred method]...",
    );
    const records = await wallet.adapter.requestRecordPlaintexts(programId);

    if (records && records.length > 0) {
      console.log(`Got ${records.length} records via requestRecordPlaintexts`);

      // Validate records have required fields
      const validRecords = records.filter(
        (r) => r.plaintext || r.nonce || r._nonce,
      );
      if (validRecords.length > 0) {
        console.log(
          `${validRecords.length}/${records.length} records have required fields`,
        );
        return records;
      } else {
        console.warn("Records returned but missing nonce/plaintext fields");
      }
    }
  } catch (error) {
    console.log("requestRecordPlaintexts failed:", error.message);
    if (
      error.message?.includes("Permission") ||
      error.message?.includes("NOT_GRANTED")
    ) {
      permissionDenied = true;
    }
    // Don't throw here - continue to try other methods
  }

  // Strategy 2: Try requestRecords (auto-prompts for permission in most wallets)
  try {
    console.log("Trying wallet.adapter.requestRecords() [auto-prompt]...");
    const records = await wallet.adapter.requestRecords(programId);

    if (records && records.length > 0) {
      console.log(`Got ${records.length} records via requestRecords`);

      // Check quality of records (do they have nonce/plaintext?)
      const goodRecords = records.filter(
        (r) => r.plaintext || r.nonce || r._nonce || r.data?._nonce,
      );
      const badRecords = records.length - goodRecords.length;

      if (badRecords > 0) {
        console.warn(
          `Warning: ${badRecords}/${records.length} records missing nonce/plaintext`,
        );
      }

      return records;
    }
  } catch (error) {
    console.log("requestRecords failed:", error.message);
    if (
      error.message?.includes("Permission") ||
      error.message?.includes("NOT_GRANTED")
    ) {
      permissionDenied = true;
    }
    // Don't throw here - continue trying
  }

  // Strategy 3: Try other wallet methods
  const otherMethods = ["getRecords", "decrypt"];

  for (const method of otherMethods) {
    if (typeof wallet.adapter[method] === "function") {
      try {
        console.log(`Trying wallet.adapter.${method}()...`);
        const records = await wallet.adapter[method](programId);

        if (records && records.length > 0) {
          console.log(`Got ${records.length} records via ${method}`);
          return records;
        }
      } catch (error) {
        console.log(`${method} failed:`, error.message);
        if (
          error.message?.includes("Permission") ||
          error.message?.includes("NOT_GRANTED")
        ) {
          permissionDenied = true;
        }
      }
    }
  }

  // If we get here, all methods failed
  console.error("All methods failed or returned incomplete records");

  if (permissionDenied) {
    console.error("Permission denied by user");
    throw new Error(
      "PERMISSION_DENIED: You must approve wallet access to view your records. " +
        "Please click the wallet popup and approve the permission request.",
    );
  }

  throw new Error(
    "Unable to fetch decrypted records. Please ensure wallet is synced and has private credits, then try again.",
  );
}

/**
 * Find a suitable credit record for payment
 * @param {Array} records - Array of credit records
 * @param {BigInt} requiredAmount - Amount needed in microcredits
 * @param {string} publicKey - Owner's public key
 * @returns {Object} Result with { record, totalBalance, recordCount, largestAmount }
 */
export function findPaymentRecord(records, requiredAmount, publicKey) {
  const result = {
    record: null,
    totalBalance: 0n,
    recordCount: 0,
    largestAmount: 0n,
    unformattableCount: 0,
  };

  if (!records || records.length === 0) {
    console.log("No records provided");
    return result;
  }

  console.log(
    `Searching ${records.length} records for ${requiredAmount} microcredits...`,
  );

  let bestRecord = null;
  let bestAmount = 0n;

  for (const record of records) {
    // Skip spent records
    if (record.spent) {
      continue;
    }

    // Check if formattable
    const formatted = formatRecordInput(record);
    if (!formatted) {
      console.log(`Skipping unformattable record: ${record.id}`);
      result.unformattableCount++;
      continue;
    }

    // Check amount
    let amount = 0n;
    if (record.data?.microcredits) {
      try {
        const cleanAmount = record.data.microcredits.toString().split("u")[0];
        amount = BigInt(cleanAmount);
      } catch (e) {
        console.error(`Failed to parse amount for record ${record.id}:`, e);
        continue;
      }
    }

    console.log(`Record ${record.id}: ${amount} microcredits`);

    result.totalBalance += amount;
    result.recordCount++;

    if (amount > bestAmount) {
      bestAmount = amount;
      bestRecord = record;
    }

    if (amount >= requiredAmount) {
      console.log(`Found suitable record: ${record.id}`);
      result.record = record;
      result.largestAmount = bestAmount;
      return result;
    }
  }

  result.largestAmount = bestAmount;
  console.log(
    `No single record found. Total balance: ${result.totalBalance} across ${result.recordCount} records. Largest: ${result.largestAmount}`,
  );
  return result;
}
