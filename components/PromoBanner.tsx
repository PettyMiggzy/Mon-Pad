import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export default function PromoBanner() {
  return (
    <Link
      href="/create"
      aria-label="Create a coin on Mon-Pad"
      className="group relative block w-full rounded-2xl border border-border overflow-hidden mt-6 mb-8"
      style={{ aspectRatio: '1280 / 426' }}
    >
      <img
        src="/banner.jpg"
        alt="monshipad — the dev-first launchpad on Monad"
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />
      <span className="absolute bottom-3 right-3 md:bottom-4 md:right-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-purple text-white text-sm font-semibold shadow-lg shadow-brand-purple/30 group-hover:bg-brand-purple/90 transition-all">
        Create coin <ArrowRight size={16} />
      </span>
    </Link>
  )
}
