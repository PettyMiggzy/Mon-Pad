import { useEffect, useState } from 'react';
import { X, Search } from 'lucide-react';
import { api, type TokenSummary } from '@/lib/api';
import { shortAddr } from '@/lib/format';

// Tailwind opacity modifiers don't work on CSS-variable colors (var(--p)),
// so brand-purple opacity variants use arbitrary-value rgba() classes.
// Values match var(--p) = #A855F7 defined in styles/globals.css.

export type TokenOption = {
  symbol: string;
  address: string;
  decimals: number;
  name?: string;
  imageUrl?: string;
};

const COMMON_TOKENS: TokenOption[] = [
  { symbol: 'MON', name: 'Monad', address: '0x0000000000000000000000000000000000000000', decimals: 18, imageUrl: '/monad.png' },
  { symbol: 'WMON', name: 'Wrapped Monad', address: '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701', decimals: 18, imageUrl: '/monad.png' },
  // TODO: Replace with proper MONSHI logo when partnership assets land
  { symbol: 'MONSHI', name: 'Monshi', address: '0xB744F5CDb792d8187640214C4A1c9aCE29af7777', decimals: 18, imageUrl: '/Pad.png' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (token: TokenOption) => void;
  currentSelected?: string;
};

export default function TokenPicker({ open, onClose, onSelect, currentSelected }: Props) {
  const [search, setSearch] = useState('');
  const [allTokens, setAllTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .listTokens()
      .then(setAllTokens)
      .catch(() => setAllTokens([]))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const seenAddresses = new Set(COMMON_TOKENS.map((t) => t.address.toLowerCase()));
  const apiAsOptions: TokenOption[] = allTokens
    .filter((t) => !seenAddresses.has(t.address.toLowerCase()))
    .map((t) => ({
      symbol: t.symbol,
      address: t.address,
      decimals: 18,
      name: t.name,
      imageUrl: t.imageUrl,
    }));

  const all = [...COMMON_TOKENS, ...apiAsOptions];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? all.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          (t.name && t.name.toLowerCase().includes(q)) ||
          t.address.toLowerCase().includes(q),
      )
    : all;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-white">Select Token</h3>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors"
            aria-label="Close token picker"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-border">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, symbol, or address"
              className="w-full pl-10 pr-4 py-3 bg-black/40 border border-border rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-brand-purple"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="text-center py-8 text-white/50">Loading tokens...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-white/50">No tokens match &quot;{search}&quot;</div>
          ) : (
            filtered.map((t) => {
              const isSelected =
                currentSelected !== undefined &&
                currentSelected.toLowerCase() === t.address.toLowerCase();
              return (
                <button
                  key={t.address}
                  onClick={() => {
                    onSelect(t);
                    onClose();
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${
                    isSelected
                      ? 'bg-[rgba(168,85,247,0.15)] border border-[rgba(168,85,247,0.4)]'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {t.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.imageUrl}
                      alt={t.symbol}
                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-brand-purple flex items-center justify-center text-white font-bold flex-shrink-0">
                      {t.symbol[0]}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-semibold text-white">{t.symbol}</div>
                    <div className="text-xs text-white/50 truncate">
                      {t.name || shortAddr(t.address)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
