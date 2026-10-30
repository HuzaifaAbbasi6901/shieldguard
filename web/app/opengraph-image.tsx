import { ImageResponse } from "next/og";

// Edge runtime: the Node runtime's @vercel/og fails to resolve its wasm/font
// URLs during static generation on Windows.
export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "ShieldGuard — Ransomware & data-theft early warning";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#050810",
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 150,
            height: 150,
            borderRadius: 999,
            border: "3px solid rgba(34,211,238,0.5)",
            boxShadow: "0 0 80px rgba(34,211,238,0.35)",
            marginBottom: 42,
          }}
        >
          <svg width="86" height="86" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </div>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em" }}>
          Shield<span style={{ color: "#22d3ee" }}>Guard</span>
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "#94a3b8", marginTop: 18 }}>
          Ransomware &amp; data-theft early warning
        </div>
        <div style={{ display: "flex", fontSize: 20, color: "#34d399", marginTop: 34 }}>
          local-only · plain language · demo mode built in
        </div>
      </div>
    ),
    size,
  );
}
