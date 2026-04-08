#!/bin/bash
# MonPad V2 — Monad Mainnet Deploy Script
# Usage: bash deploy-mainnet.sh

set -e

export PATH="$HOME/.foundry/bin:$PATH"

# ── Config ────────────────────────────────────────────────
RPC="https://rpc.monad.xyz"
CHAIN_ID=143
PRIVATE_KEY=$(cat ~/.monpad-deployer-key | tr -d '[:space:]')

# Constructor args for MonPadFactory(platform, treasury, wmon, npm)
PLATFORM="0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16"
TREASURY="0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd"
WMON="0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A"
NPM="0xa9f6B6656e32F223d778b01642F32D00F5310526"

DEPLOYER=$(cast wallet address "$PRIVATE_KEY")
echo "🔑 Deployer: $DEPLOYER"
echo "💰 Balance: $(cast balance --rpc-url $RPC $DEPLOYER --ether) MON"
echo ""

# Verify deployer matches treasury
if [ "$DEPLOYER" != "$TREASURY" ]; then
    echo "⚠️  WARNING: Deployer ($DEPLOYER) != Treasury ($TREASURY)"
    echo "Press Enter to continue or Ctrl+C to abort..."
    read
fi

echo "📋 Deploy Config:"
echo "  Platform: $PLATFORM"
echo "  Treasury: $TREASURY"
echo "  WMON:     $WMON"
echo "  NPM:      $NPM"
echo ""

# ── Compile ───────────────────────────────────────────────
echo "🔨 Compiling..."
cd /tmp/monpad-compile
cp /home/king-petty/.openclaw/workspace/Mon-Pad/deploy/MonPadV2.sol src/MonPadV2.sol
forge build --contracts src/MonPadV2.sol 2>&1 | grep -E "Compil|success|error"
echo ""

# ── Deploy Factory ────────────────────────────────────────
echo "🚀 Deploying MonPadFactory..."
RESULT=$(forge create \
    --rpc-url "$RPC" \
    --chain-id $CHAIN_ID \
    --private-key "$PRIVATE_KEY" \
    --constructor-args "$PLATFORM" "$TREASURY" "$WMON" "$NPM" \
    src/MonPadV2.sol:MonPadFactory \
    --json 2>&1)

echo "$RESULT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(f'✅ Factory deployed at: {d[\"deployedTo\"]}')
    print(f'📦 TX hash: {d[\"transactionHash\"]}')
    print(f'⛽ Gas used: {d.get(\"gasUsed\", \"unknown\")}')
    
    # Save addresses
    with open('/home/king-petty/.openclaw/workspace/Mon-Pad/deploy/deployed-addresses.json', 'w') as f:
        json.dump({
            'factory': d['deployedTo'],
            'txHash': d['transactionHash'],
            'deployer': '$DEPLOYER',
            'platform': '$PLATFORM',
            'treasury': '$TREASURY',
            'wmon': '$WMON',
            'npm': '$NPM',
            'chainId': $CHAIN_ID,
            'rpc': '$RPC'
        }, f, indent=2)
    print('💾 Addresses saved to deploy/deployed-addresses.json')
except:
    print('Raw output:')
    print(sys.stdin.read() if hasattr(sys.stdin, 'read') else '')
"

echo ""
echo "🔍 Verify on Monadscan: https://monadscan.com/address/<FACTORY_ADDRESS>"
echo ""
echo "Next steps:"
echo "  1. Update FACTORY_ADDRESS in lib/constants.js"
echo "  2. Update server.js on droplet"
echo "  3. Deploy frontend to Vercel"
