// lib/eth.ts — uses viem's keccak256 (no custom crypto)
import { keccak256 as viemKeccak, toBytes } from "viem";
import { RPC_HTTP } from "@/lib/web3";

export function keccak256(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? toBytes(input) : input;
  return viemKeccak(bytes);
}

export function selector(signature: string): string {
  return keccak256(signature).slice(0, 10);
}

// -----------------------------
// ABI encode helpers
// -----------------------------

function pad32(hex: string) {
  return hex.replace(/^0x/, "").padStart(64, "0");
}

export function encodeUint256(v: bigint) {
  return pad32("0x" + v.toString(16));
}

export function encodeBool(v: boolean) {
  return pad32(v ? "1" : "0");
}

export function encodeAddress(addr: string) {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function encodeBytesDynamic(bytes: Uint8Array) {
  const lenWord = encodeUint256(BigInt(bytes.length));
  const padded = Buffer.concat([
    Buffer.from(bytes),
    Buffer.alloc((32 - (bytes.length % 32)) % 32, 0),
  ]);
  return lenWord + padded.toString("hex");
}

export function encodeString(str: string) {
  return encodeBytesDynamic(new TextEncoder().encode(str));
}

export function encodeCall(signature: string, args: Array<string | bigint | boolean> = []) {
  const sel = selector(signature).replace(/^0x/, "");
  if (!args.length) return "0x" + sel;

  if (signature === "createLaunch(string,string,uint256)" && args.length === 3) {
    const a0 = String(args[0]);
    const a1 = String(args[1]);
    const a2 = BigInt(args[2] as bigint);
    const head0 = encodeUint256(96n);
    const str0 = encodeString(a0);
    const head1 = encodeUint256(96n + BigInt(str0.length / 2));
    const str1 = encodeString(a1);
    const head2 = encodeUint256(a2);
    return "0x" + sel + head0 + head1 + head2 + str0 + str1;
  }

  const enc = args
    .map((a) => {
      if (typeof a === "bigint") return encodeUint256(a);
      if (typeof a === "boolean") return encodeBool(a);
      const s = String(a);
      if (s.startsWith("0x") && s.length === 42) return encodeAddress(s);
      throw new Error("Unsupported ABI encode arg: " + s);
    })
    .join("");

  return "0x" + sel + enc;
}

export function decodeUint256(hex: string): bigint {
  return BigInt("0x" + hex.replace(/^0x/, "").slice(0, 64));
}

export function decodeBool(hex: string): boolean {
  return decodeUint256(hex) !== 0n;
}

export function decodeAddress(hex: string): string {
  return "0x" + hex.replace(/^0x/, "").slice(24, 64);
}

export function decodeString(hex: string): string {
  const h = hex.replace(/^0x/, "");
  if (h.length < 64) return "";
  const offset = Number(BigInt("0x" + h.slice(0, 64)));
  const start = offset * 2;
  if (h.length < start + 64) return "";
  const len = Number(BigInt("0x" + h.slice(start, start + 64)));
  const dataHex = h.slice(start + 64, start + 64 + len * 2);
  try {
    return new TextDecoder().decode(Buffer.from(dataHex, "hex"));
  } catch {
    return "";
  }
}

export function formatEther(wei: bigint): number {
  const s = wei.toString();
  if (s.length <= 18) return Number("0." + s.padStart(18, "0"));
  const i = s.slice(0, -18);
  const f = s.slice(-18).replace(/0+$/, "");
  return Number(f ? `${i}.${f}` : i);
}

export function parseEther(mon: string): bigint {
  const [i, f = ""] = mon.split(".");
  const frac = (f + "0".repeat(18)).slice(0, 18);
  return BigInt(i || "0") * 10n ** 18n + BigInt(frac || "0");
}

// -----------------------------
// JSON-RPC
// -----------------------------

let rpcId = 1;
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_HTTP, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    cache: "no-store",
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result as T;
}

export async function ethCall(to: string, data: string): Promise<string> {
  return rpc<string>("eth_call", [{ to, data }, "latest"]);
}

export async function ethBlockNumber(): Promise<bigint> {
  const r = await rpc<string>("eth_blockNumber", []);
  return BigInt(r);
}

export async function ethGetTransactionReceipt(txHash: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rpc<any>("eth_getTransactionReceipt", [txHash]);
}

export type RpcLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
};

export async function ethGetLogs(filter: {
  address?: string | string[];
  fromBlock: string;
  toBlock: string;
  topics?: Array<string | null | Array<string>>;
}): Promise<RpcLog[]> {
  return rpc<RpcLog[]>("eth_getLogs", [filter]);
}