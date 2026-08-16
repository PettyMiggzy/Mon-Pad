/**
 * The two V3 venues on Robinhood Chain (4663) that RektPad can be deployed against.
 *
 * A pad is welded to ONE venue at construction — factory, position manager and WETH are immutable — and
 * the factory is half of the pair of settings that decides whether bots turn up. So a preset that quotes
 * an 85% rate is only telling the truth on a pad built against THAT factory; run it against the other one
 * and the measured cell is 13%. Hence one record per venue, and the launcher checks the pad it is pointed
 * at actually reports the factory the chosen preset was measured on.
 *
 * Every field below was read off chain 4663, not copied from a doc:
 *   - npm.factory() and npm.WETH9() were called and returned exactly the factory/weth listed here, which
 *     is also the coherence check RektPad's constructor performs before it will deploy;
 *   - `probe` is a real pool that factory minted (taken from its own PoolCreated log), and CREATE2 over
 *     `initCodeHash` reproduces that pool's address from its (token0, token1, fee). The constructor redoes
 *     both, so a wrong hash reverts the deploy instead of bricking every launch that follows.
 *
 * Both venues turn out to share the stock Uniswap V3 pool init code hash.
 */
export type VenueId = 'sushi' | 'canonical';

export interface Venue {
  id: VenueId;
  /** How the research notes and presets refer to it — the factory's first 4 bytes. */
  short: string;
  label: string;
  factory: `0x${string}`;
  npm: `0x${string}`;
  weth: `0x${string}`;
  initCodeHash: `0x${string}`;
  probe: `0x${string}`;
}

const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73' as const;
/** Stock Uniswap V3 UniswapV3Pool init code hash — verified against a live pool on BOTH factories. */
const V3_INIT_CODE_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54' as const;

export const VENUES: Record<VenueId, Venue> = {
  // The 85%-cell factory. Its pools are the ones the fast snipers actually watch.
  sushi: {
    id: 'sushi',
    short: 'e51960f1',
    label: 'SushiSwap V3',
    factory: '0xe51960f1b45f1c9fb6d166e6a884f866fc70433b',
    npm: '0x51d0e5188afe12d502e29D982d20C190e7816107',
    weth: WETH,
    initCodeHash: V3_INIT_CODE_HASH,
    probe: '0xdbe18914a87d948c22f574dca18a9d5bc38ce4ea',
  },
  // The chain's canonical V3 fork — the venue the fork tests run against.
  canonical: {
    id: 'canonical',
    short: '1f7d7550',
    label: 'Canonical V3',
    factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
    npm: '0x73991a25c818bf1f1128deaab1492d45638de0d3',
    weth: WETH,
    initCodeHash: V3_INIT_CODE_HASH,
    probe: '0x479a1d0d9aec941382d9cab3ba69dd3914d981e9',
  },
};

/**
 * Nonzero because the constructor rejects 0, and clear of the reference pad's 3..8 so ids from the two
 * pads can never be confused in the launch records.
 */
export const START_LAUNCH_ID = 1000n;
export const ROBINHOOD_CHAIN_ID = 4663;
