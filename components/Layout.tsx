import Link from 'next/link';
import { useRouter } from 'next/router';
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useSwitchChain } from 'wagmi';
import { Home, Plus, ArrowLeftRight, User, Shield, FileText, Trophy, Bot } from 'lucide-react';
import { isAdmin, MONAD_CHAIN_ID } from '@/lib/constants';
import { AddressGuard } from './AddressGuard';
import type { ReactNode } from 'react';

const PRIMARY_NAV = [
  { href: '/', label: 'Home', icon: Home, desktopOnly: false },
  { href: '/create', label: 'Create', icon: Plus, desktopOnly: false },
  { href: '/swap', label: 'Swap', icon: ArrowLeftRight, desktopOnly: false },
  { href: '/studio', label: 'Studio', icon: Bot, desktopOnly: false },
  { href: '/rewards', label: 'Rewards', icon: Trophy, desktopOnly: false },
  { href: '/docs', label: 'Docs', icon: FileText, desktopOnly: true },
] as const;

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={active ? 'mp-navlink mp-navlink-on' : 'mp-navlink'}>
      {children}
    </Link>
  );
}

/**
 * Robinhood Chain (4663) is in the wagmi config so the research pad at /lab can sign there. Every read
 * hook on the rest of the site follows the connected chain and none of them pin an id, so a wallet left
 * on 4663 after a launch would make the whole app quietly read the wrong chain and render empty — the
 * worst kind of broken, the kind that looks like no data. Say so instead, and offer the way back.
 */
function WrongChainBar() {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const router = useRouter();

  // /lab and /pad are supposed to be on 4663 — they carry their own chain guard.
  const isLab = router.pathname === '/lab' || router.pathname === '/pad';
  if (isLab || !isConnected || chainId === undefined || chainId === MONAD_CHAIN_ID) return null;

  return (
    <div style={{ background: 'rgba(245,158,11,.15)', borderBottom: '1px solid rgba(245,158,11,.45)', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
      <span>Your wallet is on chain <b>{chainId}</b>. Mon-Pad runs on Monad — nothing here will load until you switch back.</span>
      <button
        onClick={() => switchChain({ chainId: MONAD_CHAIN_ID })}
        style={{ border: '1px solid rgba(245,158,11,.6)', background: 'rgba(245,158,11,.2)', color: 'inherit', borderRadius: 6, padding: '4px 12px', fontSize: 13, cursor: 'pointer' }}
      >
        Switch to Monad
      </button>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const router = useRouter();
  const admin = address ? isAdmin(address) : false;
  const onProfile = router.pathname.startsWith('/profile');
  const onAdmin = router.pathname.startsWith('/admin');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AddressGuard />
      <WrongChainBar />
      <header className="nx-bar">
        <Link href="/" className="nx-brand" aria-label="Monpad home">
          <span className="nx-face" aria-hidden>
            <img src="/meshy/monshi-face.png" alt="" />
          </span>
          <span className="nx-word">
            MON<span>PAD</span>
          </span>
        </Link>
        <nav className="nx-nav mp-desktop-nav">
          {PRIMARY_NAV.map((n) => (
            <NavLink key={n.href} href={n.href} active={router.pathname === n.href}>
              {n.label}
            </NavLink>
          ))}
          {address && (
            <NavLink href={`/profile/${address}`} active={onProfile}>
              Profile
            </NavLink>
          )}
          {admin && (
            <NavLink href="/admin" active={onAdmin}>
              <Shield size={14} /> Admin
            </NavLink>
          )}
        </nav>
        <div className="nx-wallet">
          <ConnectButton chainStatus="icon" showBalance={{ smallScreen: false, largeScreen: true }} />
        </div>
      </header>

      <main style={{ flex: 1, paddingBottom: 108 }}>{children}</main>

      <nav className="mp-dock" aria-label="Primary">
        {PRIMARY_NAV.filter((n) => !n.desktopOnly).map((n) => {
          const Icon = n.icon;
          const active = router.pathname === n.href;
          return (
            <Link key={n.href} href={n.href} className={active ? 'mp-dock-item mp-dock-on' : 'mp-dock-item'}>
              <Icon size={18} />
              <span>{n.label}</span>
            </Link>
          );
        })}
        {address ? (
          <Link href={`/profile/${address}`} className={onProfile ? 'mp-dock-item mp-dock-on' : 'mp-dock-item'}>
            <User size={18} />
            <span>You</span>
          </Link>
        ) : (
          <button type="button" className="mp-dock-item" onClick={() => openConnectModal?.()}>
            <User size={18} />
            <span>You</span>
          </button>
        )}
        {admin && (
          <Link href="/admin" className={onAdmin ? 'mp-dock-item mp-dock-on' : 'mp-dock-item'}>
            <Shield size={18} />
            <span>Admin</span>
          </Link>
        )}
      </nav>

      <style jsx global>{`
        @media (min-width: 768px) {
          .mp-dock {
            display: none !important;
          }
          main {
            padding-bottom: 32px !important;
          }
        }
        @media (max-width: 767px) {
          .mp-desktop-nav {
            display: none !important;
          }
        }
      `}</style>
    <footer className="border-t border-border mt-16">
      <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="text-sm text-white/50">
          Monpad — fair launches on Monad · every trade burns Monshi
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <a href="https://t.me/MonshiUtilitySupport" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-brand-purple transition-colors">Support</a>
          <span className="text-white/20">·</span>
          <a href="https://t.me/monpadlounge" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-brand-purple transition-colors">Lounge</a>
          <span className="text-white/20">·</span>
          <Link href="/docs" className="text-white/70 hover:text-brand-purple transition-colors">Docs</Link>
        </div>
      </div>
    </footer>
    </div>
  );
}

export default Layout;
