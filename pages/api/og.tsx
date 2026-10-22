import type { NextApiRequest, NextApiResponse } from 'next';
import { ImageResponse } from '@vercel/og';
import React from 'react';
import { api, type TokenSummary } from '@/lib/api';

// Node runtime (default for pages/api/*.tsx). Do NOT set runtime: 'edge' —
// we want to reuse @/lib/api directly and our traffic profile doesn't need
// edge cold-start speedups. Cached at the Vercel edge via Cache-Control
// below so origin only fires once per token per minute.

export const config = {
  api: {
    bodyParser: false,
  },
};

const BRAND_DEEP = '#1a0b2e';
const BRAND_PURPLE = '#7c3aed';
const BRAND_LIGHT = '#a78bfa';
const TEXT_PRIMARY = '#ffffff';
const TEXT_MUTED = 'rgba(255,255,255,0.7)';
const OK_GREEN = '#4ADE80';

function fmtMon(value: string | undefined): string {
  if (!value) return '0';
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtAgo(createdAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const delta = Math.max(0, now - createdAt);
  if (delta < 60) return 'just now';
  if (delta < 3600) return Math.floor(delta / 60) + 'm ago';
  if (delta < 86400) return Math.floor(delta / 3600) + 'h ago';
  if (delta < 86400 * 30) return Math.floor(delta / 86400) + 'd ago';
  return Math.floor(delta / (86400 * 30)) + 'mo ago';
}

function letterAvatarBg(symbol: string): string {
  // Stable hash to pick a tint
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) | 0;
  const hues = [270, 285, 250, 295, 260];
  const hue = hues[Math.abs(h) % hues.length];
  return `hsl(${hue}, 65%, 55%)`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const addr = typeof req.query.addr === 'string' ? req.query.addr : '';

  if (!addr) {
    const image = new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            background: 'linear-gradient(160deg, #07050c 0%, #4c1d95 55%, #ff4d9a 140%)',
            color: '#fff',
            padding: 72,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ display: 'flex', fontSize: 28, letterSpacing: 6, color: '#ff4d9a' }}>MONAD</div>
          <div style={{ display: 'flex', fontSize: 108, fontWeight: 800, letterSpacing: -2 }}>MON PAD</div>
          <div style={{ display: 'flex', fontSize: 32, color: 'rgba(255,255,255,0.8)' }}>You&apos;re smart. Drive.</div>
        </div>
      ),
      { width: 1200, height: 630 },
    );
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(image);
  }

  // Fetch token data — gracefully degrade if it fails
  let token: TokenSummary | null = null;
  try {
    token = await api.getToken(addr);
  } catch {
    token = null;
  }

  const name = token?.name ?? 'Unknown Token';
  const symbol = token?.symbol ?? '???';
  const imageUrl = token?.imageUrl;
  const mcap = token?.marketCapMon ?? '0';
  const volume = token?.volume24hMon ?? '0';
  const createdAt = token?.createdAt ?? 0;
  const volumeNum = Number(volume) || 0;
  const showVolume = volumeNum > 0;

  const avatarLetter = (symbol[0] || '?').toUpperCase();
  const avatarBg = letterAvatarBg(symbol);

  try {
    const image = new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            background: `linear-gradient(135deg, ${BRAND_DEEP} 0%, ${BRAND_PURPLE} 100%)`,
            color: TEXT_PRIMARY,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: 60,
            position: 'relative',
          }}
        >
          {/* Watermark top-right */}
          <div
            style={{
              position: 'absolute',
              top: 40,
              right: 60,
              display: 'flex',
              alignItems: 'center',
              fontSize: 22,
              fontWeight: 700,
              color: TEXT_MUTED,
              letterSpacing: 1,
            }}
          >
            MON-PAD
          </div>

          {/* Top row: logo + name */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 48,
              marginTop: 20,
            }}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                width={240}
                height={240}
                style={{
                  borderRadius: 120,
                  border: `4px solid ${BRAND_LIGHT}`,
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  width: 240,
                  height: 240,
                  borderRadius: 120,
                  background: avatarBg,
                  border: `4px solid ${BRAND_LIGHT}`,
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 120,
                  fontWeight: 800,
                  color: TEXT_PRIMARY,
                }}
              >
                {avatarLetter}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 64,
                  fontWeight: 800,
                  lineHeight: 1.05,
                  letterSpacing: -1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {name.length > 22 ? name.slice(0, 22) + '...' : name}
              </div>
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 600,
                  color: BRAND_LIGHT,
                }}
              >
                ${symbol.length > 12 ? symbol.slice(0, 12) : symbol}
              </div>
            </div>
          </div>

          {/* Middle row: stats */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 40,
              gap: 14,
              paddingLeft: 4,
            }}
          >
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 700 }}>
              <span style={{ color: TEXT_PRIMARY }}>{fmtMon(mcap)} MON</span>
              <span style={{ color: TEXT_MUTED, marginLeft: 14, fontWeight: 500 }}>
                market cap
              </span>
            </div>
            {showVolume ? (
              <div style={{ display: 'flex', fontSize: 30, fontWeight: 600 }}>
                <span style={{ color: TEXT_PRIMARY }}>{fmtMon(volume)} MON</span>
                <span style={{ color: TEXT_MUTED, marginLeft: 14, fontWeight: 500 }}>
                  volume 24h
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', fontSize: 30, fontWeight: 600 }}>
                <span style={{ color: TEXT_MUTED }}>Launched {fmtAgo(createdAt)}</span>
              </div>
            )}
          </div>

          {/* Pair line */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              position: 'absolute',
              bottom: 60,
              left: 60,
              right: 60,
              gap: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                width: '100%',
                height: 2,
                background: 'rgba(255,255,255,0.15)',
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                fontSize: 28,
                fontWeight: 700,
                color: OK_GREEN,
                marginTop: 16,
              }}
            >
              <span style={{ fontSize: 32, marginRight: 14 }}>{'\u2713'}</span>
              ON UNISWAP V3
              <span style={{ color: TEXT_MUTED, fontWeight: 500, marginLeft: 14 }}>
                from block one
              </span>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );

    // Stream the PNG to the response with edge cache headers
    const buffer = Buffer.from(await image.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader(
      'Cache-Control',
      'public, immutable, no-transform, max-age=60, s-maxage=60, stale-while-revalidate=300'
    );
    res.status(200).send(buffer);
  } catch (err) {
    res.status(500).send('OG render failed');
  }
}
