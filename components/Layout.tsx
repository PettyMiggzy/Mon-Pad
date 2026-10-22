import Link from 'next/link';
import { useRouter } from 'next/router';
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useSwitchChain } from 'wagmi';
import { Home, Plus, ArrowLeftRight, User, Shield, BookOpen, FileText, Trophy, Bot, Target } from 'lucide-react';
import { isAdmin, MONAD_CHAIN_ID } from '@/lib/constants';
import { AddressGuard } from './AddressGuard';
import MonshiMark from './MonshiMark';
import type { ReactNode } from 'react';

const PRIMARY_NAV = [
  { href: '/', label: 'Home', icon: Home, desktopOnly: false },
  { href: '/create', label: 'Create', icon: Plus, desktopOnly: false },
  { href: '/swap', label: 'Swap', icon: ArrowLeftRight, desktopOnly: false },
  { href: '/studio', label: 'Studio', icon: Bot, desktopOnly: false },
  { href: '/rewards', label: 'Rewards', icon: Trophy, desktopOnly: false },
  { href: '/bounties', label: 'Bounties', icon: Target, desktopOnly: true },
  { href: '/how-it-works', label: 'How it works', icon: BookOpen, desktopOnly: true },
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
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 6,
        fontSize: 14,
        background: active ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
        color: active ? 'var(--p, #A855F7)' : 'rgba(220, 215, 240, 0.7)',
        textDecoration: 'none',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
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
      <header className="mp-topbar">
        <div className="mp-topbar-inner">
          <Link href="/" className="mp-brand" aria-label="Monpad home">
            <MonshiMark size={42} spin />
            <span className="mp-brand-word">
              Mon<span className="mp-brand-accent">pad</span>
            </span>
          </Link>
          <nav className="mp-desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
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
          <ConnectButton chainStatus="icon" showBalance={{ smallScreen: false, largeScreen: true }} />
        </div>
      </header>

      <main style={{ flex: 1, paddingBottom: 80 }}>{children}</main>

      <nav
        className="mp-mobile-nav"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          background: 'rgba(18, 14, 36, 0.95)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderTop: '1px solid var(--bd, rgba(139, 92, 246, 0.15))',
          display: 'grid',
          gridTemplateColumns: admin ? 'repeat(6, 1fr)' : 'repeat(5, 1fr)',
        }}
      >
        {PRIMARY_NAV.filter((n) => !n.desktopOnly).map((n) => {
          const Icon = n.icon;
          const active = router.pathname === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '8px 0',
                fontSize: 11,
                textDecoration: 'none',
                color: active ? 'var(--p, #A855F7)' : 'rgba(220, 215, 240, 0.5)',
              }}
            >
              <Icon size={20} />
              {n.label}
            </Link>
          );
        })}
        {address ? (
          <Link
            href={`/profile/${address}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: '8px 0',
              fontSize: 11,
              textDecoration: 'none',
              color: onProfile ? 'var(--p, #A855F7)' : 'rgba(220, 215, 240, 0.5)',
            }}
          >
            <User size={20} />
            Profile
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => openConnectModal?.()}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: '8px 0',
              fontSize: 11,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(220, 215, 240, 0.5)',
              fontFamily: 'inherit',
            }}
          >
            <User size={20} />
            Profile
          </button>
        )}
        {admin && (
          <Link
            href="/admin"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: '8px 0',
              fontSize: 11,
              textDecoration: 'none',
              color: onAdmin ? 'var(--p, #A855F7)' : 'rgba(220, 215, 240, 0.5)',
            }}
          >
            <Shield size={20} />
            Admin
          </Link>
        )}
      </nav>

      <style jsx global>{`
        @media (min-width: 768px) {
          .mp-mobile-nav {
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
          Mon-Pad — Built on Monad. Audited and live. · A King Petty Build
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <a href="https://t.me/MonshiUtilitySupport" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-brand-purple transition-colors">Support</a>
          <span className="text-white/20">·</span>
          <a href="https://t.me/monpadlounge" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-brand-purple transition-colors">Lounge</a>
          <span className="text-white/20">·</span>
          <Link href="/how-it-works" className="text-white/70 hover:text-brand-purple transition-colors">How it works</Link>
          <span className="text-white/20">·</span>
          <Link href="/docs" className="text-white/70 hover:text-brand-purple transition-colors">Docs</Link>
        </div>
      </div>
    </footer>
    </div>
  );
}

export default Layout;
