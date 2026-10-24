/** Hardhat config for MCP fork tests — keeps all paths under hardhat-test/. */
const path = require('path');
const ht = path.join(__dirname, '../../hardhat-test');
require(path.join(ht, 'node_modules/@nomicfoundation/hardhat-toolbox'));
require(path.join(ht, 'node_modules/dotenv')).config({ path: path.join(ht, '.env') });

const parent = require(path.join(ht, 'hardhat.config.js'));

const forkUrl = process.env.FORK_RPC;
const hardhatNetwork = {
  ...(parent.networks?.hardhat || {}),
  chainId: 143,
  ...(forkUrl ? { forking: { url: forkUrl } } : {}),
};

module.exports = {
  ...parent,
  paths: {
    root: ht,
    sources: path.join(ht, 'contracts'),
    tests: path.join(ht, 'test'),
    cache: path.join(ht, 'cache'),
    artifacts: path.join(ht, 'artifacts'),
  },
  networks: {
    ...parent.networks,
    hardhat: hardhatNetwork,
    localhost: { url: 'http://127.0.0.1:8545', chainId: 143 },
  },
};
