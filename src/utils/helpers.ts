import type { JobRowUi } from "../types/ui"

export function safeLower(value: unknown) {
  return String(value ?? "").toLowerCase()
}

export function normalizeCriticality(value?: string | null) {
  if (value === "high" || value === "medium" || value === "low") return value
  return "low"
}

export function criticalityLabel(value?: string | null) {
  const v = normalizeCriticality(value)
  if (v === "high") return "Alta"
  if (v === "medium") return "Media"
  return "Baja"
}

export function pad2(n: number) {
  return String(n).padStart(2, "0")
}

export function formatLocal(iso?: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function formatDuration(ms?: number | null) {
  if (ms == null || Number.isNaN(ms)) return "—"
  const totalMin = Math.max(0, Math.round(ms / 60000))
  const hh = String(Math.floor(totalMin / 60)).padStart(2, "0")
  const mm = String(totalMin % 60).padStart(2, "0")
  return `${hh}:${mm}`
}

export function sourceLabel(source?: JobRowUi["source"] | "both") {
  if (source === "both") return "SQL + Email"
  if (source === "email") return "Email"
  if (source === "sql") return "SQL"
  return "—"
}

export function buildKpis(rows: JobRowUi[]) {
  const total = rows.length
  const success = rows.filter((r) => r.status === "success").length
  const warning = rows.filter((r) => r.status === "warning").length
  const failed = rows.filter((r) => r.status === "failed").length
  const running = rows.filter((r) => r.status === "running").length
  const pending = rows.filter((r) => r.status === "pending").length
  return { total, success, warning, failed, running, pending }
}

export function getWindowParts(start: string | null, end: string | null) {
  if (!start || !end) return { day: "", range: "" }
  const s = new Date(start)
  const e = new Date(end)
  const day = s.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }).toUpperCase()
  const range = `Ventana ${s.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} ${s.toLocaleDateString("es-ES")} - ${e.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} ${e.toLocaleDateString("es-ES")}`
  return { day, range }
}

export function statusOrder(status: string) {
  const map: Record<string, number> = { failed: 0, warning: 1, running: 2, pending: 3, missing: 4, success: 5 }
  return map[status] ?? 99
}

export function normalizeManualStatusUi(status: string) {
  const s = safeLower(status).trim()
  if (["success", "ok", "éxito", "exito"].includes(s)) return "success"
  if (["warning", "warn", "aviso"].includes(s)) return "warning"
  if (["failed", "fail", "error", "fallido"].includes(s)) return "failed"
  if (["running", "ejecutando", "en curso"].includes(s)) return "running"
  if (["pending", "pendiente"].includes(s)) return "pending"
  return s || "success"
}

export function sourceRank(source?: JobRowUi["source"] | "both") {
  if (source === "both") return 3
  if (source === "email") return 2
  if (source === "sql") return 1
  return 0
}

export function escapeHtml(value: any): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}