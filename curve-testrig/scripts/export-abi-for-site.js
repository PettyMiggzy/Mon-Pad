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
