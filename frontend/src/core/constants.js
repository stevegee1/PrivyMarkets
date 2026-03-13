// Program ID for PrivyMarkets — v5 (approve+transfer_from_public, no MerkleProofs)
export const PROGRAM_ID = "privymarket_v5.aleo";

// USDCx uses 6 decimal places — same convention as real USDC
// 1 USDCx = 1_000_000 micro-USDCx
// Amounts in the contract are u128 micro-USDCx
export const USDCX_DECIMALS = 6;
export const USDCX_UNIT = 1_000_000n; // 1 USDCx in micro

// Basis points divisor: prices stored as 0–10_000 (e.g. 6500 = 65%)
export const BASIS_POINTS = 10_000n;

// Minimum bet: 0.1 USDCx = 100_000 micro-USDCx
export const MIN_BET_MICRO = 100_000n;

// Minimum initial market liquidity: 2 USDCx = 2_000_000 micro-USDCx
export const MIN_LIQUIDITY_MICRO = 2_000_000n;

// USDCx testnet program
export const USDCX_PROGRAM_ID = "test_usdcx_stablecoin.aleo";

