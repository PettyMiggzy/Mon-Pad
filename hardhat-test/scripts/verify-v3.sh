#!/usr/bin/env bash
# verify-v3.sh — source-verify the V3 set on Monad via Etherscan V2 standard-JSON.
# (hardhat-verify can't auto-detect because metadata is stripped: bytecodeHash=none,
#  appendCBOR=false. We submit the exact standard-JSON input from the build-info.)
set -uo pipefail
cd "$(dirname "$0")/.."

API="https://api.etherscan.io/v2/api"
CHAINID=143
KEY=$(grep '^EXPLORER_API_KEY=' .env | cut -d= -f2)
COMPILER="v0.8.24+commit.e11b9ed9"
TMP="${TMPDIR:-/tmp}/monpad-verify"
mkdir -p "$TMP"

# Extract the standard-JSON input from the single build-info.
node -e "const fs=require('fs');const d='artifacts/build-info';const f=fs.readdirSync(d).filter(x=>x.endsWith('.json'))[0];const b=JSON.parse(fs.readFileSync(d+'/'+f));fs.writeFileSync('$TMP/input.json', JSON.stringify(b.input));"
echo "standard-json input: $(wc -c < "$TMP/input.json") bytes"

export PATH="$HOME/.foundry/bin:$PATH"
PLATFORM=0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16
TREASURY=0xe7a31fd91a6f2ab0c73db3b7d0954a6a3acc7ab5
BUYBACK=0xe7a31fd91a6f2ab0c73db3b7d0954a6a3acc7ab5
WMON=0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A
NPM=0xa9f6B6656e32F223d778b01642F32D00F5310526
MONSHI=0xB744F5CDb792d8187640214C4A1c9aCE29af7777
FACTORY=0x9ae8376ef5F22e02e217b1A4081686ea9e488E9C
GRAD=0x6cc317d91a18170Fd8fb2027c71A10C4f741E894
CURVE=0x33c6e332a7b062bb436fdD81631227854991859C
TOKEN=0x76C2914bd8F9B44820793d0E285A065A452ce2E5

FACTORY_ARGS=$(cast abi-encode "c(address,address,address,address,address)" $PLATFORM $TREASURY $BUYBACK $WMON $MONSHI | sed 's/^0x//')
GRAD_ARGS=$(cast abi-encode "c(address,address,address)" $FACTORY $NPM $WMON | sed 's/^0x//')

submit() {
  local addr=$1 cname=$2 cargs=$3
  echo ""; echo "=== verifying $cname @ $addr ==="
  local resp
  resp=$(curl -sS --max-time 120 -X POST "$API?chainid=$CHAINID" \
    --data-urlencode "apikey=$KEY" \
    --data-urlencode "module=contract" \
    --data-urlencode "action=verifysourcecode" \
    --data-urlencode "codeformat=solidity-standard-json-input" \
    --data-urlencode "contractaddress=$addr" \
    --data-urlencode "contractname=$cname" \
    --data-urlencode "compilerversion=$COMPILER" \
    --data-urlencode "constructorArguements=$cargs" \
    --data-urlencode "sourceCode@$TMP/input.json")
  echo "submit: $resp"
  local guid
  guid=$(echo "$resp" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).result)}catch{console.log('')}})")
  if [ -z "$guid" ] || echo "$resp" | grep -qi '"status":"0"'; then
    if echo "$resp" | grep -qi "already verified"; then echo "  (already verified)"; return 0; fi
    echo "  submit failed"; return 1
  fi
  for i in $(seq 1 20); do
    sleep 6
    local st
    st=$(curl -sS --max-time 60 "$API?chainid=$CHAINID&module=contract&action=checkverifystatus&guid=$guid&apikey=$KEY")
    echo "  poll $i: $st"
    if echo "$st" | grep -qiE "Pass - Verified|already verified"; then echo "  ✓ VERIFIED"; return 0; fi
    if echo "$st" | grep -qi "Fail - Unable"; then echo "  ✗ FAILED"; return 1; fi
  done
  echo "  timed out polling"; return 1
}

submit "$CURVE"   "contracts/v3/MonPadCurveV3.sol:MonPadCurveV3"         ""
submit "$TOKEN"   "contracts/MonPadTokenV2.sol:MonPadTokenV2"           ""
submit "$FACTORY" "contracts/v3/MonPadFactoryV3.sol:MonPadFactoryV3"    "$FACTORY_ARGS"
submit "$GRAD"    "contracts/v3/MonPadGraduatorV3.sol:MonPadGraduatorV3" "$GRAD_ARGS"
echo ""; echo "done."
