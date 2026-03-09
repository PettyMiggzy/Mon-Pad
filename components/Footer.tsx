// components/Footer.tsx
import Image from "next/image";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-20 w-full" style={{ borderTop: "1px solid rgba(110,84,255,0.12)", background: "rgba(14,9,28,0.95)" }}>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">

          {/* Monshi mascot + branding */}
          <div className="flex flex-col items-center md:items-start gap-3">
            <div className="flex items-center gap-4">
              <div
                className="relative h-16 w-16 rounded-2xl overflow-hidden flex-shrink-0"
                style={{ border: "1px solid rgba(110,84,255,0.3)", boxShadow: "0 0 20px rgba(110,84,255,0.15)" }}
              >
                <Image src="/MonshiPad.png" alt="Monshi" fill className="object-cover" />
              </div>
              <div>
                <div className="font-bold text-white">Powered by Monshi</div>
                <div className="text-xs mt-0.5" style={{ color: "rgba(221,215,254,0.4)" }}>
                  The purple cat of Monad
                </div>
              </div>
            </div>

            {/* Real Monshi socials */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <a
                href="http://www.monshi.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: "rgba(110,84,255,0.12)", border: "1px solid rgba(110,84,255,0.2)", color: "#DDD7FE" }}
              >
                🌐 Website
              </a>
              <a
                href="https://x.com/MonshiMonad"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: "rgba(110,84,255,0.12)", border: "1px solid rgba(110,84,255,0.2)", color: "#DDD7FE" }}
              >
                𝕏 Twitter
              </a>
              <a
                href="https://t.me/monshionmonad"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: "rgba(110,84,255,0.12)", border: "1px solid rgba(110,84,255,0.2)", color: "#DDD7FE" }}
              >
                ✈️ Telegram
              </a>
            </div>
          </div>

          {/* MonPad links */}
          <div className="flex flex-col items-center md:items-end gap-3">
            <div className="flex items-center gap-4 text-sm flex-wrap justify-center md:justify-end" style={{ color: "rgba(221,215,254,0.45)" }}>
              <Link href="/" className="hover:text-white transition-colors">Home</Link>
              <Link href="/terminal" className="hover:text-white transition-colors">Terminal</Link>
              <Link href="/heat-board" className="hover:text-white transition-colors">Heat Board</Link>
              <Link href="/leaderboard" className="hover:text-white transition-colors">Leaderboard</Link>
              <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
            </div>
            <div className="text-xs" style={{ color: "rgba(221,215,254,0.25)" }}>
              © 2025 MonPad · Built on Monad · Not financial advice
            </div>
          </div>

        </div>
      </div>
    </footer>
  );
}
