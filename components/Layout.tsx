import Link from 'next/link';
import { useRouter } from 'next/router';
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Home, Plus, ArrowLeftRight, Coins, User, Shield, BookOpen, FileText } from 'lucide-react';
import { isAdmin } from '@/lib/constants';
import { AddressGuard } from './AddressGuard';
import type { ReactNode } from 'react';

const PRIMARY_NAV = [
  { href: '/', label: 'Home', icon: Home, desktopOnly: false },
  { href: '/create', label: 'Create', icon: Plus, desktopOnly: false },
  { href: '/swap', label: 'Swap', icon: ArrowLeftRight, desktopOnly: false },
  { href: '/stake', label: 'Stake', icon: Coins, desktopOnly: false },
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
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'rgba(20, 16, 42, 0.75)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--bd, rgba(139, 92, 246, 0.15))',
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            padding: '0 16px',
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <Link
          href="/"
          className="flex items-center"
          aria-label="Mon-Pad home"
          style={{ textDecoration: 'none' }}
        >
          <img
            src="/monpad-text-logo.png"
            alt="Mon-Pad"
            className="h-12 w-auto md:h-16 select-none"
            draggable={false}
          />
        </Link>
          <nav className="mp-desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
