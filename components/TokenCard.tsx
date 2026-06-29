import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import type { TokenSummary } from '../lib/api';
import { fmtMon } from '../lib/format';
import { graduationProgress } from '../lib/curve';

type Props = {
  token: TokenSummary;
  /** Index in the parent grid, used for stagger timing. Defaults to 0. */
  index?: number;
};

function Sparkline({ points }: { points: number[] }) {
  if (!points || points.length < 2) return null;
  const w = 200;
  const h = 60;
  const pad = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const yFor = (v: number) => pad + (h - pad * 2) * (1 - (v - min) / range);
  const pts = points.map((v, i) => `${pad + i * stepX},${yFor(v)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const eps = Math.max(1e-9, Math.abs(first) * 0.001);
  const color = last - first > eps ? '#4ADE80' : first - last > eps ? '#F87171' : '#6B7280';
  const gradId = `spark-grad-${Math.abs(first * 1000 | 0)}-${points.length}`;
  const areaPts = `${pad},${h - pad} ${pts} ${w - pad},${h - pad}`;
  const lastX = pad + (points.length - 1) * stepX;
  const lastY = yFor(last);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height: 60, marginBottom: 8 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#${gradId})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={2.25} fill={color} />
    </svg>
  );
}

export default function TokenCard({ token, index = 0 }: Props) {
  // Bonding-curve progress 0..1. graduationProgress takes bigint(monRaisedNet).
  const progressRaw = graduationProgress(BigInt(token.monRaisedNet));
  const progress = Math.max(0, Math.min(1, progressRaw));
  const progressPct = progress * 100;
  // Clamp visual bar at 99% pre-graduation so the "NEAR GRAD" pill carries the energy.
  const barPct = token.graduated ? 100 : Math.min(99, progressPct);
  const nearGrad = !token.graduated && progressPct >= 95;

  const placeholderLetter = (token.symbol || '?').slice(0, 1).toUpperCase();

  return (
    <Link
      href={`/token/${token.address}`}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4), ease: 'easeOut' }}
        whileHover={{
          y: -2,
          boxShadow: '0 0 24px rgba(168, 85, 247, 0.5)',
          borderColor: 'var(--bd-glow, rgba(168, 85, 247, 0.5))',
        }}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 180,
          padding: 12,
          borderRadius: 12,
          background: 'var(--bg-card, rgba(28, 24, 56, 0.6))',
          border: '1px solid var(--bd, rgba(139, 92, 246, 0.15))',
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      >
        {/* Image / placeholder */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 10,
            background: 'var(--brand, #8B5CF6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {token.imageUrl ? (
            <Image
              src={token.imageUrl}
              alt={token.symbol}
              fill
              sizes="(max-width: 640px) 45vw, 180px"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <span
              style={{
                fontSize: 48,
                fontWeight: 800,
                color: '#fff',
                lineHeight: 1,
                letterSpacing: -1,
              }}
            >
              {placeholderLetter}
            </span>
          )}

          {token.graduated && (
            <div
              style={{
                position: 'absolute',
                top: 6,
                left: 6,
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.5,
                background: 'rgba(0, 0, 0, 0.7)',
                color: 'var(--brand, #8B5CF6)',
                border: '1px solid var(--bd-glow, rgba(168, 85, 247, 0.5))',
                textTransform: 'uppercase',
              }}
            >
              Graduated
            </div>
          )}
        </div>

        {/* Name + symbol badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 14,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--fg, #fff)',
            }}
          >
            {token.name}
          </div>
          <div
            style={{
              flexShrink: 0,
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              background: 'var(--bg-chip, rgba(139, 92, 246, 0.15))',
              color: 'var(--brand, #8B5CF6)',
              letterSpacing: 0.3,
            }}
          >
            {token.symbol}
          </div>
        </div>

        {/* Creator */}
        {token.creator && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--fg-muted, rgba(255,255,255,0.45))',
              marginTop: -4,
              marginBottom: 8,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            by {token.creator.slice(0, 6)}…{token.creator.slice(-4)}
          </div>
        )}

        <Sparkline points={token.sparkline ?? []} />
      {/* Market cap + 24h volume */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--fg-muted, rgba(255,255,255,0.6))',
            marginBottom: 4,
          }}
        >
          <span>MC</span>
          <span style={{ color: '#4ADE80', fontWeight: 700 }}>
            {fmtMon(token.marketCapMon)} MON
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--fg-muted, rgba(255,255,255,0.6))',
            marginBottom: 8,
          }}
        >
          <span>24h Vol</span>
          <span style={{ color: 'var(--fg, #fff)', fontWeight: 500 }}>
            {fmtMon(token.volume24hMon)} MON
          </span>
        </div>

        {/* Graduation row */}
        {token.graduated ? (
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--brand, #8B5CF6)',
              textAlign: 'center',
              padding: '4px 0',
            }}
          >
            🎓 Graduated to LP
          </div>
        ) : (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 10,
                marginBottom: 4,
              }}
            >
              <span style={{ color: 'var(--fg-muted, rgba(255,255,255,0.6))' }}>
                {progressPct.toFixed(1)}%
              </span>
              {nearGrad && (
                <span
                  style={{
                    padding: '1px 6px',
                    borderRadius: 999,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    background: 'var(--bd-glow, rgba(168, 85, 247, 0.5))',
                    color: '#fff',
                    textTransform: 'uppercase',
                  }}
                >
                  Near Grad
                </span>
              )}
            </div>
            <div
              style={{
                position: 'relative',
                height: 4,
                borderRadius: 999,
                background: 'var(--bd, rgba(139, 92, 246, 0.15))',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${barPct}%`,
                  background:
                    'linear-gradient(90deg, var(--brand, #8B5CF6), var(--bd-glow, rgba(168, 85, 247, 0.5)))',
                  borderRadius: 999,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
        )}
      </motion.div>
    </Link>
  );
}
