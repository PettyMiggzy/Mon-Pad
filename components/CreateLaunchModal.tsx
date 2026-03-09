"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MONPAD_FACTORY } from "@/lib/web3";
import { formatEther, type Hex, decodeEventLog } from "viem";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWalletClient,
  usePublicClient,
} from "wagmi";
import { monadMainnet } from "@/lib/wagmi";

const FACTORY_ABI = [
  {
    type: "function",
    name: "creationFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "createLaunch",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "maxSupply", type: "uint256" },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
      { name: "graduator", type: "address" },
    ],
  },
  {
    type: "event",
    name: "Launched",
    inputs: [
      { indexed: true, name: "token", type: "address" },
      { indexed: true, name: "curve", type: "address" },
      { indexed: true, name: "graduator", type: "address" },
      { indexed: false, name: "creator", type: "address" },
    ],
  },
] as const;

// fixed 1B supply
const MAX_SUPPLY_WEI = 1_000_000_000n * 10n ** 18n;

export default function CreateLaunchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: monadMainnet.id });

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [feeWei, setFeeWei] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  // premium / optional fields
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;

    let alive = true;

    (async () => {
      try {
        if (!publicClient) throw new Error("No public client");

        const out = await (publicClient as any).readContract({
          address: MONPAD_FACTORY as Hex,
          abi: FACTORY_ABI,
          functionName: "creationFee",
        });

        if (!alive) return;
        setFeeWei(out as bigint);
      } catch {
        if (!alive) return;
        setFeeWei(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, publicClient]);

  const feeMon = useMemo(() => (feeWei ? formatEther(feeWei) : ""), [feeWei]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  async function waitForReceipt(hash: Hex) {
    if (!publicClient) throw new Error("No public client");
    return await (publicClient as any).waitForTransactionReceipt({
      hash,
      timeout: 120_000,
    });
  }

  function parseLaunchedFromReceipt(receipt: any) {
    const logs: any[] = receipt?.logs ?? [];

    for (const l of logs) {
      try {
        // Specifying eventName lets viem throw on non-matching logs,
        // which we catch below — no manual eventName check needed.
        const decoded = decodeEventLog({
          abi: FACTORY_ABI,
          eventName: "Launched",
          data: l.data,
          topics: l.topics,
        });

        const args = decoded.args as {
          token: string;
          curve: string;
          graduator: string;
          creator: string;
        };

        return {
          token: String(args.token),
          curve: String(args.curve),
          graduator: String(args.graduator),
          creator: String(args.creator),
        };
      } catch {
        // not a Launched log — skip
      }
    }

    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="relative w-[92%] max-w-lg rounded-2xl border border-white/10 bg-[#0a0a10]/95 p-5 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-white">Create Token</div>
            <div className="mt-1 text-xs text-white/50">
              Supply fixed at <b>1,000,000,000</b>
            </div>
            <div className="mt-2 text-[11px] text-white/55">
              Creators/Devs earn <span className="text-white">1% volume fees</span>:{" "}
              <span className="text-white">0.5% paid in real time</span> +{" "}
              <span className="text-white">0.5% paid at graduation</span>.
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs text-white/55">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Token name"
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 outline-none focus:border-[#a855f7]/50"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-white/55">Symbol</span>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="TICKER"
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 outline-none focus:border-[#a855f7]/50"
            />
          </label>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-white/70 flex items-center justify-between">
              <span>Max Supply</span>
              <span className="text-white">1,000,000,000</span>
            </div>
            <div className="mt-1 text-[11px] text-white/40">
              Fixed supply. 18 decimals. (1B tokens)
            </div>
          </div>

          <div className="mt-1 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs font-semibold text-white/80">Premium (optional)</div>

            <div className="mt-2 grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-white/55">Token Image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                  className="text-xs text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-white hover:file:bg-white/15"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-white/55">Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="1–2 lines…"
                  rows={3}
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 outline-none focus:border-[#a855f7]/50"
                />
              </label>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-xs text-white/55">Website</span>
                  <input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://…"
                    className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 outline-none focus:border-[#a855f7]/50"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-white/55">X</span>
                  <input
                    value={twitter}
                    onChange={(e) => setTwitter(e.target.value)}
                    placeholder="@handle"
                    className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 outline-none focus:border-[#a855f7]/50"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-white/55">Telegram</span>
                  <input
                    value={telegram}
                    onChange={(e) => setTelegram(e.target.value)}
                    placeholder="t.me/…"
                    className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 outline-none focus:border-[#a855f7]/50"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
          <div className="text-white/70">Creation Fee</div>
          <div className="text-white">{feeMon ? `${feeMon} MON` : "…"}</div>
        </div>

        {err ? (
          <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {err}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            disabled={busy || !name || !symbol}
            onClick={async () => {
              try {
                setErr(null);
                setTx(null);
                setBusy(true);

                if (!isConnected) throw new Error("Connect your wallet");
                if (chainId !== monadMainnet.id) {
                  await switchChainAsync({ chainId: monadMainnet.id });
                }
                if (!walletClient) throw new Error("Wallet client not ready");
                if (!feeWei) throw new Error("Could not read creation fee");

                const finalName = name.trim();
                const finalSymbol = symbol.trim().toUpperCase();

                const hash = await (walletClient as any).writeContract({
                  address: MONPAD_FACTORY as Hex,
                  abi: FACTORY_ABI,
                  functionName: "createLaunch",
                  args: [finalName, finalSymbol, MAX_SUPPLY_WEI],
                  value: feeWei,
                });

                setTx(String(hash));

                const receipt = await waitForReceipt(hash as Hex);
                const launched = parseLaunchedFromReceipt(receipt);

                if (launched) {
                  const fd = new FormData();
                  fd.set("token", launched.token);
                  fd.set("curve", launched.curve);
                  fd.set("creator", launched.creator);
                  fd.set("name", finalName);
                  fd.set("symbol", finalSymbol);
                  fd.set("description", description);
                  fd.set("website", website);
                  fd.set("twitter", twitter);
                  fd.set("telegram", telegram);
                  if (imageFile) fd.set("image", imageFile);

                  fetch("/api/metadata", { method: "POST", body: fd }).catch(() => {});
                }

                onClose();
              } catch (e: any) {
                setErr(e?.message ?? "Transaction failed");
              } finally {
                setBusy(false);
              }
            }}
            className="flex-1 rounded-full bg-[#a855f7] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create"}
          </button>

          <button
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            Cancel
          </button>
        </div>

        {tx ? (
          <div className="mt-3 text-xs text-white/55">
            Tx: {tx.slice(0, 10)}…{tx.slice(-8)}
          </div>
        ) : null}

        <div className="mt-3 text-[11px] text-white/35">
          Tip: clean logo + 1–2 lines. Links optional.
        </div>
      </div>
    </div>,
    document.body
  );
}