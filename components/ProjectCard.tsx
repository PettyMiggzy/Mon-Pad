import type { Project } from "@/lib/types";
import Link from "next/link";

function shortAddr(a: string) {
  if (!a) return "";
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function fmtMon(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function tokenGradient(addr: string) {
  const colors = [
    ["#6E54FF", "#85E6FF"],
    ["#6E54FF", "#FF8EE4"],
    ["#6E54FF", "#FFAE45"],
    ["#85E6FF", "#6E54FF"],
    ["#FF8EE4", "#FFAE45"],
  ];
  const idx = parseInt((addr || "0x00").slice(2, 4), 16) % colors.length;
  return colors[idx];
}

export default function ProjectCard({ project }: { project: Project }) {
  const isGraduated = project.status === "Graduated";
  const pct = Math.min(100, Math.max(0, project.bondedPct ?? 0));
  const [c1, c2] = tokenGradient(project.token || project.curve);
  const initials = (project.name || "??").slice(0, 2).toUpperCase();

  // MC = totalSupply (1B) × priceWeiPerToken — comes from API as estMcapMon
  // Show it properly
  const mcMon = project.estMcapMon ?? 0;
  const priceMon = project.priceWeiPerToken
    ? Number(BigInt(project.priceWeiPerToken.toString())) / 1e18
    : 0;

  return (
          <Link href={`/token/${project.token || project.curve}`} style={{ textDecoration: "none" }}>
      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: isGraduated ? "1px solid rgba(110,84,255,0.45)" : "1px solid rgba(110,84,255,0.12)",
          borderRadius: 20,
          padding: 16,
          cursor: "pointer",
          transition: "transform 0.18s, border 0.18s, box-shadow 0.18s",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.transform = "translateY(-3px)";
          el.style.border = "1px solid rgba(110,84,255,0.5)";
          el.style.boxShadow = "0 8px 32px rgba(110,84,255,0.15)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.transform = "translateY(0)";
          el.style.border = isGraduated ? "1px solid rgba(110,84,255,0.45)" : "1px solid rgba(110,84,255,0.12)";
          el.style.boxShadow = "none";
        }}
      >
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Avatar — TODO: replace src with project.imageUrl when available */}
          <div style={{
            width: 52, height: 52, borderRadius: 16, flexShrink: 0,
            background: `linear-gradient(135deg, ${c1}, ${c2})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 900, color: "white",
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 900, color: "white", fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {project.name}
              </span>
              {isGraduated && (
                <span style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  🎓 Grad
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "rgba(221,215,254,0.45)", marginTop: 2 }}>
              ${project.symbol} · {shortAddr(project.token)}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
          <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: "rgba(221,215,254,0.4)" }}>Market Cap</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "white", marginTop: 3 }}>
              {fmtMon(mcMon)} <span style={{ fontSize: 11, fontWeight: 400, color: "rgba(221,215,254,0.5)" }}>MON</span>
            </div>
          </div>
          <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: "rgba(221,215,254,0.4)" }}>Holders</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "white", marginTop: 3 }}>{project.uniqueBuyers ?? 0}</div>
          </div>
          <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: "rgba(221,215,254,0.4)" }}>Raised</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "white", marginTop: 3 }}>
              {fmtMon(project.raisedMon ?? 0)} <span style={{ fontSize: 11, fontWeight: 400, color: "rgba(221,215,254,0.5)" }}>MON</span>
            </div>
          </div>
          <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: "rgba(221,215,254,0.4)" }}>Price</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "white", marginTop: 3 }}>
              {priceMon > 0 ? priceMon.toFixed(6) : (project.price ?? 0).toFixed(6)}
            </div>
          </div>
        </div>

        {/* Bonding curve */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
            <span style={{ color: "rgba(221,215,254,0.45)" }}>Bonding curve</span>
            <span style={{ color: isGraduated ? "#4ade80" : "#DDD7FE", fontWeight: 700 }}>
              {isGraduated ? "✓ Graduated" : `${pct.toFixed(1)}%`}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 999,
              width: `${pct}%`,
              background: isGraduated ? "linear-gradient(90deg, #4ade80, #22d3ee)" : "linear-gradient(90deg, #6E54FF, #DDD7FE)",
              transition: "width 0.5s",
            }} />
          </div>
        </div>
      </div>
    </Link>
  );
}
