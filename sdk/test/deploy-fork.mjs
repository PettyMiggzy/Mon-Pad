import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const hardhatDir = join(root, 'hardhat-test');

export function deployOnFork(forkRpc) {
  const out = execSync(
    './node_modules/.bin/hardhat run ../mcp/test/fork-deploy.cjs --network localhost --config ../mcp/test/hardhat-fork.config.cjs',
    {
      cwd: hardhatDir,
      encoding: 'utf8',
      env: { ...process.env, FORK_RPC: forkRpc },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const line = out
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop();
  if (!line) throw new Error('fork deploy: no JSON');
  return JSON.parse(line);
}

export async function startForkNode(forkRpc) {
  const { spawn } = await import('node:child_process');
  const node = spawn(
    './node_modules/.bin/hardhat',
    ['node', '--config', '../mcp/test/hardhat-fork.config.cjs', '--port', '8545'],
    {
      cwd: hardhatDir,
      env: { ...process.env, FORK_RPC: forkRpc },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  for (let i = 0; i < 40; i++) {
    try {
      execSync(
        `curl -s -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' http://127.0.0.1:8545`,
        { stdio: 'ignore' },
      );
      return node;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  node.kill();
  throw new Error('fork node not ready');
}
