import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useSwitchChain } from 'wagmi';
import { Home, ArrowLeftRight, User, Trophy, Bot, MessageCircle, Send } from 'lucide-react';
import { isAdmin, MONAD_CHAIN_ID } from '@/lib/constants';
import { v4Configured } from '@/lib/v4/config';
import { AddressGuard } from './AddressGuard';
import { Splash } from './ui/Splash';

const DOCK = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/chat', label: 'Chat', icon: MessageCircle },
  { href: '/swap', label: 'Swap', icon: ArrowLeftRight },
  { href: '/rewards', label: 'Rewards', icon: Trophy },
  { href: '/studio', label: 'Studio', icon: Bot },
] as const;

function WrongChainBar() {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const router = useRouter();
  const isLab = router.pathname === '/lab' || router.pathname === '/pad';
  if (isLab || !isConnected || chainId === undefined || chainId === MONAD_CHAIN_ID) return null;
  return (
    <div className="pad-chain">
      <span>
        Wallet is on chain <b>{chainId}</b>. Monpad runs on Monad.
      </span>
      <button type="button" onClick={() => switchChain({ chainId: MONAD_CHAIN_ID })}>
        Switch to Monad
      </button>
    </div>
  );
}

function NavSearch() {
  const router = useRouter();
  const initial = typeof router.query.q === 'string' ? router.query.q : '';
  const [q, setQ] = useState(initial);
  useEffect(() => {
    setQ(typeof router.query.q === 'string' ? router.query.q : '');
  }, [router.query.q]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    void router.push(term ? `/?q=${encodeURIComponent(term)}` : '/');
  }

  return (
    <form className="pad-search" onSubmit={onSubmit} role="search">
      <span aria-hidden>⌕</span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search coins, tickers, address"
        aria-label="Search coins, tickers, address"
      />
    </form>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const router = useRouter();
  const admin = address ? isAdmin(address) : false;
  const onProfile = router.pathname.startsWith('/profile');
  const isHome = router.pathname === '/' && v4Configured();

  return (
    <div className={`pad-root${isHome ? ' is-home' : ''}`}>
      <Splash />
      <AddressGuard />
      <WrongChainBar />
      <header className="pad-top">
        <div className="pad-top-in">
          <Link href="/" className="pad-brand" aria-label="Monpad home">
            <img src="/icon-192.png?v=2" alt="" />
            <span>
              MON<em>PAD</em>
            </span>
          </Link>
          <NavSearch />
          <nav className="pad-links" aria-label="Primary">
            <Link href="/docs" className={router.pathname === '/docs' ? 'on' : ''}>
              Docs
            </Link>
            <Link href="/chat" className={router.pathname === '/chat' ? 'on' : ''}>Chat</Link>
            <Link href="/ai" className={router.pathname === '/ai' ? 'on' : ''}>AI</Link>
            <a href="/monshi-kart">Play</a>
            <Link href="/how-it-works">How it works</Link>
            {admin && <Link href="/admin">Admin</Link>}
          </nav>
          {isHome && (
            <span className="pad-built"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" /><path d="M12 8 16 12 12 16 8 12Z" /></svg>Built on Monad</span>
          )}
          {isHome && (
            <a className="pad-soc" href="https://t.me/monshionmonad" target="_blank" rel="noopener noreferrer" aria-label="Telegram">
              <Send size={17} />
            </a>
          )}
          <div className="pad-wallet">
            <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />
          </div>
          <Link href="/create" className="pad-launch">
            + Launch
          </Link>
        </div>
      </header>
      <main className="pad-main">{children}</main>
      <footer className="pad-foot">
        <div>
          Monpad — fair launches on Monad. Every trade burns Monshi.
        </div>
        <nav>
          <Link href="/docs">Docs</Link>
          <Link href="/api/v1/spec">Spec</Link>
          <Link href="/rewards">Rewards</Link>
          <Link href="/bounties">Bounties</Link>
          <Link href="/studio">Studio</Link>
          <a href="https://t.me/MonshiUtilitySupport" target="_blank" rel="noopener noreferrer">
            Support
          </a>
        </nav>
      </footer>
      <nav className="pad-dock" aria-label="Mobile">
        {DOCK.map((item) => {
          const Icon = item.icon;
          const on = router.pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={on ? 'on' : ''}>
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
        {address ? (
          <Link href={`/profile/${address}`} className={onProfile ? 'on' : ''}>
            <User size={18} />
            <span>You</span>
          </Link>
        ) : (
          <button type="button" onClick={() => openConnectModal?.()}>
            <User size={18} />
            <span>You</span>
          </button>
        )}
      </nav>
    </div>
  );
}

export default Layout;
