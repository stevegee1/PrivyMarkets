/**
 * update_market_index.mjs — Wire real on-chain market_ids into the frontend
 *
 * Usage:
 *   node update_market_index.mjs <market_id_1> <market_id_2> ... <market_id_N>
 *
 * Example (after creating 3 markets):
 *   node update_market_index.mjs 4053716152field 8821034991field 2293847561field
 *
 * The market IDs must be in the SAME ORDER as the markets in markets-index.json
 * (i.e., the order in which you created them using batch_create_markets.mjs).
 *
 * What this does:
 *   - Updates ../../frontend/public/markets-index.json with real market_ids
 *   - Fetches live pool state to fill in current prices
 *   - Prints a diff of what changed for review
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMarketState, head, log, info, warn, fail, fmt } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.resolve(__dirname, '../../frontend/public/markets-index.json');

const newIds = process.argv.slice(2).map(id =>
  // Leo prints private fields as "12345field.private" — strip the suffix
  id.replace(/\.private$/, '')
);
if (newIds.length === 0) {
  console.error('Usage: node update_market_index.mjs <market_id_1> [market_id_2] ...');
  console.error('IDs must match the order of markets in markets-index.json');
  process.exit(1);
}

head('PrivyMarkets — Update Market Index');

// Load current index
if (!fs.existsSync(INDEX_PATH)) {
  fail(`markets-index.json not found at ${INDEX_PATH}`);
  process.exit(1);
}

const index  = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const markets = index.markets ?? [];

info(`Found ${markets.length} markets in index`);
info(`Received ${newIds.length} market IDs`);

if (newIds.length > markets.length) {
  warn(`More IDs than markets — only updating first ${markets.length}`);
}

// Normalize IDs (ensure they end in 'field')
const normalised = newIds.map(id => id.endsWith('field') ? id : `${id}field`);

// Update market IDs and fetch live state for each
let updated = 0;
for (let i = 0; i < Math.min(normalised.length, markets.length); i++) {
  const oldId = markets[i].market_id;
  const newId = normalised[i];

  markets[i].market_id = newId;

  // Fetch live pool state to populate pricing
  const s = await fetchMarketState(newId);
  if (s.state !== null) {
    markets[i].live = true;
    const yes = Number(s.yes ?? 1n);
    const no  = Number(s.no  ?? 1n);
    const tot = yes + no;
    markets[i].yes_price = parseFloat((yes / tot).toFixed(4));
    markets[i].no_price  = parseFloat((no  / tot).toFixed(4));
    markets[i].volume    = Number(s.vault ?? 0n);
    markets[i].state     = Number(s.state);
    log(`Market ${i + 1}: ${newId} → YES ${(yes/tot*100).toFixed(1)}% / NO ${(no/tot*100).toFixed(1)}%`);
  } else {
    warn(`Market ${i + 1}: ${newId} — not found on-chain yet (tx may be pending)`);
  }
  updated++;
}

// Write updated index
fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
log(`\nUpdated ${updated} market IDs in ${INDEX_PATH}`);
info('Restart the frontend dev server to pick up the new index.');
info('Run `node 1_check_state.mjs <market_id>` to verify each market.');
