"use client";

import { useEffect, useMemo, useState } from "react";

export type TickerItem = {
  side: "BUY" | "SELL";
  wallet: string;
  amountMon: number;
  curve: string;
  symbol?: string;
};

const PLACEHOLDER_TICKERS: TickerItem[] = [
  { side: "BUY",  wallet: "0x1a9c…4e3b", amountMon: 2800,  curve: "", symbol: "MSHK"  },
  { side: "BUY",  wallet: "0x2c8a…6e9d", amountMon: 5100,  curve: "", symbol: "SRUN"  },
  { side: "SELL", wallet: "0x8e4d…2f7a", amountMon: 1200,  curve: "", symbol: "NDOG"  },
  { side: "BUY",  wallet: "0x5d2f…8c1a", amountMon: 890,   curve: "", symbol: "MAI"   },
  { side: "BUY",  wallet: "0x3f2a…9b1c", amountMon: 420,   curve: "", symbol: "MPEPE" },
  { side: "SELL", wallet: "0x7b1e…3d2f", amountMon: 3300,  curve: "", symbol: "GIGA"  },
  { side: "BUY",  wallet: "0x4c9d…1a8e", amountMon: 1750,  curve: "", symbol: "PWJK"  },
  { side: "BUY",  wallet: "0x9a3f…7c4b", amountMon: 6200,  curve: "", symbol: "MSHK"  },
];

function shortAddr(a: string) {
  if (!a) return "";
  if (a.length <= 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function formatMon(n: number) {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n.toFixed(0)}`;
}

export default function TickerBar() {
  const [data, setData] = useState<TickerItem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/ticker", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        const arr = Array.isArray(j?.items) ? j.items : Array.isArray(j?.data) ? j.data : [];
        setData(arr);
      } catch { /* keep existing */ }
    };
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const source = data.length > 0 ? data : PLACEHOLDER_TICKERS;
  const items = useMemo(() => [...source, ...source, ...source], [source]);

  return (
    <div className="relative z-20 w-full overflow-hidden" style={{ borderBottom: "1px solid rgba(110,84,255,0.1)", background: "rgba(14,9,28,0.95)" }}>
      <div className="pointer-events-none absolute left-0 top-0 h-full w-16 z-10" style={{ background: "linear-gradient(to right, rgba(14,9,28,1), transparent)" }} />
      <div className="pointer-events-none absolute right-0 top-0 h-full w-16 z-10" style={{ background: "linear-gradient(to left, rgba(14,9,28,1), transparent)" }} />

      <div className="ticker-wrap">
        <div className="ticker-track">
          {items.map((t, idx) => (
            <div
              key={`${t.wallet}-${t.curve}-${idx}`}
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs flex-shrink-0"
              style={{ background: "rgba(110,84,255,0.08)", border: "1px solid rgba(110,84,255,0.12)" }}
            >
              <span
                className="rounded-full px-2 py-0.5 font-bold"
                style={{
                  background: t.side === "BUY" ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)",
                  color:      t.side === "BUY" ? "#4ade80"               : "#f87171",
                  border:     `1px solid ${t.side === "BUY" ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`,
                }}
              >
                {t.side}
              </span>
              <span className="font-bold" style={{ color: "#DDD7FE" }}>{t.symbol || shortAddr(t.curve)}</span>
              <span style={{ color: "rgba(221,215,254,0.5)" }}>{formatMon(t.amountMon)} MON</span>
              <span style={{ color: "rgba(221,215,254,0.3)" }}>{shortAddr(t.wallet)}</span>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .ticker-wrap { width: 100%; overflow: hidden; }
        .ticker-track {
          display: inline-flex;
          gap: 10px;
          padding: 8px 12px;
          white-space: nowrap;
          animation: ticker 25s linear infinite;
        }
        @keyframes ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-33.333%); }
        }
        .ticker-wrap:hover .ticker-track { animation-play-state: paused; }
      `}</style>
    </div>
  );
}
