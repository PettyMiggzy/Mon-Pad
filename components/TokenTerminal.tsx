"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useWallet } from "@/lib/useWallet";
import {
  encodeCall, ethCall, ethGetLogs,
  decodeUint256, decodeBool, decodeAddress, decodeString,
  formatEther, parseEther, keccak256,
} from "@/lib/eth";

const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

function shortAddr(a: string) {
  return a?.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
function toHexWei(v: bigint) {
  return "0x" + v.toString(16);
}
function fmtNum(n: number, decimals = 2) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(decimals);
}
function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

type Trade = {
  kind: "buy" | "sell";
  who: string;
  monAmount: number;
  tokenAmount: number;
  ts: number;
  tx: string;
};

type Stats = {
  token?: string;
  name?: string;
  symbol?: string;
  price?: bigint;
  bonded?: bigint;
  raised?: bigint;
  cap?: bigint;
  graduated?: boolean;
  creator?: string;
};

const BUY_TOPIC  = keccak256("Buy(address,uint256,uint256)");
const SELL_TOPIC = keccak256("Sell(address,uint256,uint256)");

export default function TokenTerminal({ curve }: { curve: string }) {
  const { provider, address, isConnected, isMonad, connect, switchToMonad } = useWallet();

  const [stats, setStats] = useState<Stats>({});
  const [balance, setBalance] = useState<bigint>(0n);
  const [buyMon, setBuyMon] = useState("10");
  const [sellTokens, setSellTokens] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [monUsd, setMonUsd] = useState<number>(0);

  // Fetch MON price
  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd")
      .then(r => r.json())
      .then(j => { if (j?.monad?.usd) setMonUsd(j.monad.usd); })
      .catch(() => {});
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const [tokenRaw, priceRaw, bondedRaw, raisedRaw, capRaw, graduatedRaw, creatorRaw] = await Promise.all([
        ethCall(curve, encodeCall("token()")),
        ethCall(curve, encodeCall("priceWeiPerToken()")),
        ethCall(curve, encodeCall("bondedBps()")),
        ethCall(curve, encodeCall("monRaisedNet()")),
        ethCall(curve, encodeCall("capMon()")),
        ethCall(curve, encodeCall("graduated()")),
        ethCall(curve, encodeCall("creator()")),
      ]);
      const tokenAddr = decodeAddress(tokenRaw);
      const [nameRaw, symbolRaw] = await Promise.all([
        ethCall(tokenAddr, encodeCall("name()")),
        ethCall(tokenAddr, encodeCall("symbol()")),
      ]);
      setStats({
        token: tokenAddr,
        name: decodeString(nameRaw),
        symbol: decodeString(symbolRaw),
        price: decodeUint256(priceRaw),
        bonded: decodeUint256(bondedRaw),
        raised: decodeUint256(raisedRaw),
        cap: decodeUint256(capRaw),
        graduated: decodeBool(graduatedRaw),
        creator: decodeAddress(creatorRaw),
      });
    } catch { /* ignore */ }
  }, [curve]);

  const loadTrades = useCallback(async () => {
    try {
      const logs = await ethGetLogs({
        address: curve,
        fromBlock: "0x0",
        toBlock: "latest",
        topics: [[BUY_TOPIC, SELL_TOPIC]],
      });
      const parsed: Trade[] = logs.slice(-50).map((log) => {
        const isBuy = log.topics[0] === BUY_TOPIC;
        const who = "0x" + log.topics[1].slice(26);
        const d = log.data.replace(/^0x/, "");
        const monWei = BigInt("0x" + d.slice(0, 64));
        const tokWei = BigInt("0x" + d.slice(64, 128));
        return {
          kind: isBuy ? "buy" : "sell" as "buy" | "sell",
          who,
          monAmount: formatEther(monWei),
          tokenAmount: formatEther(tokWei),
          ts: Date.now(),
          tx: log.transactionHash,
        };
      }).reverse();
      setTrades(parsed);
    } catch { /* ignore */ }
  }, [curve]);

  useEffect(() => {
    loadStats();
    loadTrades();
    const t1 = setInterval(loadStats, 7000);
    const t2 = setInterval(loadTrades, 10000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [loadStats, loadTrades]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!address || !stats.token) return;
      try {
        const out = await ethCall(stats.token, encodeCall("balanceOf(address)", [address]));
        if (alive) setBalance(decodeUint256(out));
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [address, stats.token]);

  const price = stats.price ? formatEther(stats.price) : 0;
  const marketCapMon = price * formatEther(TOTAL_SUPPLY);
  const mcDisplay = monUsd > 0
    ? `$${fmtNum(marketCapMon * monUsd)}`
    : `${fmtNum(marketCapMon)} MON`;
  const bondedPct = stats.bonded ? Number(stats.bonded) / 100 : 0;
  const raisedMon = stats.raised ? formatEther(stats.raised) : 0;
  const capMon = stats.cap ? formatEther(stats.cap) : 400000;
  const balanceNum = formatEther(balance);

  const sellWei = useMemo(() => {
    const n = parseFloat(sellTokens);
    if (!isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.floor(n * 1e9)) * 10n ** 9n;
  }, [sellTokens]);

  const handleBuy = async () => {
    try {
      setErr(null); setTx(null); setBusy(true);
      if (!isConnected) await connect();
      if (!isMonad) await switchToMonad();
      if (!provider) throw new Error("No wallet");
      const valueWei = parseEther(buyMon || "0");
      if (valueWei <= 0n) throw new Error("Enter MON amount");
      const data = encodeCall("buy(uint256)", [1n]);
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: curve, data, value: toHexWei(valueWei) }],
      });
      setTx(String(hash));
      setTimeout(() => { loadStats(); loadTrades(); }, 3000);
    } catch (e: any) { setErr(e?.message || "Buy failed"); }
    finally { setBusy(false); }
  };

  const handleApprove = async () => {
    try {
      setErr(null); setTx(null); setBusy(true);
      if (!isConnected) await connect();
      if (!isMonad) await switchToMonad();
      if (!provider || !stats.token) throw new Error("Not ready");
      const data = encodeCall("approve(address,uint256)", [curve, sellWei]);
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: stats.token, data }],
      });
      setTx(String(hash));
    } catch (e: any) { setErr(e?.message || "Approve failed"); }
    finally { setBusy(false); }
  };

  const handleSell = async () => {
    try {
      setErr(null); setTx(null); setBusy(true);
      if (!isConnected) await connect();
      if (!isMonad) await switchToMonad();
      if (!provider) throw new Error("No wallet");
      const data = encodeCall("sell(uint256,uint256)", [sellWei, 1n]);
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: curve, data }],
      });
      setTx(String(hash));
      setTimeout(() => { loadStats(); loadTrades(); }, 3000);
    } catch (e: any) { setErr(e?.message || "Sell failed"); }
    finally { setBusy(false); }
  };

  const quickBuys = ["1", "10", "50", "100"];
  const quickSells = ["25%", "50%", "75%", "100%"];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">

      {/* LEFT: Stats + Info + Trades */}
      <div className="flex flex-col gap-4 lg:col-span-3">

        {/* Token header */}
        <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(110,84,255,0.2)" }}>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-black text-white"
              style={{ background: "linear-gradient(135deg, #6E54FF, #85E6FF)" }}>
              {stats.symbol?.slice(0, 2).toUpperCase() ?? "??"}
            </div>
            <div>
              <div className="text-xl font-extrabold text-white">{stats.name ?? "Loading…"}</div>
              <div className="text-sm" style={{ color: "#DDD7FE" }}>${stats.symbol}</div>
            </div>
            {stats.graduated && (
              <div className="ml-auto rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)" }}>
                🎓 Graduated
              </div>
            )}
          </div>

          {/* Bonding bar */}
          <div className="mt-5">
            <div className="flex justify-between text-xs mb-1.5" style={{ color: "rgba(221,215,254,0.5)" }}>
              <span>Bonding Progress</span>
              <span style={{ color: "#DDD7FE" }}>{bondedPct.toFixed(2)}%</span>
            </div>
            <div className="h-2.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(110,84,255,0.15)" }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(bondedPct, 100)}%`, background: "linear-gradient(90deg, #6E54FF, #85E6FF)" }} />
            </div>
            <div className="flex justify-between text-xs mt-1.5" style={{ color: "rgba(221,215,254,0.4)" }}>
              <span>{fmtNum(raisedMon)} MON raised</span>
              <span>{fmtNum(capMon)} MON to graduate</span>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Market Cap", mcDisplay],
            ["Price", `${price.toFixed(8)} MON`],
            ["Raised", `${fmtNum(raisedMon)} MON`],
            ["Bonded", `${bondedPct.toFixed(2)}%`],
          ].map(([label, val]) => (
            <div key={label} className="rounded-xl p-3"
              style={{ background: "rgba(110,84,255,0.06)", border: "1px solid rgba(110,84,255,0.15)" }}>
              <div className="text-xs mb-1" style={{ color: "rgba(221,215,254,0.45)" }}>{label}</div>
              <div className="font-bold text-white text-sm">{val}</div>
            </div>
          ))}
        </div>

        {/* Token info */}
        <div className="rounded-2xl p-4"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(110,84,255,0.12)" }}>
          <div className="text-xs font-semibold mb-3" style={{ color: "rgba(221,215,254,0.45)" }}>TOKEN INFO</div>
          <div className="space-y-2 text-xs">
            {[
              ["Token", stats.token ? shortAddr(stats.token) : "…"],
              ["Curve", shortAddr(curve)],
              ["Creator", stats.creator ? shortAddr(stats.creator) : "…"],
              ["Your Balance", `${fmtNum(balanceNum, 0)} ${stats.symbol ?? ""}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span style={{ color: "rgba(221,215,254,0.4)" }}>{k}</span>
                <span className="font-mono text-white">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Trades */}
        <div className="rounded-2xl p-4"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(110,84,255,0.12)" }}>
          <div className="text-xs font-semibold mb-3" style={{ color: "rgba(221,215,254,0.45)" }}>TRADE HISTORY</div>
          {trades.length === 0 ? (
            <div className="py-4 text-center text-xs" style={{ color: "rgba(221,215,254,0.3)" }}>No trades yet</div>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {trades.map((t, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl px-3 py-2 text-xs"
                  style={{
                    background: t.kind === "buy" ? "rgba(74,222,128,0.05)" : "rgba(248,113,113,0.05)",
                    border: `1px solid ${t.kind === "buy" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)"}`,
                  }}>
                  <span className="font-bold" style={{ color: t.kind === "buy" ? "#4ade80" : "#f87171" }}>
                    {t.kind.toUpperCase()}
                  </span>
                  <span className="font-mono" style={{ color: "rgba(221,215,254,0.6)" }}>{shortAddr(t.who)}</span>
                  <span style={{ color: "rgba(221,215,254,0.8)" }}>{t.monAmount.toFixed(2)} MON</span>
                  <span style={{ color: "rgba(221,215,254,0.4)" }}>{timeAgo(t.ts)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Trade panel */}
      <div className="lg:col-span-2">
        <div className="sticky top-6 rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(110,84,255,0.2)" }}>
          <div className="text-lg font-extrabold text-white mb-4">Trade</div>

          {/* Buy/Sell tab */}
          <div className="flex rounded-xl overflow-hidden mb-4"
            style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(110,84,255,0.15)" }}>
            {(["buy", "sell"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className="flex-1 py-2 text-sm font-bold transition-all"
                style={{
                  background: tab === t ? (t === "buy" ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)") : "transparent",
                  color: tab === t ? (t === "buy" ? "#4ade80" : "#f87171") : "rgba(221,215,254,0.4)",
                }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === "buy" ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                {quickBuys.map((q) => (
                  <button key={q} onClick={() => setBuyMon(q)}
                    className="flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all"
                    style={{
                      background: buyMon === q ? "rgba(110,84,255,0.3)" : "rgba(110,84,255,0.08)",
                      border: `1px solid ${buyMon === q ? "rgba(110,84,255,0.6)" : "rgba(110,84,255,0.15)"}`,
                      color: buyMon === q ? "#DDD7FE" : "rgba(221,215,254,0.5)",
                    }}>
                    {q} MON
                  </button>
                ))}
              </div>
              <div className="relative">
                <input value={buyMon} onChange={(e) => setBuyMon(e.target.value)}
                  placeholder="Amount in MON"
                  className="w-full rounded-xl px-4 py-3 text-white outline-none pr-16"
                  style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(110,84,255,0.25)", fontSize: 14 }} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: "#DDD7FE" }}>MON</span>
              </div>
              {price > 0 && parseFloat(buyMon) > 0 && (
                <div className="text-xs" style={{ color: "rgba(221,215,254,0.4)" }}>
                  ≈ {fmtNum(parseFloat(buyMon) * 0.98 / price, 0)} {stats.symbol} (after 2% fee)
                </div>
              )}
              <button onClick={handleBuy} disabled={busy || stats.graduated}
                className="w-full rounded-xl py-3 font-bold text-sm transition-all hover:opacity-90 disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #4ade80, #22c55e)", color: "#0a1a0a" }}>
                {busy ? "Buying…" : stats.graduated ? "Graduated" : `Buy ${stats.symbol ?? "Tokens"}`}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                {quickSells.map((q) => (
                  <button key={q} onClick={() => {
                    const pct = parseInt(q) / 100;
                    setSellTokens((balanceNum * pct).toFixed(0));
                  }}
                    className="flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all"
                    style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.15)", color: "rgba(248,113,113,0.7)" }}>
                    {q}
                  </button>
                ))}
              </div>
              <div className="relative">
                <input value={sellTokens} onChange={(e) => setSellTokens(e.target.value)}
                  placeholder="Tokens to sell"
                  className="w-full rounded-xl px-4 py-3 text-white outline-none pr-20"
                  style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(248,113,113,0.25)", fontSize: 14 }} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold" style={{ color: "#f87171" }}>
                  {stats.symbol}
                </span>
              </div>
              <div className="text-xs" style={{ color: "rgba(221,215,254,0.4)" }}>
                Balance: {fmtNum(balanceNum, 0)} {stats.symbol}
              </div>
              <div className="flex gap-2">
                <button onClick={handleApprove} disabled={busy || sellWei === 0n}
                  className="flex-1 rounded-xl py-3 font-bold text-sm transition-all hover:opacity-90 disabled:opacity-40"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
                  {busy ? "…" : "Approve"}
                </button>
                <button onClick={handleSell} disabled={busy || sellWei === 0n || stats.graduated}
                  className="flex-1 rounded-xl py-3 font-bold text-sm transition-all hover:opacity-90 disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, #f87171, #ef4444)", color: "white" }}>
                  {busy ? "Selling…" : "Sell"}
                </button>
              </div>
            </div>
          )}

          {!isConnected && (
            <button onClick={connect} className="mt-3 w-full rounded-xl py-2.5 text-sm font-bold"
              style={{ background: "rgba(110,84,255,0.15)", border: "1px solid rgba(110,84,255,0.3)", color: "#DDD7FE" }}>
              Connect Wallet
            </button>
          )}
          {isConnected && !isMonad && (
            <button onClick={switchToMonad} className="mt-3 w-full rounded-xl py-2.5 text-sm font-bold"
              style={{ background: "rgba(255,174,69,0.15)", border: "1px solid rgba(255,174,69,0.3)", color: "#FFAE45" }}>
              Switch to Monad
            </button>
          )}

          {err && (
            <div className="mt-3 rounded-xl px-3 py-2 text-xs"
              style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
              {err}
            </div>
          )}
          {tx && (
            <div className="mt-3 text-xs" style={{ color: "rgba(221,215,254,0.4)" }}>
              Tx: <a href={`https://monadscan.com/tx/${tx}`} target="_blank" rel="noreferrer"
                className="underline hover:text-white">{shortAddr(tx)}</a>
            </div>
          )}

          <div className="mt-4 rounded-xl px-3 py-2 text-xs"
            style={{ background: "rgba(110,84,255,0.05)", color: "rgba(221,215,254,0.35)" }}>
            2% fee on all trades. minOut = 1 for safety.
          </div>
        </div>
      </div>

    </div>
  );
}
