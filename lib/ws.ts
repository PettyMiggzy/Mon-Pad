import { useEffect, useState, useRef } from 'react';
import { MOCK_MODE, INDEXER_URL } from './constants';
import { DEMO_BOARD } from './demo';
import { SAMPLE } from './mocks';
import type { Trade, TokenSummary } from './api';

type WsEvent =
  | { type: 'trade'; data: Trade }
  | { type: 'token_update'; data: TokenSummary };

const WS_URL = INDEXER_URL ? INDEXER_URL.replace(/^http/, 'ws') + '/ws' : '';

const useSyntheticFeed = () => MOCK_MODE || DEMO_BOARD;

// MOCK / demo synthetic trade emitter — cycles the seeded board roster.
function syntheticTrade(): Trade {
  const tok = SAMPLE[Math.floor(Math.random() * Math.min(SAMPLE.length, 12))];
  return {
    txHash: '0x' + Math.random().toString(16).slice(2).padStart(64, '0'),
    ts: Math.floor(Date.now() / 1000),
    side: Math.random() > 0.4 ? 'buy' : 'sell',
    wallet: '0x' + Math.random().toString(16).slice(2).padStart(40, '0'),
    tokenAddress: tok.address,
    monAmount: String(BigInt(Math.floor(Math.random() * 500 + 10)) * 10n ** 18n),
    tokenAmount: String(BigInt(Math.floor(Math.random() * 100000 + 100)) * 10n ** 18n),
    priceMon: '0.0001',
    tokenSymbol: tok.symbol,
  };
}

/**
 * Subscribe to a stream of recent trades across all tokens.
 * Returns the rolling list of the most recent N trades.
 */
export function useTradeFeed(maxItems = 30): Trade[] {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    if (useSyntheticFeed()) {
      // Seed a full strip immediately so the ticker isn't empty for 2s.
      setTrades(Array.from({ length: Math.min(maxItems, 14) }, () => syntheticTrade()));
      const interval = setInterval(() => {
        setTrades((prev) => [syntheticTrade(), ...prev].slice(0, maxItems));
      }, 1600 + Math.random() * 1400);
      return () => clearInterval(interval);
    }

    let ws: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const startPolling = () => {
      if (pollTimer) return;
      // No indexer configured → nothing to poll (avoids 404 spam on /api/recent-trades).
      // Per-token trades still come straight from chain via V3TokenActivity.
      if (!INDEXER_URL) return;
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch(`${INDEXER_URL}/api/recent-trades`);
          if (!res.ok) return;
          const data: Trade[] = await res.json();
          if (!cancelled) setTrades(data.slice(0, maxItems));
        } catch {
          // silent fail, will retry on next interval
        }
      }, 5000);
    };

    const tryWs = () => {
      if (!WS_URL) {
        startPolling();
        return;
      }
      try {
        ws = new WebSocket(WS_URL);
        ws.onmessage = (e) => {
          try {
            const ev: WsEvent = JSON.parse(e.data);
            if (ev.type === 'trade') {
              setTrades((prev) => [ev.data, ...prev].slice(0, maxItems));
            }
          } catch {
            // bad payload, ignore
          }
        };
        ws.onerror = () => {
          ws?.close();
          ws = null;
          startPolling();
        };
        ws.onclose = () => {
          if (!cancelled && !pollTimer) startPolling();
        };
      } catch {
        startPolling();
      }
    };

    tryWs();

    return () => {
      cancelled = true;
      ws?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [maxItems]);

  return trades;
}

/**
 * Subscribe to live updates for a single token (price, raised, graduation status).
 * Returns the latest TokenSummary or null until first message arrives.
 */
export function useTokenUpdates(addr: string | undefined): TokenSummary | null {
  const [token, setToken] = useState<TokenSummary | null>(null);
  const addrRef = useRef(addr);
  addrRef.current = addr;

  useEffect(() => {
    if (!addr) return;

    if (MOCK_MODE) {
      // No synthetic updates in mock for individual tokens — caller uses api.getToken instead
      return;
    }

    let ws: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const startPolling = () => {
      if (pollTimer) return;
      // No indexer configured → skip (token state is read on-chain elsewhere).
      if (!INDEXER_URL) return;
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch(`${INDEXER_URL}/api/token/${addr}`);
          if (!res.ok) return;
          const data: TokenSummary = await res.json();
          if (!cancelled && addrRef.current === addr) setToken(data);
        } catch {
          // silent fail
        }
      }, 5000);
    };

    const tryWs = () => {
      if (!WS_URL) {
        startPolling();
        return;
      }
      try {
        ws = new WebSocket(`${WS_URL}?token=${addr}`);
        ws.onmessage = (e) => {
          try {
            const ev: WsEvent = JSON.parse(e.data);
            if (ev.type === 'token_update' && ev.data.address.toLowerCase() === addr.toLowerCase()) {
              setToken(ev.data);
            }
          } catch {
            // bad payload
          }
        };
        ws.onerror = () => {
          ws?.close();
          ws = null;
          startPolling();
        };
        ws.onclose = () => {
          if (!cancelled && !pollTimer) startPolling();
        };
      } catch {
        startPolling();
      }
    };

    tryWs();

    return () => {
      cancelled = true;
      ws?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [addr]);

  return token;
}
