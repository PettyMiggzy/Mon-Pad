# Batch 2d — Full Staking Page

**Standing rule (unchanged):** No dev server bouncing. Compile + build verification only. King eyeballs at the end.

**Pickup gate:** Only start after Batch 2c is shipped + MONSHI swap address landed (both done). After this, no more frontend batches — we move to git commit + Vercel deploy.

---

## File: pages/stake.tsx (NEW, ~500 lines)

### Page-level structure (top to bottom)

1. **Header strip** — title "Staking" + subtitle "Stake tokens, earn from every sell"
2. **Your Positions section** (if connected wallet has any positions) — list of active stakes across all pools
3. **All Pools section** — list/grid of every pool that exists, each showing: token / total staked / your stake / claimable
4. **Create Pool CTA** (only if user is the creator of any token without a pool yet) — button → opens modal

### Data fetching

```ts
// On mount and on wallet change:
const { address } = useAccount();

const [pools, setPools] = useState<PoolSummary[]>([]);
const [myPositions, setMyPositions] = useState<Position[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  let cancelled = false;
  setLoading(true);
  Promise.all([
    api.listPools(),
    address ? api.getMyPositions(address) : Promise.resolve([]),
  ]).then(([p, m]) => {
    if (!cancelled) {
      setPools(p);
      setMyPositions(m);
      setLoading(false);
    }
  }).catch(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
}, [address]);
```

### Types — add to lib/api.ts

```ts
export type PoolSummary = {
  poolAddress: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  totalStaked: string;          // wei
  totalWeightedStaked: string;  // wei
  rewardPerSec: string;         // wei/sec, derived from hub distribution
  accumulatedRewards: string;   // wei pending in hub for this pool
  isMonshi: boolean;            // MONSHI pool gets special treatment
  hasStakingFee: boolean;       // 2% stake fee waived for MONSHI holders
};

export type Position = {
  poolAddress: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  stakeId: number;              // user's stake slot
  amount: string;               // wei
  weighted: string;             // wei * durationMultiplier
  startTs: number;
  lockUntilTs: number;
  claimable: string;            // wei MON rewards
};

// api object additions:
listPools: async (): Promise<PoolSummary[]> =>
  MOCK_MODE ? mocks.mockPools() : http(`/api/pools`),

getMyPositions: async (wallet: string): Promise<Position[]> =>
  MOCK_MODE ? mocks.mockPositions(wallet) : http(`/api/positions/${wallet}`),
```

### Mocks — add to lib/mocks.ts

```ts
export async function mockPools(): Promise<PoolSummary[]> {
  // Return 3 mock pools:
  // - MONSHI pool (isMonshi=true, has accumulatedRewards ~500 MON, totalStaked ~1M tokens)
  // - DOGE2 pool (regular pool, ~200 MON pending)
  // - PAD pool (regular pool, ~50 MON pending)
}

export async function mockPositions(wallet: string): Promise<Position[]> {
  // Return 1-2 mock positions for the connected wallet so the UI shows active state
}
```

### Sections in detail

**Your Positions section** (only renders if myPositions.length > 0):

- Header: "Your Positions"
- Grid of position cards, 1-col mobile / 2-col desktop
- Each card shows:
  - Token name + symbol with letter avatar (brand purple bg)
  - Staked amount (fmtToken) + symbol
  - Time remaining on lock (or "Unlocked" if Date.now()/1000 >= lockUntilTs)
  - Claimable MON (fmtMon)
  - Two buttons: "Claim" + "Unstake"
    - Claim: calls pool.claim(stakeId) — always enabled if claimable > 0
    - Unstake: calls pool.unstake(stakeId) — shows warning modal if locked (10% penalty)

**All Pools section:**

- Header: "All Pools"
- Each pool row clickable → expands inline to show stake form
- Row content:
  - Token avatar + name/symbol
  - "Total staked: X tokens"
  - "APR estimate: ~Y%" (compute from rewardPerSec * 86400 * 365 / totalWeightedStaked, clamped to display range)
  - MONSHI pool gets a small "✨ Bonus rewards" pill
  - Expand chevron icon
- When expanded, stake form appears inline below:
  - Amount input (with MAX button using wallet balance via wagmi useBalance)
  - Duration selector: 7 days / 30 days / 90 days / 180 days (durations affect weight per contract)
  - Estimated rewards display (amount × durationMultiplier / totalWeighted × dailyRewardPool × 30 for 30d preview)
  - Stake fee notice: "2% stake fee (waived for MONSHI holders)" — when user has MONSHI, show waived state
  - Approve + Stake buttons (or single "Stake" if already approved)

**Create Pool flow:**

- Show CTA "Create staking pool for your token" only if user owns a token without a pool
- Click → modal with token selector dropdown (lists user's tokens without pools)
- Confirm → calls poolFactory.createPool(tokenAddress) with status pill
- On success → list refetch + scroll to new pool

### Contract interactions

Pull ABIs from lib/abis/:

- **MonPadPoolFactoryAbi** — createPool(address)
- **MonPadStakingPoolAbi** — stake(uint256 amount, uint256 duration), unstake(uint256 stakeId), claim(uint256 stakeId), claimAll(), getMyStakes(address), etc.
- **MonPadStakingHubAbi** — for read calls on accumulated rewards

For each tx call, use wagmi useWriteContract with the inline status pill pattern (reuse from Batch 2c).

For ERC-20 approve before stake:
- Check IERC20(token).allowance(user, pool) via wagmi useReadContract
- If insufficient, show "Approve" button before "Stake" — calls IERC20(token).approve(pool, amountIn)
- After approval confirm, button transitions to "Stake"

### Sticky empty / loading / error states

- Loading: 3 skeleton pool rows (reuse .skeleton class)
- Empty pools: "No staking pools exist yet. Token creators can create pools for their projects."
- Empty positions: just don't render the Your Positions section
- Wallet not connected: "Connect wallet to view your positions and stake"
- Tx error: status pill shows truncated error, X to dismiss

### Layout & styling

- Same container pattern as homepage: `max-w-7xl mx-auto px-4`
- Brand colors: `var(--p), var(--p2), var(--bd)` etc. with hex fallbacks
- Pool row background: `var(--bg-card, rgba(28, 24, 56, 0.6))`
- Position cards: same bg + `1px solid var(--bd, rgba(139, 92, 246, 0.15))`
- Top-of-page padding 24px, bottom 80px

### Nav addition

Edit `components/Layout.tsx`:

- Add `{ href: '/stake', label: 'Stake', icon: TrendingUp }` to the NAV array
- Position: between Create and Swap so it reads Home / Create / Stake / Swap
- Mobile bottom nav: also add Stake icon (icon set is already 5-cell, may need to drop one — recommend keeping all 5: Home / Create / Stake / Swap / Profile)

### Execution sequence

1. Add types to `lib/api.ts` (3 sed-inserts: PoolSummary type, Position type, 2 api methods)
2. Add mocks to `lib/mocks.ts` (mockPools + mockPositions appended)
3. Write `pages/stake.tsx` (single heredoc write)
4. Edit `components/Layout.tsx` to add Stake to nav (sed-insert in NAV array + mobile section)
5. `npx tsc --noEmit -p .` clean
6. `npm run build` clean — surface bundle sizes
7. Surface compile-clean + build output, stop

### TODOs OK to leave for v2.1.1 (after public launch):

- Auto-compounding rewards
- Stake duration custom input (not just chips)
- Bulk claim across all pools (we have `claimAll()` available but skip the UI for now)
- Pool stats dashboard (TVL graph, reward APR over time)
- MONSHI buyback events feed

**Estimated time:** 90-120 minutes

No design ambiguity calls expected — every flow has a clear contract method. If anything is unclear, default to the simplest implementation and add a `{/* TODO: ... */}` comment.

---

**Forward to Frontend Claude.** Once Batch 2d lands clean:

1. Git commit checkpoint (he was paused mid-git-status)
2. We push to GitHub
3. Connect Vercel for preview URL
4. Team starts testing

Standing by.
