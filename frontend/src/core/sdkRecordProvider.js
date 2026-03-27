/**
 * Fetch records via Provable Explorer API (Plaintext)
 * This is fast and reliable for public/view-key-enabled records
 */
async function fetchRecordsViaExplorer(address, programId) {
  try {
    const url = `https://api.provable.com/v2/testnet/records/all?address=${address}&program=${programId}&unspent=true`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data) ? data : null;
  } catch (e) {
    return null;
  }
}

/**
 * Mirroring Veiled Market pattern: Use Explorer API as primary
 * Avoids browser-side SDK/WASM to prevent loading errors
 */
export async function fetchRecordsViaSDK(viewKey, programId = "credits.aleo", address = null) {
  if (address) {
    const exp = await fetchRecordsViaExplorer(address, programId);
    if (exp && exp.length > 0) {
      console.log(`[records] Explorer found ${exp.length} records for ${programId}`);
      return exp;
    }
  }
  
  console.warn(`[records] No records found via Explorer for ${programId}. (SDK Full-Scan disabled for stability)`);
  return [];
}
