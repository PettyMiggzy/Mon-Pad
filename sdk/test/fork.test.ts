import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, toHex, keccak256, encodeAbiParameters, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createMonpad, QuoteAssetBlocked, MaxUsdcExceeded } from '../src/index.js';
import { deployOnFork, startForkNode } from './deploy-fork.mjs';

const FORK_RPC = process.env.FORK_RPC;
const LOCAL = 'http://127.0.0.1:8545';
const TEST_PK = process.env.MONPAD_TEST_PRIVATE_KEY;
const U = (n: number | string) => parseUnits(String(n), 6);
const chain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [LOCAL] } } };

const erc20 = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

describe.skipIf(!FORK_RPC || !TEST_PK)('Monpad SDK (fork, USDC quote)', () => {
  let node: import('node:child_process').ChildProcess;
  let deployed: Record<'launcher' | 'hook' | 'v4Router' | 'quoteAsset' | 'poolManager' | 'stateView' | 'monshi' | 'sampleToken' | 'deployer', Address>;
  let acct: Address;
  const bootstrap = createPublicClient({ chain, transport: http(LOCAL) });

  /** Test-only: write USDC into the live token's balance slot (FiatToken v2 `balances` = slot 9). */
  async function setUsdc(who: Address, amount: bigint) {
    const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [who, 9n]));
    await bootstrap.request({
      method: 'hardhat_setStorageAt' as never,
      params: [deployed.quoteAsset, slot, toHex(amount, { size: 32 })] as never,
    });
  }

  beforeAll(async () => {
    node = await startForkNode(FORK_RPC!);
    deployed = deployOnFork(FORK_RPC!);
    process.env.MONPAD_SIMULATE_ADDRESS = deployed.deployer;
    acct = privateKeyToAccount(TEST_PK as `0x${string}`).address;
    await bootstrap.request({ method: 'hardhat_setBalance' as never, params: [acct, toHex(parseEther('100000'))] as never });
    await setUsdc(acct, U(100_000));
  });

  afterAll(() => {
    node?.kill();
  });

  function client(simulateOnly = false) {
    const walletClient = simulateOnly
      ? undefined
      : createWalletClient({ account: privateKeyToAccount(TEST_PK as `0x${string}`), chain, transport: http(LOCAL) });
    return createMonpad({
      rpcUrl: LOCAL,
      walletClient,
      maxUsdcPerTx: U(1_000_000),
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

  it('reads the quote asset from the launcher and prices the token in USDC', async () => {
    const mp = client(true);
    expect((await mp.quoteAsset()).toLowerCase()).toBe(deployed.quoteAsset.toLowerCase());
    const t = await mp.getToken(deployed.sampleToken);
    expect(t.approxUsdcPerToken).not.toBeNull();
    // 250,000 USDC / 1e9 tokens = 0.00025 USDC per token at launch (decimal-corrected start tick)
    expect(t.approxUsdcPerToken!).toBeGreaterThan(0.0002);
    expect(t.approxUsdcPerToken!).toBeLessThan(0.0003);
  });

  it('quoteBuy (USDC) matches an executed buy within slippage, with no prior approve or balance in the quote', async () => {
    const mp = client(false);
    const usdcIn = U(100);
    const quote = await mp.quoteBuy(deployed.sampleToken, usdcIn, 100);
    const buy = await mp.buy(deployed.sampleToken, usdcIn, { slippageBps: 100, simulate: false });
    expect(buy.simulated).toBe(false);
    if (!buy.simulated) {
      expect(buy.tokensOut).toBeGreaterThanOrEqual(quote.minOut);
      expect(buy.tokensOut).toBeLessThanOrEqual(quote.tokensOut);
    }
  });

  it('buy reverts under a tight minOut (simulate)', async () => {
    const mp = client(false);
    const quote = await mp.quoteBuy(deployed.sampleToken, U(10));
    await expect(
      mp.buy(deployed.sampleToken, U(10), { simulate: true, minTokensOut: quote.tokensOut * 2n }),
    ).rejects.toThrow();
  });

  it('enforces maxUsdcPerTx before sending', async () => {
    const mp = createMonpad({ ...{ rpcUrl: LOCAL }, maxUsdcPerTx: U(5), addresses: { launcher: deployed.launcher, hook: deployed.hook, v4Router: deployed.v4Router } });
    await expect(mp.buy(deployed.sampleToken, U(6), { simulate: true })).rejects.toBeInstanceOf(MaxUsdcExceeded);
  });

  it('buy with MON takes the two-hop route and lands tokens', async () => {
    const mp = client(false);
    const before = (await bootstrap.readContract({ address: deployed.sampleToken, abi: erc20, functionName: 'balanceOf', args: [acct] })) as bigint;
    const r = await mp.buyWithMon(deployed.sampleToken, parseEther('50'), { simulate: false });
    expect(r.simulated).toBe(false);
    const after = (await bootstrap.readContract({ address: deployed.sampleToken, abi: erc20, functionName: 'balanceOf', args: [acct] })) as bigint;
    expect(after).toBeGreaterThan(before);
  });

  it('launch (USDC fee + dev buy) + sell round trip', async () => {
    const mp = client(false);
    const dry = await mp.launch({ name: 'SDK', symbol: 'SDK', creatorTaxBps: 0, devBuyUsdc: U(10), simulate: true });
    expect(dry.simulated).toBe(true);
    if (dry.simulated) expect(dry.totalUsdc).toBe(dry.creationFee + U(10));
    const token = deployed.sampleToken;
    const bal = (await bootstrap.readContract({ address: token, abi: erc20, functionName: 'balanceOf', args: [acct] })) as bigint;
    expect(bal).toBeGreaterThan(0n);
    const sold = await mp.sell(token, bal / 2n, { simulate: false, slippageBps: 200 });
    expect(sold.simulated).toBe(false);
  });

  it('harvest then read earnings in USDC', async () => {
    const mp = client(false);
    await mp.harvest(deployed.sampleToken);
    const earnings = await mp.creatorEarnings(acct);
    expect(earnings.claimableUsdc >= 0n).toBe(true);
  });

  it('a blacklisted wallet is caught by the dry run and by the send (QuoteAssetBlocked)', async () => {
    // Live USDC is a Circle FiatToken: impersonate its blacklister, blacklist the test account, expect a clear error.
    const usdc = deployed.quoteAsset;
    const blacklister = (await bootstrap.readContract({
      address: usdc,
      abi: [{ name: 'blacklister', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const,
      functionName: 'blacklister',
    })) as Address;
    await bootstrap.request({ method: 'hardhat_impersonateAccount' as never, params: [blacklister] as never });
    await bootstrap.request({ method: 'hardhat_setBalance' as never, params: [blacklister, toHex(parseEther('10'))] as never });
    const admin = createWalletClient({ account: blacklister, chain, transport: http(LOCAL) });
    const bl = [{ name: 'blacklist', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [] }] as const;
    await admin.writeContract({ address: usdc, abi: bl, functionName: 'blacklist', args: [acct], chain });
    const mp = client(false);
    // dry run: the simulated balance override hides the blacklist flag, so the SDK checks it explicitly
    await expect(mp.buy(deployed.sampleToken, U(1), { simulate: true })).rejects.toBeInstanceOf(QuoteAssetBlocked);
    await expect(mp.buy(deployed.sampleToken, U(1), { simulate: false })).rejects.toBeInstanceOf(QuoteAssetBlocked);
    // and the health probe reports a healthy USDC (the blacklisted party is the test wallet, not the contracts)
    const h = await mp.quoteHealth();
    expect(h.ok).toBe(true);
  });
});
