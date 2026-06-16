export function WhiteGearIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.67 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.67 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.67a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.51 1H15a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      <path d="M21 7V5m-2 2h2m-2-2l1.5-1.5M17.5 3.5L16 2" opacity="0.6" />
    </svg>
  )
}

export function SqlSourceIcon({ size = 16 }: { size?: number }) {
  const width = Math.round(size * 2.1)
  return (
    <svg width={width} height={size} viewBox="0 0 64 32" aria-label="SQL" role="img" style={{ display: "block" }}>
      <ellipse cx="16" cy="7" rx="10" ry="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M6 7v12c0 2.2 4.5 4 10 4s10-1.8 10-4V7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M6 13c0 2.2 4.5 4 10 4s10-1.8 10-4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M6 19c0 2.2 4.5 4 10 4s10-1.8 10-4" fill="none" stroke="currentColor" strokeWidth="2" />
      <text x="31" y="22" fontSize="14" fontWeight="700" fontFamily="Arial, sans-serif" fill="currentColor">SQL</text>
    </svg>
  )
}

export function SourceIcon({ source }: { source?: "email" | "sql" | "both" | null }) {
  const sqlIcon = (
    <span title="SQL" style={{ color: "#ffffff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <SqlSourceIcon size={16} />
    </span>
  )
  const emailIcon = <span title="Email" style={{ color: "#ffffff", fontSize: 15 }}>✉</span>

  if (source === "both") return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{sqlIcon}{emailIcon}</div>
  if (source === "email") return emailIcon
  if (source === "sql") return sqlIcon
  return <span style={{ color: "#64748b" }}>—</span>
}

export function BackupsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <rect x="3" y="10" width="18" height="4" rx="1" />
      <rect x="3" y="16" width="18" height="4" rx="1" />
    </svg>
  )
}