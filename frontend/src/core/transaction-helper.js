// Transaction helper for @provablehq wallet adapters
// The new adapters use executeTransaction() with TransactionOptions

export function createAleoTransaction(
  publicKey,
  program,
  functionName,
  inputs,
  fee = 200000,
  privateFee = false,
) {
  return {
    program,
    function: functionName, // API uses 'function' not 'functionName'
    inputs,
    fee,
    privateFee,
  };
}
