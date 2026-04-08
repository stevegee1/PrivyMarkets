import { PROGRAM_ID } from "./constants.js";

// ─── Config ───────────────────────────────────────────────────────────────────
const EXPLORER   = "https://api.provable.com/v2/testnet";
// Served from frontend/public/markets.json — the admin-controlled registry.
const REGISTRY_URL = "/markets.json";

// ─── On-chain mapping reader ──────────────────────────────────────────────────
// Reads a single value from a public on-chain mapping.
// Handles u64/u128 numbers and booleans correctly.
async function fetchMapping(name, key) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

  // CRITICAL: Aleo explorer mapping keys MUST end with "field"
  const cleanKey = key.toString().trim().endsWith("field") ? key : `${key}field`;

  try {
    const url = `${EXPLORER}/program/${PROGRAM_ID}/mapping/${name}/${cleanKey}`;
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!r.ok) return null;
    const v = await r.json();
    
    // V2 returns { value: "..." }
    const s = v.value?.toString().trim().replace(/"/g, "") || v?.toString().trim().replace(/"/g, "");
    if (s === "true")  return true;
    if (s === "false") return false;
    const m = s.match(/(-?\d+)/);
    return m ? +m[1] : null;
  } catch (e) {
    clearTimeout(timeoutId);
    return null;
  }
}

// ─── Live on-chain state for one market ──────────────────────────────────────
// Returns raw micro-USDCx (u64) values — never pre-divided.
// Returns null if the market_id doesn't exist in any mapping (bad entry in registry).
export async function fetchMarketOnChainState(marketId) {
  const [yesPool, noPool, vault, state, result, winPool] = await Promise.all([
    fetchMapping("yes_pools",      marketId),
    fetchMapping("no_pools",       marketId),
    fetchMapping("vault_balances", marketId),
    fetchMapping("market_states",  marketId),
    fetchMapping("market_results", marketId),
    fetchMapping("winning_pools",  marketId),
  ]);

  // market_states returns null if the market_id has never been written to chain
  if (state === null) return null;

  return {
    yes_pool:     yesPool  ?? 0, // micro-USDCx
    no_pool:      noPool   ?? 0, // micro-USDCx
    vault:        vault    ?? 0, // micro-USDCx
    state:        state    ?? 0, // 0=Open 1=Paused 3=Resolved
    resolved:     state === 3,
    result:       result === true,
    winning_pool: winPool  ?? 0, // micro-USDCx
  };
}

// ─── Fetch the admin-controlled market registry ───────────────────────────────
// markets.json lives in frontend/public/ and is served as a static file.
// Shape of each entry:
//   {
//     market_id:       "<BHP256 field — from MarketInfo record after create_market>",
//     question:        "Will X happen by Y?",
//     description:     "Resolution criteria...",
//     category:        "Crypto" | "Politics" | "Sports" | "Tech" | "General",
//     image:           "<IPFS CID of market image>" | null,
//     resolution_time: <Unix timestamp>,
//     metadata_cid:    "<IPFS CID of full metadata JSON>" | null,
//     source_of_truth: "<URL>" | null
//   }
async function fetchRegistry() {
  try {
    const r = await fetch(`${REGISTRY_URL}?t=${Date.now()}`); // bust cache
    if (!r.ok) throw new Error(`Registry fetch failed: ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error("Registry is not an array");
    return data;
  } catch (e) {
    console.error("fetchRegistry error:", e);
    return [];
  }
}

// ─── Load all markets — the only function callers need ────────────────────────
// 1. Fetch the static registry (markets.json)
// 2. For each entry, verify it exists on-chain and get live pool state
// 3. Filter out any entries that are not yet confirmed on-chain
// 4. Return fully-formed market objects ready for the UI
export async function loadAllMarkets() {
  const registry = await fetchRegistry();
  console.log("Registry fetched:", registry);

  if (!registry || registry.length === 0) {
    console.warn("Market registry is empty or could not be loaded.");
    return [];
  }

  const results = await Promise.all(
    registry.map(async (entry) => {
      const id = entry.market_id;
      if (!id) {
        console.warn("Registry entry missing market_id:", entry);
        return null;
      }

      // Ensure id format is clean
      const idStr = String(id);
      const cleanId = idStr.replace(/\.private$|\.public$/, "").trim();

      try {
        const chain = await fetchMarketOnChainState(cleanId);
        if (!chain) {
          console.warn(`market_states[${cleanId}] returned null`);
        }

      return {
        // React key + identifier
        id:              cleanId,
        market_id:       cleanId,
        // Static metadata from registry
        question:        entry.question        || entry.metadata?.question || null,
        description:     entry.description     || entry.metadata?.description || null,
        category:        entry.category        || entry.metadata?.category || "General",
        image:           entry.image           || entry.metadata?.image || null,
        resolution_time: entry.resolution_time || entry.metadata?.resolution_time || 0,
        metadata_cid:    entry.metadata_cid    || null,
        source_of_truth: entry.source_of_truth || null,
        // Live on-chain state — fall back to zeros if API unavailable
        yes_pool:        chain?.yes_pool     ?? 0,
        no_pool:         chain?.no_pool      ?? 0,
        vault:           chain?.vault        ?? 0,
        state:           chain?.state        ?? 0,
        resolved:        chain?.resolved     ?? false,
        result:          chain?.result       ?? false,
        winning_pool:    chain?.winning_pool ?? 0,
        };
      } catch (e) {
        console.error(`Error loading market ${cleanId}:`, e);
        return null;
      }
    }),
  );

  return results.filter(Boolean);
}

// ─── Legacy alias ─────────────────────────────────────────────────────────────
export const loadDeployedMarkets = loadAllMarkets;
