import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export default function PromoBanner() {
  return (
    <div
      className="relative w-full rounded-2xl border border-border overflow-hidden mt-6 mb-8"
      style={{ aspectRatio: '6 / 1' }}
    >
      <video
        autoPlay
        loop
        muted
        playsInline
        poster="/monpad-text-logo.png"
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src="/launch-banner.mp4" type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/40 to-black/65" />

      <div className="relative h-full flex items-center justify-between px-6 md:px-12 py-6">
        <div className="max-w-2xl">
          <h2 className="text-2xl md:text-4xl font-bold text-white leading-tight">
            Launch Your Coin on Mon-Pad
          </h2>
          <p className="text-sm md:text-base text-white/85 mt-2">
            Fair launch. 2% royalties forever. Real graduation to Uniswap V3.
          </p>
        </div>
        <Link
          href="/create"
          className="hidden md:inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-purple hover:bg-brand-purple/90 text-white font-semibold transition-all shadow-lg shadow-brand-purple/30 whitespace-nowrap"
        >
          Create Now <ArrowRight size={18} />
        </Link>
      </div>

      <Link
        href="/create"
        className="md:hidden absolute bottom-4 right-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-purple text-white text-sm font-semibold"
      >
        Create <ArrowRight size={14} />
      </Link>
    </div>
  )
}
