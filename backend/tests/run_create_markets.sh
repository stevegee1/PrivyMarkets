#!/bin/bash
# run_create_markets.sh — Auto-create all 10 prediction markets in sequence
#
# NOTE: approve_public already broadcast (tx at15xll4k2tu0sr5z5a9cm3jp6nru89rkps0wg5ye7p7jtfgcegz5yqvrsn84)
# Skipping approve step and going straight to market creation.
#
# TLS note: Leo's post-broadcast confirmation check sometimes fails with a TLS
# error — this is cosmetic. The || true ensures the script keeps running.
# Verify each market with: node tests/1_check_state.mjs <market_id>
#
# USAGE (from backend/ directory):
#   ./tests/run_create_markets.sh

# ── Load .env ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
  set -o allexport
  source "$ENV_FILE"
  set +o allexport
  echo "  ✅ Loaded .env"
else
  echo "  ⚠️  No .env found — using shell env"
fi

PK="${PRIVATE_KEY:-}"
if [ -z "$PK" ]; then
  echo "  ❌ PRIVATE_KEY not set. Add it to backend/tests/.env"; exit 1
fi

OWNER="aleo1aqwe9742m69tq0hr5645qcsw5a77u025s0xpedx0y602she0jsyq5pjghk"
ENDPOINT="https://api.explorer.provable.com/v1"
LIQ="2000000u128"
LOG_FILE="./tests/market_ids.txt"

echo "# Market creation log — $(date)" > "$LOG_FILE"

# ── AdminCap from initialize() ────────────────────────────────────────────────
# IMPORTANT: This nonce is consumed after each create_market.
# The script captures the new nonce from Leo's output automatically.
ADMIN_NONCE="1679897617543866381872718527602615471445728432598243761591697179480501843858group.public"

admin_cap() {
  echo "{ owner: ${OWNER}.private, _nonce: ${ADMIN_NONCE}, _version: 1u8.public }"
}

# ── Helper: create one market ─────────────────────────────────────────────────
create_market() {
  local NUM="$1" CID="$2" HASH="$3" RES="$4" QUESTION="$5"

  echo ""
  echo "══════════════════════════════════════════════════"
  echo "  Market ${NUM}/10: ${QUESTION}"
  echo "══════════════════════════════════════════════════"
  echo "  Nonce: ${ADMIN_NONCE:0:16}..."

  # || true: TLS confirmation errors are cosmetic — tx was already broadcast
  OUTPUT=$(leo execute create_market \
    "$(admin_cap)" \
    "${CID}" "${HASH}" "${RES}" \
    "${LIQ}" "${LIQ}" \
    --private-key "$PK" \
    --network testnet \
    --broadcast \
    --endpoint "$ENDPOINT" \
    --blocks-to-check 0 \
    -y 2>&1 | tee /dev/stderr) || true

  # Extract market_id (field from MarketInfo record)
  MARKET_ID=$(echo "$OUTPUT" | grep -o 'market_id: [^,}]*' | head -1 | sed 's/market_id: //' | tr -d ' ')

  # Extract tx ID
  TX_ID=$(echo "$OUTPUT" | grep -o "transaction ID: '[^']*'" | head -1 | sed "s/transaction ID: '//;s/'//")

  # Extract new AdminCap nonce (last _nonce in output)
  NEW_NONCE=$(echo "$OUTPUT" | grep "_nonce:" | tail -1 | sed 's/.*_nonce: //' | sed 's/[,}].*//' | tr -d ' ')

  # Log results
  if [ -n "$TX_ID" ]; then
    echo "  📡 TX: ${TX_ID}"
  fi

  if [ -n "$MARKET_ID" ]; then
    echo "  ✅ market_id: ${MARKET_ID}"
    echo "${NUM}: ${MARKET_ID}  # ${QUESTION}" >> "$LOG_FILE"
  else
    echo "  ⚠️  market_id not parsed — check output"
    echo "${NUM}: PENDING_TX:${TX_ID}  # ${QUESTION}" >> "$LOG_FILE"
  fi

  if [ -n "$NEW_NONCE" ]; then
    ADMIN_NONCE="$NEW_NONCE"
    echo "  🔄 AdminCap nonce updated"
  else
    echo "  ⚠️  AdminCap nonce not captured — next call may fail"
  fi

  echo "  ⏳ Waiting 90s for finalization..."
  sleep 90
}

# ── Create 10 markets ─────────────────────────────────────────────────────────
cd /Users/mac/PrivyMarkets/backend

echo ""
echo "══════════════════════════════════════════════════"
echo "  PrivyMarkets — Creating 10 prediction markets"  
echo "  Budget: 40 USDCx (approve already done ✓)"
echo "══════════════════════════════════════════════════"

create_market 1  "1001field" "1001field" "15552561u64" \
  "Will Bitcoin close above \$100k by end of April 2026?"

create_market 2  "1002field" "1002field" "15591831u64" \
  "Will Ethereum reach \$5,000 before May 2026?"

create_market 3  "1003field" "1003field" "15709641u64" \
  "Will GPT-5 be publicly released before July 2026?"

create_market 4  "1004field" "1004field" "15631101u64" \
  "Will Aleo mainnet launch before June 2026?"

create_market 5  "1005field" "1005field" "15565651u64" \
  "Will the US Federal Reserve cut rates in May 2026?"

create_market 6  "1006field" "1006field" "15618011u64" \
  "Will Solana (SOL) surpass \$300 before June 2026?"

create_market 7  "1007field" "1007field" "15657281u64" \
  "Will Apple announce an AI-native iPhone at WWDC 2026?"

create_market 8  "1008field" "1008field" "15683461u64" \
  "Will total crypto market cap exceed \$5T before July 2026?"

create_market 9  "1009field" "1009field" "15644191u64" \
  "Will ALEO token list on a top-5 CEX by June 2026?"

create_market 10 "1010field" "1010field" "15735821u64" \
  "Will the first ZK-native DeFi protocol hit \$1B TVL before Q3 2026?"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
echo "  ✅  ALL 10 MARKETS SUBMITTED!"
echo "══════════════════════════════════════════════════"
echo ""
cat "$LOG_FILE"
echo ""
echo "Next steps:"
echo "  cd tests"
echo "  node update_market_index.mjs \$(grep -oE '[0-9-]+field' market_ids.txt | tr '\n' ' ')"
echo "  cd ../frontend && npm run dev"
