#!/usr/bin/env bash
# run-fork-e2e.sh — spin up an anvil Monad-mainnet fork, run the full V3
# lifecycle against the REAL deployed contracts (zero real MON), then tear down.
#
#   ./scripts/run-fork-e2e.sh "<monad-mainnet-rpc-url>"
#
# Needs foundry (anvil) on PATH:  curl -L https://foundry.paradigm.xyz | bash && foundryup
set -euo pipefail

RPC="${1:-${MAINNET_RPC:-}}"
if [ -z "$RPC" ]; then echo "usage: $0 <monad-mainnet-rpc-url>  (or set MAINNET_RPC)"; exit 1; fi
command -v anvil >/dev/null || { echo "anvil not found — install foundry first"; exit 1; }

echo "Starting anvil fork…"
anvil --fork-url "$RPC" --hardfork cancun --port 8545 --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT

# wait for anvil to accept connections
for i in $(seq 1 30); do
  if cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then break; fi
  sleep 1
done

node scripts/fork-e2e-anvil.js
