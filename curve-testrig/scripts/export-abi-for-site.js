/*
 * Regenerate lib/rekt/abi.ts for the MonPad site's hidden /lab launcher.
 *
 * The site needs two things from this repo and must never drift from them: the pad's ABI (including
 * every custom error, so a revert shows a name rather than a hex blob) and PadToken's creation
 * bytecode, which the browser needs to mine a CREATE2 salt — the token address decides which side of
 * WETH it sorts on, and that is one of the two settings that determines whether bots show up.
 *
 *   npx hardhat run scripts/export-abi-for-site.js
 */
const fs = require("fs");
const path = require("path");
const pad = require("../artifacts/contracts/experiments/RektPad.sol/RektPad.json");
const tok = require("../artifacts/contracts/pads/PadToken.sol/PadToken.json");

const KEEP = new Set(["launch","previewLaunch","isOperator","declareExperiment","launchCount","FACTORY","WETH","NPM","EXPECTED_CHAIN_ID","owner"]);
const abi = pad.abi.filter((x) =>
  (x.type === "function" && KEEP.has(x.name)) || x.type === "error" || (x.type === "event" && x.name === "Launched"));

const out = `// GENERATED from curve-testrig artifacts — do not hand-edit.
// Regenerate after any RektPad change:  npx hardhat run scripts/export-abi-for-site.js
export const PAD_TOKEN_BYTECODE = ${JSON.stringify(tok.bytecode)} as const;

export const REKT_PAD_ABI = ${JSON.stringify(abi)} as const;
`;
const dest = path.join(__dirname, "../../lib/rekt/abi.ts");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log(`wrote ${dest} (${(out.length / 1024).toFixed(1)} KB)`);

// The pad's own creation bytecode, so the site can deploy a pad instead of requiring a funded key and a
// CLI. Kept in a SEPARATE module from the ABI on purpose: it is ~20 KB of bytecode that only matters on
// the one click that deploys, so /lab import()s it lazily and nobody pays for it on the way to a launch.
const ctor = pad.abi.find((x) => x.type === "constructor");
if (!ctor) throw new Error("RektPad artifact has no constructor in its ABI");
const deployed = (pad.deployedBytecode.length - 2) / 2;
if (deployed > 24576) throw new Error(`RektPad deployed bytecode is ${deployed} bytes, over the EIP-170 limit`);

const bytecodeOut = `// GENERATED from curve-testrig artifacts — do not hand-edit.
// Regenerate after any RektPad change:  npx hardhat run scripts/export-abi-for-site.js
//
// Deployed size at export: ${deployed} bytes (EIP-170 limit 24576).
export const REKT_PAD_BYTECODE = ${JSON.stringify(pad.bytecode)} as const;

export const REKT_PAD_CONSTRUCTOR_ABI = ${JSON.stringify([ctor])} as const;
`;
const bytecodeDest = path.join(__dirname, "../../lib/rekt/padBytecode.ts");
fs.writeFileSync(bytecodeDest, bytecodeOut);
console.log(`wrote ${bytecodeDest} (${(bytecodeOut.length / 1024).toFixed(1)} KB, deployed ${deployed} bytes)`);

// ----------------------------------------------------------------------------------------------------
// RektCurve — the bonding-curve pad, where the raise becomes the pool's quote side.
// ----------------------------------------------------------------------------------------------------
const curve = require("../artifacts/contracts/experiments/RektCurve.sol/RektCurve.json");
const CURVE_KEEP = new Set([
  "create", "buy", "sell", "graduate", "curves", "previewBuy", "previewSell", "predictToken",
  "tokenCount", "tokens", "isOperator", "setOperator", "totalRaised", "FACTORY", "WETH", "NPM", "owner",
]);
const curveAbi = curve.abi.filter(
  (x) =>
    (x.type === "function" && CURVE_KEEP.has(x.name)) ||
    x.type === "error" ||
    x.type === "constructor" ||
    (x.type === "event" && ["Created", "Bought", "Sold", "Graduated"].includes(x.name)),
);
const curveDeployed = (curve.deployedBytecode.length - 2) / 2;
if (curveDeployed > 24576) throw new Error(`RektCurve deployed bytecode is ${curveDeployed} bytes, over EIP-170`);

// ABI and bytecode go in SEPARATE modules, same as the pad's, and for a reason worth stating: the panel
// imports the ABI statically (every read needs it) and the bytecode dynamically (only the deploy click
// does). Put them in one module and the static import drags the bytecode into the page chunk, so the
// dynamic import defers nothing at all.
const curveOut = `// GENERATED from curve-testrig artifacts — do not hand-edit.
// Regenerate after any RektCurve change:  npx hardhat run scripts/export-abi-for-site.js
export const REKT_CURVE_ABI = ${JSON.stringify(curveAbi)} as const;
`;
const curveDest = path.join(__dirname, "../../lib/rekt/curve.ts");
fs.writeFileSync(curveDest, curveOut);
console.log(`wrote ${curveDest} (${(curveOut.length / 1024).toFixed(1)} KB)`);

const curveBcOut = `// GENERATED from curve-testrig artifacts — do not hand-edit.
// Regenerate after any RektCurve change:  npx hardhat run scripts/export-abi-for-site.js
//
// Deployed size at export: ${curveDeployed} bytes (EIP-170 limit 24576).
// Kept apart from the ABI so a static ABI import cannot pull this into the page's first load.
export const REKT_CURVE_BYTECODE = ${JSON.stringify(curve.bytecode)} as const;
`;
const curveBcDest = path.join(__dirname, "../../lib/rekt/curveBytecode.ts");
fs.writeFileSync(curveBcDest, curveBcOut);
console.log(`wrote ${curveBcDest} (${(curveBcOut.length / 1024).toFixed(1)} KB, deployed ${curveDeployed} bytes)`);
