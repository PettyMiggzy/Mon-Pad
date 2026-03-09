"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import CreateLaunchModal from "@/components/CreateLaunchModal";
import ConnectPill from "@/components/ConnectPill";

const NAV_LINKS = [
  { label: "Docs",        href: "/docs"        },
  { label: "Terminal",    href: "/terminal"    },
  { label: "Heat Board",  href: "/heat-board"  },
  { label: "Leaderboard", href: "/leaderboard" },
];

export default function Header() {
  const [modalOpen, setModalOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header style={{ position: "sticky", top: 0, zIndex: 100, width: "100%", background: "rgba(14,9,28,0.95)", borderBottom: "1px solid rgba(110,84,255,0.15)", backdropFilter: "blur(12px)" }}>
        <div style={{ maxWidth: 1152, margin: "0 auto", padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>

          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link href="/" style={{ position: "relative", width: 44, height: 44, borderRadius: "50%", overflow: "hidden", display: "block", boxShadow: "0 0 0 1px rgba(110,84,255,0.3)", flexShrink: 0 }}>
              <Image src="/Pad.png" alt="MonPad" fill style={{ objectFit: "cover" }} priority />
            </Link>
            <div>
              <Link href="/" style={{ fontSize: 18, fontWeight: 900, color: "white", textDecoration: "none" }}>
                Mon<span style={{ color: "#DDD7FE" }}>Pad</span>
              </Link>
              <div style={{ fontSize: 11, color: "rgba(221,215,254,0.4)", marginTop: 1 }}>Launchpad • Heat Board • Terminal</div>
            </div>
          </div>

          {/* Desktop nav — plain <a> tags to avoid any Next.js prefetch issues */}
          <nav style={{ display: "flex", alignItems: "center", gap: 4 }} className="hidden md:flex">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href}
                style={{ color: "rgba(221,215,254,0.65)", fontSize: 14, padding: "8px 14px", borderRadius: 10, textDecoration: "none", transition: "color 0.15s, background 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(110,84,255,0.12)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(221,215,254,0.65)"; e.currentTarget.style.background = "transparent"; }}
              >
                {l.label}
              </a>
            ))}
          </nav>

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ConnectPill />
            <button onClick={() => setModalOpen(true)}
              style={{ background: "linear-gradient(135deg, #6E54FF, #5a42d4)", color: "white", border: "none", borderRadius: 999, padding: "8px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              + Create
            </button>
            {/* Hamburger */}
            <button className="md:hidden"
              onClick={() => setMobileOpen(v => !v)}
              style={{ background: "rgba(110,84,255,0.12)", border: "1px solid rgba(110,84,255,0.2)", color: "#DDD7FE", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 16 }}>
              {mobileOpen ? "✕" : "☰"}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {mobileOpen && (
          <div className="md:hidden" style={{ borderTop: "1px solid rgba(110,84,255,0.1)", padding: "8px 16px 16px" }}>
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMobileOpen(false)}
                style={{ display: "block", color: "rgba(221,215,254,0.7)", fontSize: 14, padding: "12px 16px", borderRadius: 12, textDecoration: "none" }}>
                {l.label}
              </a>
            ))}
          </div>
        )}
      </header>

      <CreateLaunchModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
