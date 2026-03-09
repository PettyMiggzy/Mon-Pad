"use client";

import { useEffect, useState } from "react";

type Trade = {
  side: "BUY" | "SELL";
  wallet: string;
  amountMon: number;
  curve: string;
  symbol?: string;
};

function shortAddr(a: string) {
  if (!a) return "";
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function formatMon(n: number) {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

const PLACEHOLDER_TRADES: Trade[] = [
  { side: "BUY",  wallet: "0x1a9c…4e3b", amountMon: 2800,  curve: "", symbol: "MSHK"  },
  { side: "BUY",  wallet: "0x2c8a…6e9d", amountMon: 5100,  curve: "", symbol: "SRUN"  },
  { side: "SELL", wallet: "0x8e4d…2f7a", amountMon: 1200,  curve: "", symbol: "NDOG"  },
  { side: "BUY",  wallet: "0x5d2f…8c1a", amountMon: 890,   curve: "", symbol: "MAI"   },
  { side: "BUY",  wallet: "0x3f2a…9b1c", amountMon: 420,   curve: "", symbol: "MPEPE" },
];

export default function LiveTradesFeed() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const r = await fetch("/api/ticker", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        const arr = Array.isArray(j?.items) ? j.items : [];
        setTrades(arr);
      } catch {
        // keep existing trades on error
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const rows = trades.length > 0 ? trades : (loading ? [] : PLACEHOLDER_TRADES);

  return (
    <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(110,84,255,0.15)" }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-2 h-2 rounded-full" style={{ background: "#4ade80", boxShadow: "0 0 6px #4ade80", animation: "pulse 2s ease infinite" }} />
        <h2 className="text-xl font-bold text-white">Live Trades</h2>
        <span className="text-xs ml-auto" style={{ color: "rgba(221,215,254,0.35)" }}>Refreshing every 8s</span>
      </div>

      {loading && (
        <div className="py-8 text-center text-sm" style={{ color: "rgba(221,215,254,0.4)" }}>Loading trades…</div>
      )}

      <div className="space-y-2">
        {rows.map((t, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
            style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(110,84,255,0.08)" }}>
            <span className="rounded-lg px-2 py-0.5 text-xs font-bold min-w-[36px] text-center"
              style={{
                background: t.side === "BUY" ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)",
                color:      t.side === "BUY" ? "#4ade80"               : "#f87171",
                border:     `1px solid ${t.side === "BUY" ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`,
              }}>
              {t.side}
            </span>
            <span className="font-bold" style={{ color: "#DDD7FE" }}>{t.symbol || shortAddr(t.curve)}</span>
            <span className="hidden sm:block" style={{ color: "rgba(221,215,254,0.4)" }}>{shortAddr(t.wallet)}</span>
            <span className="ml-auto font-semibold text-white">{formatMon(t.amountMon)} MON</span>
          </div>
        ))}
      </div>

      {!loading && rows.length === 0 && (
        <div className="py-8 text-center text-sm" style={{ color: "rgba(221,215,254,0.4)" }}>
          No recent on-chain trades.
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
