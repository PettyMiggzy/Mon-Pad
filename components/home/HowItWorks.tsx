// "How MONPAD works": four steps in one row. Fee percents come from lib/fees.ts.
import { ChevronRight, Lock, Repeat, Rocket, Users } from 'lucide-react';
import { feePct, LP_FEE_SLICES } from '@/lib/fees';

const STEPS = [
  { icon: Rocket, title: 'Launch', text: 'Name it, pick a creator tax, pay in MON. One transaction, no creation fee.' },
  { icon: Lock, title: 'Locked from block one', text: 'Liquidity is single-sided and locked in a Uniswap V4 pool. Nobody can pull it.' },
  { icon: Repeat, title: 'Trade', text: 'Buy and sell with MON or USDC. The router converts for you in the same transaction.' },
  { icon: Users, title: 'Earn & burn', text: `Creators earn ${feePct(LP_FEE_SLICES[0].bps)} of every fee. The rest funds the platform and burns MONSHI.` },
];

export function HowItWorks() {
  return (
    <section className="lh-sec">
      <div className="lh-sec-head"><div><h2>How MONPAD Works</h2><p>From great ideas to real communities. A simple, fair and transparent process.</p></div></div>
      <div className="lh-steps">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div className="lh-step-wrap" key={s.title}>
              <div className="lh-step">
                <span className="lh-step-i"><Icon size={26} strokeWidth={1.6} /><b>{i + 1}</b></span>
                <div><h3>{s.title}</h3><p>{s.text}</p></div>
              </div>
              {i < STEPS.length - 1 && <ChevronRight className="lh-arrow" size={22} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
