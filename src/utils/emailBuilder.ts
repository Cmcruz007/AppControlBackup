import type { JobRowUi } from "../types/ui"
import { safeLower, sourceLabel, formatLocal, formatDuration, escapeHtml } from "./helpers"

export function buildEmailHtml(
  rows: JobRowUi[],
  kpis: { total: number; success: number; warning: number; failed: number; running: number; pending: number },
  day: string,
  range: string
): string {
  const total = kpis.total ?? 0
  const success = kpis.success ?? 0
  const warning = kpis.warning ?? 0
  const failed = kpis.failed ?? 0
  const running = (kpis.running ?? 0) + (kpis.pending ?? 0)

  const statusOrderFn = (s: string) => (s === "failed" ? 0 : s === "warning" ? 1 : s === "running" ? 2 : s === "pending" ? 3 : 4)

  const emailRows = [...rows].sort((a, b) => {
    const aStatus = safeLower(a.status), bStatus = safeLower(b.status)
    const aIsSuccess = aStatus === "success", bIsSuccess = bStatus === "success"
    if (!aIsSuccess && bIsSuccess) return -1
    if (aIsSuccess && !bIsSuccess) return 1
    if (!aIsSuccess && !bIsSuccess) { const diff = statusOrderFn(aStatus) - statusOrderFn(bStatus); if (diff !== 0) return diff }
    const tA = a.nextRun ? new Date(a.nextRun).getTime() : 0
    const tB = b.nextRun ? new Date(b.nextRun).getTime() : 0
    return tA - tB
  })

  const kpiCards = [
    { label: "TOTAL", value: total, bg: "1E3A5F", accent: "60A5FA" },
    { label: "ÉXITOS", value: success, bg: "14532D", accent: "4ADE80" },
    { label: "AVISOS", value: warning, bg: "78350F", accent: "FBBF24" },
    { label: "ERRORES", value: failed, bg: "7F1D1D", accent: "F87171" },
    { label: "EN CURSO", value: running, bg: "0C4A6E", accent: "38BDF8" },
  ].map(k => `
    <td width="20%" style="padding:0 5px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#${k.bg}" style="border:2px solid #${k.accent};border-radius:8px">
        <tr><td align="center" style="padding:14px 10px">
          <p style="margin:0;color:#${k.accent};font-size:30px;font-weight:800;font-family:Arial,sans-serif;line-height:1">${k.value}</p>
          <p style="margin:4px 0 0 0;color:#${k.accent};font-size:10px;font-weight:700;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:1px">${k.label}</p>
        </td></tr>
      </table>
    </td>`).join("")

  const tableRows = emailRows.map((r, i) => {
    const bg = i % 2 === 0 ? "0F172A" : "1E293B"
    const crit = r.criticality === "high" ? "#ef4444" : r.criticality === "medium" ? "#f59e0b" : "#22c55e"
    const s = safeLower(r.status)
    const statusColors: any = {
      success: ["166534", "22C55E", "DCFCE7"], warning: ["854D0E", "EAB308", "FEF9C3"],
      failed: ["7F1D1D", "EF4444", "FECACA"], running: ["075985", "06B6D4", "E0F2FE"],
      pending: ["1E3A8A", "3B82F6", "DBEAFE"]
    }
    const sc = statusColors[s] || ["1E293B", "64748B", "F1F5F9"]
    const badge = r.relaunched
      ? `&nbsp;&nbsp;<span style="background:#422006;color:#fbbf24;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;font-family:Arial,sans-serif;border:1px solid #d97706">↺ Relanzado</span>`
      : ""
    return `
      <tr bgcolor="#${bg}">
        <td width="90" style="padding:10px 12px;border-top:1px solid #1e3a5f;white-space:nowrap;min-width:90px">
          <table cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#${sc[0]}" style="padding:4px 10px;border:1px solid #${sc[1]};border-radius:12px">
            <span style="color:#${sc[2]};font-size:11px;font-weight:700;font-family:Arial,sans-serif;white-space:nowrap;">${escapeHtml(s.toUpperCase())}</span>
          </td></tr></table>
        </td>
        <td width="280" style="padding:10px 12px;border-top:1px solid #1e3a5f;font-size:13px;color:#f1f5f9;font-family:Arial,sans-serif;white-space:nowrap;min-width:280px;max-width:280px;overflow:hidden;text-overflow:ellipsis">
          <table cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;width:100%"><tr>
            <td width="14" valign="middle"><span style="display:inline-block;width:10px;height:10px;background:${crit};border-radius:2px;"></span></td>
            <td valign="middle" style="font-size:13px;color:#f1f5f9;font-family:Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.jobName)}${badge}</td>
          </tr></table>
        </td>
        <td width="110" style="padding:10px 12px;border-top:1px solid #1e3a5f;font-size:12px;color:#94a3b8;font-family:Arial,sans-serif;white-space:nowrap;min-width:110px">${escapeHtml(sourceLabel(r.source))}</td>
        <td width="140" style="padding:10px 12px;border-top:1px solid #1e3a5f;font-size:12px;color:#e2e8f0;font-family:'Courier New',monospace;white-space:nowrap;min-width:140px">${escapeHtml(formatLocal(r.nextRun))}</td>
        <td width="80" style="padding:10px 12px;border-top:1px solid #1e3a5f;font-size:12px;color:#e2e8f0;font-family:'Courier New',monospace;text-align:center;white-space:nowrap;min-width:80px">${escapeHtml(formatDuration(r.durationMs))}</td>
        <td width="300" style="padding:10px 12px;border-top:1px solid #1e3a5f;font-size:12px;color:#cbd5e1;font-family:Arial,sans-serif;white-space:nowrap;min-width:300px">${escapeHtml(r.reason)}</td>
      </tr>`
  }).join("")

  const hasIncidents = failed > 0 || warning > 0
  const bannerBgColor = hasIncidents ? "DC2626" : "16A34A"
  const bannerText = hasIncidents ? "HAY INCIDENCIAS EN EL BACKUP DEL DÍA" : "TODOS LOS BACKUPS DEL DÍA SON CORRECTOS"

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0a0f1e">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0f1e">
  <tr><td align="center" style="padding:24px 16px">
    <table width="1000" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f172a" style="border:1px solid #1e3a5f;border-radius:14px;max-width:1000px">
      <tr><td bgcolor="#1e3a5f" style="padding:30px 36px;border-radius:14px 14px 0 0">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td>
            <p style="margin:0 0 6px 0;color:#60a5fa;font-size:10px;text-transform:uppercase;letter-spacing:2px;font-weight:700;font-family:Arial,sans-serif">🛡 BACKUP MONITOR PRO</p>
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;font-family:Arial,sans-serif">Informe de Backups</p>
            <p style="margin:4px 0 0 0;color:#fbbf24;font-size:15px;font-weight:700;font-family:Arial,sans-serif">${escapeHtml(day)}</p>
            <p style="margin:6px 0 0 0;color:#94a3b8;font-size:11px;font-family:Arial,sans-serif">${escapeHtml(range)}</p>
          </td>
        </tr></table>
      </td></tr>
      <tr><td bgcolor="#${bannerBgColor}" style="padding:18px 36px;">
        <p style="margin:0;color:#ffffff;font-size:18px;font-weight:800;font-family:Arial,sans-serif;text-align:center;">${bannerText}</p>
      </td></tr>
      <tr><td bgcolor="#0a0f1e" style="padding:24px 36px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${kpiCards}</tr></table>
      </td></tr>
      <tr><td style="padding:24px 36px">
        <p style="margin:0 0 12px 0;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;font-family:Arial,sans-serif">DETALLE DE JOBS</p>
        <table width="1000" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f172a" style="border:1px solid #1e3a5f;border-radius:8px;table-layout:fixed">
          <thead><tr bgcolor="#1e3a5f">
            <th align="left" width="90" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;white-space:nowrap;min-width:90px">Estado</th>
            <th align="left" width="280" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;white-space:nowrap;min-width:280px">Job</th>
            <th align="left" width="110" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;white-space:nowrap;min-width:110px">Fuente</th>
            <th align="left" width="140" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;white-space:nowrap;min-width:140px">Inicio</th>
            <th align="center" width="80" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;white-space:nowrap;min-width:80px">Dur.</th>
            <th align="left" width="300" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;white-space:nowrap;min-width:300px">Detalle</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </td></tr>
      <tr><td bgcolor="#0a0f1e" style="padding:16px 36px;border-top:1px solid #1e3a5f;border-radius:0 0 14px 14px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="color:#475569;font-size:11px;font-family:Arial,sans-serif">Generado automáticamente · Backup Monitor Pro</td>
          <td align="right" style="color:#475569;font-size:11px;font-family:Arial,sans-serif">${escapeHtml(new Date().toLocaleString("es-ES"))}</td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
  </table>
</body></html>`
}