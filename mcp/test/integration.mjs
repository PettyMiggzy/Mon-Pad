/**
 * Fork integration test: local Hardhat fork, read tools, dryRun sends no txs.
 *
 *   FORK_RPC=https://rpc.monad.xyz npm test
 */
import { execSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { getPublicClient } from '../lib/clients.mjs';
import { resetConfigCache } from '../lib/config.mjs';
import { getSpec, listLaunches, getToken, buy, launchToken } from '../lib/actions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const hardhatDir = join(root, 'hardhat-test');
const forkConfig = join(root, 'mcp/test/hardhat-fork.config.cjs');
const localRpc = 'http://127.0.0.1:8545';

async function waitForRpc(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      execSync(`curl -s -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' ${url}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('Hardhat node did not become ready');
}

function deployOnFork() {
  const out = execSync(
    `./node_modules/.bin/hardhat run ../mcp/test/fork-deploy.cjs --network localhost --config ../mcp/test/hardhat-fork.config.cjs`,
    {
      cwd: hardhatDir,
      encoding: 'utf8',
      env: { ...process.env, FORK_RPC: process.env.FORK_RPC },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const jsonLine = out
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop();
  if (!jsonLine) throw new Error('fork-deploy produced no JSON');
  return JSON.parse(jsonLine);
}

async function main() {
  if (!process.env.FORK_RPC) {
    console.log('skip: set FORK_RPC to run fork integration tests');
    process.exit(0);
  }

  const node = spawn(
    './node_modules/.bin/hardhat',
    ['node', '--config', '../mcp/test/hardhat-fork.config.cjs', '--port', '8545'],
    {
      cwd: hardhatDir,
      env: { ...process.env, FORK_RPC: process.env.FORK_RPC },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );

  const stopNode = () => {
    try {
      node.kill('SIGTERM');
    } catch {
      /* */
    }
  };
  process.on('exit', stopNode);
  process.on('SIGINT', () => {
    stopNode();
    process.exit(130);
  });

  try {
    await waitForRpc(localRpc);
    const deployed = deployOnFork();

    process.env.RPC_URL = localRpc;
    process.env.MONPAD_CHAIN_ID = '143';
    process.env.MONPAD_LAUNCHER = deployed.launcher;
    process.env.MONPAD_HOOK = deployed.hook;
    process.env.MONPAD_V4_ROUTER = deployed.v4Router;
    process.env.MONPAD_POOL_MANAGER = deployed.poolManager;
    process.env.MONPAD_STATE_VIEW = deployed.stateView;
    process.env.MONSHI = deployed.monshi;

    process.env.MONPAD_SIMULATE_ADDRESS = deployed.deployer;
    resetConfigCache();

    const spec = JSON.parse((await getSpec()).content[0].text);
    if (!spec.contractsReady) throw new Error('spec should report contractsReady');

    const list = JSON.parse((await listLaunches({ limit: 5 })).content[0].text);
    if (list.count < 1) throw new Error('expected at least one launch');

    const tokenInfo = JSON.parse((await getToken({ token: deployed.sampleToken })).content[0].text);
    if (tokenInfo.creatorTaxBps !== 0) throw new Error('unexpected tax');
    if (!tokenInfo.poolId) throw new Error('missing poolId');

    const client = getPublicClient();
    const simulateFrom = deployed.deployer;
    const nonceBefore = await client.getTransactionCount({ address: simulateFrom });

    const dryBuy = JSON.parse(
      (await buy({ token: deployed.sampleToken, monIn: '1', minTokensOut: '0', dryRun: true })).content[0].text,
    );
    if (!dryBuy.dryRun || !dryBuy.simulated) throw new Error('buy dryRun should simulate');

    const dryLaunch = JSON.parse(
      (await launchToken({ name: 'Dry', symbol: 'DRY', dryRun: true })).content[0].text,
    );
    if (!dryLaunch.dryRun) throw new Error('launch dryRun expected');

    const nonceAfter = await client.getTransactionCount({ address: simulateFrom });
    if (nonceAfter !== nonceBefore) throw new Error('dryRun must not broadcast transactions');

    console.log('ok: read tools + dryRun (no txs sent)');
  } finally {
    stopNode();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
