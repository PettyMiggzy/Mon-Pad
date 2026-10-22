import { feePct, LP_FEE_SLICES } from '@/lib/fees';

const creator = LP_FEE_SLICES.find((s) => s.id === 'creator');

const CARDS = [
  {
    k: 'dex',
    title: 'DEX day one',
    body: 'Launch drops the token into a real Uniswap V3 pool. DexScreener from block one.',
  },
  {
    k: 'cut',
    title: creator ? `${feePct(creator.bps)} to creators` : 'Creator cut',
    body: 'LP fees pay the creator, the platform, a MONSHI burn, and a project-token burn.',
  },
  {
    k: 'burn',
    title: 'Every trade burns MONSHI',
    body: 'A slice of LP fees buys and burns Monshi. The counter on the hero is live.',
  },
  {
    k: 'bots',
    title: 'Bots and agents welcome',
    body: 'HTTP, SDK, and MCP are first-class. Bots and agents can trade the block the pool exists.',
  },
] as const;

export function WhyRow() {
  return (
    <section className="pad-why">
      <h2>
        Why launch on <span>Mon Pad</span>
      </h2>
      <div className="pad-why-grid">
        {CARDS.map((card) => (
          <article key={card.k} className={card.k === 'dex' ? 'pad-dcard pad-dcard-hot' : 'pad-dcard'}>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
