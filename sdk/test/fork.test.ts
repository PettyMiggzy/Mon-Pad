import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPublicClient, createWalletClient, http, parseEther, toHex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createMonpad, SlippageExceeded } from '../src/index.js';
import { deployOnFork, startForkNode } from './deploy-fork.mjs';

const FORK_RPC = process.env.FORK_RPC;
const LOCAL = 'http://127.0.0.1:8545';
const TEST_PK = process.env.MONPAD_TEST_PRIVATE_KEY;

describe.skipIf(!FORK_RPC || !TEST_PK)('Monpad SDK (fork)', () => {
  let node: import('node:child_process').ChildProcess;
  let deployed: {
    launcher: Address;
    hook: Address;
    v4Router: Address;
    poolManager: Address;
    stateView: Address;
    monshi: Address;
    sampleToken: Address;
    deployer: Address;
  };

  beforeAll(async () => {
    node = await startForkNode(FORK_RPC!);
    deployed = deployOnFork(FORK_RPC!);
    process.env.MONPAD_SIMULATE_ADDRESS = deployed.deployer;
    const testAccount = privateKeyToAccount(TEST_PK as `0x${string}`).address;
    const bootstrap = createPublicClient({
      chain: { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [LOCAL] } } },
      transport: http(LOCAL),
    });
    await bootstrap.request({
      method: 'hardhat_setBalance',
      params: [testAccount, toHex(parseEther('100000'))],
    });
  });

  afterAll(() => {
    node?.kill();
  });

  function client(simulateOnly = false) {
    const account = privateKeyToAccount(TEST_PK as `0x${string}`);
    const chain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [LOCAL] } } };
    const publicClient = createPublicClient({ chain, transport: http(LOCAL) });
    const walletClient = simulateOnly
      ? undefined
      : createWalletClient({ account, chain, transport: http(LOCAL) });
    return createMonpad({
      rpcUrl: LOCAL,
      walletClient,
      maxMonPerTx: parseEther('1000000'),
      addresses: {
        launcher: deployed.launcher,
        hook: deployed.hook,
        v4Router: deployed.v4Router,
        poolManager: deployed.poolManager,
        stateView: deployed.stateView,
        monshi: deployed.monshi,
        dead: '0x000000000000000000000000000000000000dEaD',
      },
    });
  }

  it('quoteBuy matches executed buy within slippage', async () => {
    const mp = client(false);
    const monIn = parseEther('10');
    const quote = await mp.quoteBuy(deployed.sampleToken, monIn, 100);
    const buy = await mp.buy(deployed.sampleToken, monIn, { slippageBps: 100, simulate: false });
    expect(buy.simulated).toBe(false);
    if (!buy.simulated) {
      expect(buy.tokensOut).toBeGreaterThanOrEqual(quote.minOut);
      expect(buy.tokensOut).toBeLessThanOrEqual(quote.tokensOut);
    }
  });

  it('buy reverts under tight minOut (simulate)', async () => {
    const mp = client(false);
    const monIn = parseEther('1');
    const quote = await mp.quoteBuy(deployed.sampleToken, monIn);
    await expect(
      mp.buy(deployed.sampleToken, monIn, {
        simulate: true,
        minTokensOut: quote.tokensOut * 2n,
      }),
    ).rejects.toThrow();
  });

  it('launch + buy + sell round trip', async () => {
    const mp = client(false);
    await mp.launch({ name: 'SDK', symbol: 'SDK', creatorTaxBps: 0, simulate: true });
    const token = deployed.sampleToken;
    await mp.buy(token, parseEther('5'), { simulate: false });
    const acct = privateKeyToAccount(TEST_PK as `0x${string}`).address;
    const bal = await mp.publicClient.readContract({
      address: token,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
      functionName: 'balanceOf',
      args: [acct],
    });
    expect(bal).toBeGreaterThan(0n);
    const sold = await mp.sell(token, bal / 2n, { simulate: false, slippageBps: 200 });
    expect(sold.simulated).toBe(false);
  });

  it('claim after harvest (simulate path reads earnings)', async () => {
    const mp = client(false);
    const acct = privateKeyToAccount(TEST_PK as `0x${string}`).address;
    await mp.harvest(deployed.sampleToken);
    const earnings = await mp.creatorEarnings(acct);
    expect(earnings.claimableMon >= 0n).toBe(true);
  });
});
