// Start-price params for MonpadLauncher. Usage: START_MCAP_MON=250000 node scripts/v4-params.js
// price = WMON per token = startMcap / 1e9 supply. Ticks must be multiples of 200 (1% tier).
const { TickMath } = require("@uniswap/v3-sdk");

function params(startMcapMon) {
  const price = Number(startMcapMon) / 1e9;
  let tick = Math.round(Math.log(price) / Math.log(1.0001));
  tick = Math.round(tick / 200) * 200;
  return {
    startMcapMon: Number(startMcapMon),
    startTick: tick,
    effectiveMcapMon: Math.pow(1.0001, tick) * 1e9,
    sqrtAtStartTick: TickMath.getSqrtRatioAtTick(tick).toString(),
    sqrtAtNegStartTick: TickMath.getSqrtRatioAtTick(-tick).toString(),
  };
}

module.exports = { params };

if (require.main === module) {
  console.log(JSON.stringify(params(process.env.START_MCAP_MON || 250000), null, 2));
}

// Uniswap V4 pools are native-MON / token, so the price is tokens per MON and the start tick is positive.
module.exports.uv4StartTick = (startMcapMon) => -params(startMcapMon).startTick;
