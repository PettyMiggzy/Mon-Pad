"use client";

import { useMemo, useState } from "react";
import ProjectCard from "@/components/ProjectCard";
import type { Project } from "@/lib/types";

type SortMode = "trending" | "newest" | "marketcap" | "oldest";

const FILTERS: { label: string; mode: SortMode }[] = [
  { label: "Trending",   mode: "trending"  },
  { label: "Newest",     mode: "newest"    },
  { label: "Market Cap", mode: "marketcap" },
  { label: "Oldest",     mode: "oldest"    },
];

// Placeholder projects shown until real launches exist
const PLACEHOLDER_PROJECTS: Project[] = [
  { name: "Monad Pepe",  symbol: "MPEPE", status: "Bonding",   token: "0x1111111111111111111111111111111111111111", curve: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", bondedPct: 67,  estMcapMon: 124500, uniqueBuyers: 89  },
  { name: "NadDog",      symbol: "NDOG",  status: "Bonding",   token: "0x2222222222222222222222222222222222222222", curve: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", bondedPct: 43,  estMcapMon: 87100,  uniqueBuyers: 54  },
  { name: "MonShark",    symbol: "MSHK",  status: "Graduated", token: "0x3333333333333333333333333333333333333333", curve: "0xcccccccccccccccccccccccccccccccccccccccc", bondedPct: 100, estMcapMon: 310200, uniqueBuyers: 203 },
  { name: "PurpleWojak", symbol: "PWJK",  status: "Bonding",   token: "0x4444444444444444444444444444444444444444", curve: "0xdddddddddddddddddddddddddddddddddddddddd", bondedPct: 22,  estMcapMon: 41300,  uniqueBuyers: 21  },
  { name: "MonadAI",     symbol: "MAI",   status: "Bonding",   token: "0x5555555555555555555555555555555555555555", curve: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", bondedPct: 78,  estMcapMon: 198700, uniqueBuyers: 134 },
  { name: "GigaBrain",   symbol: "GIGA",  status: "Bonding",   token: "0x6666666666666666666666666666666666666666", curve: "0xffffffffffffffffffffffffffffffffffffffff", bondedPct: 55,  estMcapMon: 143900, uniqueBuyers: 77  },
  { name: "Monachino",   symbol: "MONA",  status: "Bonding",   token: "0x7777777777777777777777777777777777777777", curve: "0x1111111111111111111111111111111111111112", bondedPct: 34,  estMcapMon: 62400,  uniqueBuyers: 38  },
  { name: "SpeedRun",    symbol: "SRUN",  status: "Graduated", token: "0x8888888888888888888888888888888888888888", curve: "0x2222222222222222222222222222222222222223", bondedPct: 100, estMcapMon: 267800, uniqueBuyers: 178 },
];

function sortProjects(projects: Project[], mode: SortMode): Project[] {
  const copy = [...projects];
  switch (mode) {
    case "newest":    return copy.reverse();
    case "oldest":    return copy;
    case "marketcap": return copy.sort((a, b) => b.estMcapMon - a.estMcapMon);
    case "trending":
    default:          return copy.sort((a, b) => b.uniqueBuyers - a.uniqueBuyers);
  }
}

export default function ProjectsGrid({ projects }: { projects: Project[] }) {
  const [mode, setMode] = useState<SortMode>("trending");

  const source   = projects.length > 0 ? projects : PLACEHOLDER_PROJECTS;
  const sorted   = useMemo(() => sortProjects(source, mode), [source, mode]);
  const isPlaceholder = projects.length === 0;

  return (
    <>
      {/* Filter tabs */}
      <div className="mt-6 flex gap-3 overflow-x-auto pb-1 text-sm">
        {FILTERS.map((f) => (
          <button
            key={f.mode}
            onClick={() => setMode(f.mode)}
            className="whitespace-nowrap rounded-full border px-4 py-2 transition-all duration-150"
            style={{
              background:  mode === f.mode ? "rgba(110,84,255,0.2)"  : "transparent",
              borderColor: mode === f.mode ? "rgba(110,84,255,0.5)"  : "rgba(110,84,255,0.15)",
              color:       mode === f.mode ? "#DDD7FE"               : "rgba(221,215,254,0.45)",
              cursor: "pointer",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Placeholder notice */}
      {isPlaceholder && (
        <div
          className="mt-4 rounded-xl border px-4 py-2 text-xs"
          style={{ borderColor: "rgba(110,84,255,0.2)", background: "rgba(110,84,255,0.06)", color: "rgba(221,215,254,0.5)" }}
        >
          🚀 No launches yet — showing demo tokens. Be the first to launch on MonPad!
        </div>
      )}

      {/* Grid */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {sorted.map((p) => (
          <ProjectCard key={p.curve} project={p} />
        ))}
      </div>
    </>
  );
}
