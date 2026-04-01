/**
 * 0_initialize.mjs — Run initialize() to obtain an AdminCap record
 *
 * Usage:
 *   node 0_initialize.mjs
 *
 * MUST be run ONCE before create_market. The resulting AdminCap record
 * is consumed by every admin action (create_market, resolve_market, etc.)
 * The contract re-emits it each time so you never lose it.
 *
 * After running, pull the AdminCap record plaintext from your wallet
 * (Shield → Records or scan_records.mjs) and save it for the next steps.
 */
import 'dotenv/config';
import { PROGRAM_ID, head, log, info, warn } from './helpers.mjs';

const PRIVATE_KEY   = process.env.PRIVATE_KEY;
const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS ||
  'aleo1aqwe9742m69tq0hr5645qcsw5a77u025s0xpedx0y602she0jsyq5pjghk';
const ENDPOINT      = 'https://api.provable.com/v2/testnet';
const BROADCAST     = `${ENDPOINT}/transaction/broadcast`;

head('PrivyMarkets — Step 0: Initialize (get AdminCap)');

if (!PRIVATE_KEY) {
  warn('PRIVATE_KEY not set in .env — showing command template only.');
}

log('Run this ONCE to obtain your AdminCap record:');
console.log(`
  snarkos developer execute ${PROGRAM_ID} initialize \\
    --private-key ${PRIVATE_KEY ?? 'YOUR_PRIVATE_KEY'} \\
    --query ${ENDPOINT} \\
    --broadcast ${BROADCAST} \\
    --priority-fee 1000000
`);

info('The transaction will emit an AdminCap record to your wallet.');
info('Use `node scan_records.mjs` to view your records after ~2 blocks.');
info('Save the AdminCap record plaintext — needed for all admin operations.');
info('');
info('Next step → run: node 2_create_market.mjs');
