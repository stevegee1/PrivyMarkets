/**
 * scan_records.mjs
 * Scans recent Aleo testnet blocks for your private records and prints their plaintext.
 * Usage:  node scan_records.mjs
 * Needs:  PRIVATE_KEY in .env  (or exported in terminal)
 */

import 'dotenv/config';
import { Account, AleoNetworkClient } from '@provablehq/sdk';

// ── Config ──────────────────────────────────────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error(' Set PRIVATE_KEY in .env or export PRIVATE_KEY=APrivateKey1...');
  process.exit(1);
}

// How many of the most recent blocks to scan (increase if no records found)
const BLOCKS_TO_SCAN = parseInt(process.env.SCAN_BLOCKS || '500');

// Programs whose records we care about
const PROGRAMS_OF_INTEREST = [
  'test_usdcx_stablecoin.aleo',
  'privymarkets_v5.aleo',
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const account = new Account({ privateKey: PRIVATE_KEY });
  const address = account.address().to_string();
  const viewKey = account.viewKey().to_string();

  console.log('  Address :', address);
  console.log('  View key:', viewKey);
  console.log('');

  const client = new AleoNetworkClient('https://api.provable.com/v2/testnet');

  // Get latest block height
  const latestBlock = await client.getLatestBlock();
  // SDK may return height as BigInt — convert to Number for arithmetic
  const latest = Number(latestBlock.header.metadata.height);
  const startBlock = Math.max(0, latest - BLOCKS_TO_SCAN);

  console.log(`🔍  Scanning blocks ${startBlock} → ${latest} (last ${BLOCKS_TO_SCAN} blocks)…`);
  console.log('    This may take 30–60 seconds.\n');

  const foundRecords = [];

  // Scan in chunks of 50 blocks (API limit)
  const CHUNK = 50;
  for (let start = startBlock; start <= latest; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, latest);
    try {
      const blocks = await client.getBlockRange(start, end);
      for (const block of blocks) {
        for (const tx of (block.transactions || [])) {
          // Look at all output records in every confirmed transaction
          const outputs = tx.transaction?.execution?.transitions?.flatMap((t) =>
            (t.outputs || []).filter(o => o.type === 'record')
          ) || [];

          for (const output of outputs) {
            try {
              // Try to decrypt with our view key
              const record = account.decryptRecord(output.value);
              if (record) {
                const plaintext = record.toString ? record.toString() : JSON.stringify(record);
                foundRecords.push({
                  block: Number(block.header.metadata.height),
                  txId: tx.transaction?.id,
                  plaintext,
                });
              }
            } catch (_) {
            }
          }
        }
      }
      process.stdout.write(`\r    Progress: block ${end}/${latest}`);
    } catch (e) {
    }
  }

  console.log('\n');

  if (foundRecords.length === 0) {
    console.log(' No records found in the last', BLOCKS_TO_SCAN, 'blocks.');
    console.log('   Try increasing the range:  SCAN_BLOCKS=2000 node scan_records.mjs');
    return;
  }

  console.log(` Found ${foundRecords.length} record(s):\n`);
  for (const r of foundRecords) {
    console.log(`── Block ${r.block} · TX: ${r.txId?.substring(0, 20)}…`);
    console.log(r.plaintext);
    console.log('');
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
