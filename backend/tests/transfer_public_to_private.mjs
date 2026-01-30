import "dotenv/config";
import {
  Account,
  AleoNetworkClient,
  NetworkRecordProvider,
  ProgramManager,
  AleoKeyProvider,
} from "@provablehq/sdk/testnet.js";

const NETWORK_URL = "https://api.explorer.provable.com/v1";

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Error: PRIVATE_KEY environment variable is not set.");
    process.exit(1);
  }

  const amount = parseFloat(process.argv[2]);
  if (isNaN(amount) || amount <= 0) {
    console.error(
      "Usage: node scripts/transfer_public_to_private.mjs <AMOUNT>",
    );
    process.exit(1);
  }

  try {
    const account = new Account({ privateKey });
    const networkClient = new AleoNetworkClient(NETWORK_URL);
    const keyProvider = new AleoKeyProvider();
    keyProvider.useCache(true);
    const recordProvider = new NetworkRecordProvider(account, networkClient);
    const programManager = new ProgramManager(
      NETWORK_URL,
      keyProvider,
      recordProvider,
    );
    programManager.setAccount(account);

    const txId = await programManager.transfer(
      amount,
      process.env.ACCOUNT,
      "transfer_public_to_private",
      0.2,
      false,
    );

    console.log(`\n Transaction Submitted!`);
    console.log(`   TxID: ${txId}`);
    console.log(`   Explorer: https://explorer.aleo.org/transaction/${txId}`);
  } catch (error) {
    console.error("\n Transfer Failed:", error.message);
    if (error.message.includes("Insufficient")) {
      console.error("   Ensure your PUBLIC balance is sufficient.");
    }
  }
}

main();
