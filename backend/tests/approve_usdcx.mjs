/**
 * approve_usdcx.mjs — Approve privymarket_v6.aleo to spend USDCx
 *
 * Usage:
 *   node approve_usdcx.mjs [amount_usdcx]
 *
 * Example:
 *   node approve_usdcx.mjs 40    # approves 40 USDCx (40_000_000 µUSDCx)
 */
import 'dotenv/config';
import { AleoNetworkClient, NetworkRecordProvider, ProgramManager, AleoKeyProvider } from '@provablehq/sdk';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('❌ PRIVATE_KEY not set in .env'); process.exit(1);
}

const amountUSDCx = parseFloat(process.argv[2] ?? '40');
const amountMicro = Math.round(amountUSDCx * 1_000_000);
const PROGRAM     = 'privymarket_v6.aleo';
const USDCX       = 'test_usdcx_stablecoin.aleo';
const ENDPOINT    = 'https://api.provable.com/v2/testnet';

console.log(`\n  🔑 Approving ${amountUSDCx} USDCx (${amountMicro} µUSDCx)`);
console.log(`  📋 Spender: ${PROGRAM}`);
console.log(`  🌐 Endpoint: ${ENDPOINT}\n`);

const networkClient = new AleoNetworkClient(ENDPOINT);
const keyProvider   = new AleoKeyProvider();
keyProvider.useCache(true);

const recordProvider = new NetworkRecordProvider(PRIVATE_KEY, networkClient);
const programManager = new ProgramManager(ENDPOINT, keyProvider, recordProvider);
programManager.setAccount(PRIVATE_KEY);

try {
  console.log('  ⏳ Submitting approve_public transaction...\n');

  const txId = await programManager.execute({
    programName:    USDCX,
    functionName:   'approve_public',
    fee:            2.0,
    privateFee:     false,
    inputs:         [PROGRAM, `${amountMicro}u128`],
  });

  console.log(`  ✅ Approved!`);
  console.log(`  📡 Transaction ID: ${txId}`);
  console.log(`\n  ⏳ Wait ~60 seconds for finalization, then run:`);
  console.log(`     ./tests/run_create_markets.sh\n`);
} catch (e) {
  console.error(`  ❌ Error: ${e.message}`);
  if (e.message?.includes('balance')) {
    console.error('  💡 You may not have enough USDCx. Check your balance first.');
  }
  process.exit(1);
}
