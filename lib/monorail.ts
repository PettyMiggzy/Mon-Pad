// lib/monorail.ts
// Typed interface against verified Monorail v4 quote response shape.
// DO NOT use as casts to coerce against this type - the previous
// implementation referenced quote.tx.* but the actual API field is
// transaction.*, and the cast suppressed compile-time errors that
// would have surfaced the drift immediately.
//
// Endpoint: GET {MONORAIL_API}/v4/quote
// Required query params: amount, from, to, slippage, sender
// Optional: deadline, source (partner id)

import { parseEther } from 'viem';
import { MONORAIL_API, MONORAIL_PARTNER_ID } from './constants';

export type MonorailQuote = {
  quote_id: string;
  block: number;
  generated_at: number;
  from: string;
  to: string;
  input: string;
  input_formatted: string;
  output: string;
  output_formatted: string;
  min_output: string;
  min_output_formatted: string;
  compound_impact: number | null;
  gas_estimate: number;
  hops: number;
  fees: {
    protocol_bps: number;
    fee_share_bps: number;
    protocol_amount: string;
    protocol_amount_formatted: string;
    fee_share_amount: string;
    fee_share_amount_formatted: string;
  };
  routes: unknown;
  transaction: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: string; // hex wei, e.g. '0x1158e460913d00000'
  };
};

export type ExecutableSwap = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
};

export type QuoteParams = {
  fromAddress: string;
  toAddress: string;
  amount: string;          // human-readable, e.g. '20.5'
  slippageBps: number;     // e.g. 100 = 1%
  sender: `0x${string}`;   // REQUIRED - without it the API returns 'No sender specified'
  deadlineSec?: number;    // default 180
  decimals?: number;       // default 18 (used to format amount)
  signal?: AbortSignal;
};

export async function getMonorailQuote(
  params: QuoteParams
): Promise<MonorailQuote | null> {
  const decimals = params.decimals ?? 18;
  // Monorail expects amount in human units (e.g. '20.00'), NOT wei.
  // parseEther formats to wei but Monorail wants decimal string - send raw.
  const amountStr = params.amount;
  void parseEther; // keep import for future use if shape changes

  const search = new URLSearchParams({
    amount: amountStr,
    from: params.fromAddress,
    to: params.toAddress,
    slippage: String(params.slippageBps),
    deadline: String(params.deadlineSec ?? 300),
    sender: params.sender,
    ...(MONORAIL_PARTNER_ID ? { source: MONORAIL_PARTNER_ID } : {}),
  });

  const url = `${MONORAIL_API}/v4/quote?${search.toString()}`;
  const res = await fetch(url, { signal: params.signal });
  if (!res.ok) {
    throw new Error(`Monorail quote http ${res.status}`);
  }
  const data = (await res.json()) as MonorailQuote & { message?: string };
  // The pathfinder returns 200 with a `message` (e.g. "no valid routes found")
  // instead of a transaction when it can't route — surface it rather than a
  // silent null so the UI can explain why.
  if (!data?.transaction?.to || !data?.transaction?.data) {
    if (data?.message) throw new Error(data.message);
    return null;
  }
  return data;
}

// Convert JSON-typed MonorailQuote.transaction (string hex value) into
// wagmi/viem compatible types (bigint value, required data).
// Single source of truth for this conversion - do not inline elsewhere.
export function toExecutable(quote: MonorailQuote): ExecutableSwap {
  return {
    to: quote.transaction.to,
    data: quote.transaction.data,
    value: quote.transaction.value ? BigInt(quote.transaction.value) : 0n,
  };
}

// Helper: derive human-readable output from MonorailQuote for UI display.
export function quoteSummary(q: MonorailQuote) {
  return {
    outputFormatted: q.output_formatted,
    minOutputFormatted: q.min_output_formatted,
    priceImpactPct: q.compound_impact !== null ? q.compound_impact * 100 : null,
    gasEstimate: q.gas_estimate,
    hops: q.hops,
  };
}
