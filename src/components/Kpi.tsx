import type { CSSProperties } from "react"
import type { KpiProps } from "../types/ui"

export default function Kpi({ label, value, accentColor, active = false, onClick }: KpiProps) {
  const style = {
    "--accent": accentColor || "var(--border)",
    cursor: onClick ? "pointer" : "default",

    borderColor: accentColor,

    boxShadow: accentColor
      ? `0 0 0 1px ${accentColor} inset, 0 0 12px ${accentColor}33`
      : undefined,

    background: accentColor
      ? `${accentColor}15`
      : undefined,

    transform: active ? "translateY(-1px)" : undefined,

    transition:
      "transform .15s ease, box-shadow .15s ease, border-color .15s ease, background .15s ease",
  } as CSSProperties

  const content = (
    <>
      <div className="label">{label}</div>

      
<div
  className="value"
  style={{
    color: accentColor,
    textShadow: `0 0 6px ${accentColor}55`,
  }}
>
  {value}
</div>


      <div
        className="accent-bar"
        style={{
          background: accentColor,
          opacity: 1,
          width: 6,
        }}
      />
    </>
  )

  if (!onClick) return <div className="kpi-card" style={style}>{content}</div>

  return (
    <div className="kpi-card" role="button" tabIndex={0} aria-pressed={active}
      title={`Filtrar por ${label}`} onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick() } }}
      style={style}
    >
      {content}
    </div>
  )
}