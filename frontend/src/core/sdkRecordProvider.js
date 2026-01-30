import {
  Account,
  AleoNetworkClient,
  initThreadPool,
  NetworkRecordProvider,
} from "@provablehq/sdk";

let threadPoolInitialized = false;

/**
 * Fetch records using Provable SDK's NetworkRecordProvider
 * This bypasses Leo Wallet's API and fetches records directly from the network
 * Returns records with full plaintext including nonces
 *
 * @param {string} viewKey - Account view key from wallet
 * @param {string} programId - Program to fetch records from (default: credits.aleo)
 * @returns {Promise<Array>} Array of records with full plaintext and nonces
 */
export async function fetchRecordsViaSDK(viewKey, programId = "credits.aleo") {
  try {
    // Initialize thread pool once (required for WASM operations)
    if (!threadPoolInitialized) {
      console.log("Initializing SDK thread pool...");
      await initThreadPool();
      threadPoolInitialized = true;
      console.log("✅ Thread pool initialized");
    }

    // Create account from view key
    console.log("Creating account from view key...");
    const account = Account.fromViewKey(viewKey);

    // Setup network client pointing to Aleo explorer API
    const networkClient = new AleoNetworkClient(
      "https://api.explorer.provable.com/v1",
    );

    // Create record provider that fetches and decrypts records from network
    const recordProvider = new NetworkRecordProvider(account, networkClient);

    console.log(`Fetching ${programId} records from network...`);

    // Fetch records - different method for credits vs custom programs
    let records;
    if (programId === "credits.aleo") {
      // Use specialized credits method that returns credit records
      records = await recordProvider.findCreditsRecords(
        0, // minCredits
        undefined, // maxCredits
        true, // unspent only
      );
    } else {
      // Generic method for custom program records
      records = await recordProvider.findRecords(
        0, // start height
        undefined, // end height
        true, // unspent only
        programId,
      );
    }

    console.log(`SDK fetched ${records?.length || 0} records`);
    return records || [];
  } catch (error) {
    console.error("SDK record fetch failed:", error);
    throw new Error(`SDK fetch failed: ${error.message}`);
  }
}
