import * as XLSX from "xlsx-js-style"
import type { JobRowUi } from "../types/ui"
import { safeLower, sourceLabel, formatLocal, formatDuration } from "./helpers"

export function buildExcelWorkbook(
  rows: JobRowUi[],
  kpis: { total: number; success: number; warning: number; failed: number; running: number; pending: number },
  day: string,
  range: string
) {
  const statusOrderFn = (s: string) => (s === "failed" ? 0 : s === "warning" ? 1 : s === "running" ? 2 : s === "pending" ? 3 : 4)
  const sortedRows = [...rows].sort((a, b) => {
    const pA = statusOrderFn(safeLower(a.status)), pB = statusOrderFn(safeLower(b.status))
    if (pA !== pB) return pA - pB
    return (a.jobName || "").localeCompare(b.jobName || "")
  })

  const headerBg = "1E3A5F"
  const titleStyle = { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 18 }, fill: { fgColor: { rgb: headerBg } }, alignment: { horizontal: "center", vertical: "center" } } as any
  const subtitleStyle = { font: { bold: true, color: { rgb: "FBBF24" }, sz: 12 }, fill: { fgColor: { rgb: headerBg } }, alignment: { horizontal: "center", vertical: "center" } } as any
  const rangeStyle = { font: { color: { rgb: "94A3B8" }, sz: 10 }, fill: { fgColor: { rgb: headerBg } }, alignment: { horizontal: "center", vertical: "center" } } as any

  const hasIncidents = kpis.failed > 0 || kpis.warning > 0
  const bannerStyle = { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 }, fill: { fgColor: { rgb: hasIncidents ? "DC2626" : "16A34A" } }, alignment: { horizontal: "center", vertical: "center" } } as any
  const bannerText = hasIncidents ? "HAY INCIDENCIAS EN EL BACKUP DEL DÍA" : "TODOS LOS BACKUPS DEL DÍA SON CORRECTOS"

  const kpiHeaderStyle = { font: { bold: true, color: { rgb: "94A3B8" }, sz: 10 }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "center" } } as any
  const kpiValueStyle = (color: string) => ({ font: { bold: true, color: { rgb: color }, sz: 18 }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "center" } }) as any

  const thStyle = { font: { bold: true, color: { rgb: "60A5FA" }, sz: 11 }, fill: { fgColor: { rgb: "182241" } }, alignment: { vertical: "center" }, border: { bottom: { style: "medium", color: { rgb: "60A5FA" } } } } as any
  const tdStyle = { font: { color: { rgb: "000000" }, sz: 11 }, alignment: { vertical: "center" }, border: { bottom: { style: "thin", color: { rgb: "E2E8F0" } } } } as any

  const getStatusStyle = (status: string) => {
    const s = safeLower(status)
    if (s === 'success') return { font: { bold: true, color: { rgb: "166534" } }, fill: { fgColor: { rgb: "DCFCE7" } }, alignment: { horizontal: "center", vertical: "center" }, border: tdStyle.border } as any
    if (s === 'warning') return { font: { bold: true, color: { rgb: "92400E" } }, fill: { fgColor: { rgb: "FEF3C7" } }, alignment: { horizontal: "center", vertical: "center" }, border: tdStyle.border } as any
    if (s === 'failed') return { font: { bold: true, color: { rgb: "991B1B" } }, fill: { fgColor: { rgb: "FEE2E2" } }, alignment: { horizontal: "center", vertical: "center" }, border: tdStyle.border } as any
    if (s === 'running' || s === 'pending') return { font: { bold: true, color: { rgb: "075985" } }, fill: { fgColor: { rgb: "E0F2FE" } }, alignment: { horizontal: "center", vertical: "center" }, border: tdStyle.border } as any
    return { font: { bold: true, color: { rgb: "475569" } }, fill: { fgColor: { rgb: "F1F5F9" } }, alignment: { horizontal: "center", vertical: "center" }, border: tdStyle.border } as any
  }

  const fill = (s: any) => [{ v: "", s }, { v: "", s }, { v: "", s }, { v: "", s }, { v: "", s }]

  const wsData = [
    [{ v: "Informe de Backups", s: titleStyle }, ...fill(titleStyle)],
    [{ v: day, s: subtitleStyle }, ...fill(subtitleStyle)],
    [{ v: range, s: rangeStyle }, ...fill(rangeStyle)],
    [],
    [{ v: bannerText, s: bannerStyle }, ...fill(bannerStyle)],
    [],
    [
      { v: "TOTAL", s: kpiHeaderStyle }, { v: "ÉXITOS", s: kpiHeaderStyle },
      { v: "AVISOS", s: kpiHeaderStyle }, { v: "ERRORES", s: kpiHeaderStyle },
      { v: "EN CURSO/PEND.", s: kpiHeaderStyle }, { v: "", s: kpiHeaderStyle }
    ],
    [
      { v: kpis.total, s: kpiValueStyle("3B82F6") }, { v: kpis.success, s: kpiValueStyle("22C55E") },
      { v: kpis.warning, s: kpiValueStyle("F59E0B") }, { v: kpis.failed, s: kpiValueStyle("EF4444") },
      { v: kpis.running + kpis.pending, s: kpiValueStyle("06B6D4") }, { v: "", s: kpiValueStyle("0F172A") }
    ],
    [],
    [
      { v: "ESTADO", s: thStyle }, { v: "JOB", s: thStyle }, { v: "FUENTE", s: thStyle },
      { v: "INICIO", s: thStyle }, { v: "DURACIÓN", s: thStyle }, { v: "DETALLE", s: thStyle }
    ],
    ...sortedRows.map((r) => [
      { v: String(r.status ?? "").toUpperCase(), s: getStatusStyle(r.status) },
      { v: r.jobName ?? "", s: tdStyle }, { v: sourceLabel(r.source), s: tdStyle },
      { v: formatLocal(r.nextRun), s: tdStyle }, { v: formatDuration(r.durationMs), s: tdStyle },
      { v: r.reason ?? "", s: tdStyle }
    ])
  ]

  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = [{ wch: 15 }, { wch: 45 }, { wch: 15 }, { wch: 20 }, { wch: 12 }, { wch: 70 }]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }, { s: { r: 4, c: 0 }, e: { r: 4, c: 5 } },
  ]
  ws['!rows'] = [
    { hpt: 35 }, { hpt: 20 }, { hpt: 20 }, { hpt: 10 },
    { hpt: 35 }, { hpt: 15 }, { hpt: 20 }, { hpt: 35 }, { hpt: 20 }, { hpt: 25 }
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Backups")
  return wb
}