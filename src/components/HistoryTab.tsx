import { useCallback, useEffect, useMemo, useState } from "react"
import * as XLSX from "xlsx-js-style"
import type { AppConfig, JobRowUi, SortKey, SortDir, ManualOverride, CategoryFilter, HistoryPayload } from "../types/ui"
import { api } from "../utils/api"
import { safeLower, buildKpis, getWindowParts, statusOrder, sourceRank, normalizeManualStatusUi } from "../utils/helpers"
import { buildEmailHtml } from "../utils/emailBuilder"
import { buildExcelWorkbook } from "../utils/excelBuilder"
import { exportScheduleExcel } from "../scheduleExcel"
import Kpi from "./Kpi"
import JobTable from "./JobTable"
import HistoryCalendar from "./HistoryCalendar"
import CommentEditor from "./CommentEditor"
import EmailModal from "./EmailModal"

async function handleExportScheduleExcel() {
  try {
    const res = await api().getSchedule30()
    await exportScheduleExcel(async () => res as any)
  } catch (e) {
    alert(`Error getSchedule30: ${String(e)}`)
  }
}

export default function HistoryTab({
  onWindowChange, config, onManualOverrideSaved, onOpenExecutions, activeCategory,
}: {
  onWindowChange: (start: string | null, end: string | null) => void
  config: AppConfig | null
  onManualOverrideSaved: (cfg: AppConfig) => Promise<void>
  onOpenExecutions: (jobName: string) => void
  activeCategory: CategoryFilter
}) {
  const [availableDays, setAvailableDays] = useState<string[]>([])
  const [loadingDays, setLoadingDays] = useState(true)
  const [daysError, setDaysError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [histFull, setHistFull] = useState<JobRowUi[]>([])
  const [histRows, setHistRows] = useState<JobRowUi[]>([])
  const [histWindow, setHistWindow] = useState<{ start: string | null; end: string | null } | null>(null)
  const [loadingDay, setLoadingDay] = useState(false)
  const [dayError, setDayError] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [showAll, setShowAll] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>("nextRun")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [editingJobId, setEditingJobId] = useState<string | null>(null)
  const [emailModal, setEmailModal] = useState(false)
  const [logModalData, setLogModalData] = useState<{ jobName: string; content: string | null } | null>(null)

  useEffect(() => {
    setLoadingDays(true)
    api().getHistoryDays()
      .then((res: any) => { setLoadingDays(false); if (res?.ok) setAvailableDays(res.days ?? []); else setDaysError(res?.error ?? "Error al cargar días") })
      .catch((e: any) => { setLoadingDays(false); setDaysError(e?.message ?? String(e)) })
  }, [])

  const loadDay = useCallback(async (dateStr: string) => {
    setSelectedDay(dateStr); setLoadingDay(true); setDayError(null)
    setHistFull([]); setHistRows([]); setHistWindow(null); onWindowChange(null, null)
    try {
      const res = (await api().getHistoryDay(dateStr)) as HistoryPayload
      setLoadingDay(false)
      if ((res as any)?.ok) {
        setHistFull(((res as any).fullRows ?? []) as JobRowUi[])
        setHistRows(((res as any).rows ?? []) as JobRowUi[])
        if ((res as any).windowStart || (res as any).windowEnd) {
          setHistWindow({ start: (res as any).windowStart ?? null, end: (res as any).windowEnd ?? null })
          onWindowChange((res as any).windowStart ?? null, (res as any).windowEnd ?? null)
        }
      } else { setDayError((res as any)?.error ?? "Error al cargar el día") }
    } catch (e: any) { setLoadingDay(false); setDayError(e?.message ?? String(e)) }
  }, [onWindowChange])

  const kpis = useMemo(() => buildKpis(histFull), [histFull])
  const { day, range } = getWindowParts(histWindow?.start ?? null, histWindow?.end ?? null)

  const filtered = useMemo(() => {
    let source = showAll ? histFull : histRows
    const base = source.filter((r) => {
      if (statusFilter !== "all") {
        if (statusFilter === "running") { if (r.status !== "running" && r.status !== "pending") return false }
        else { if (r.status !== statusFilter) return false }
      }
      if (filter && !safeLower(r.jobName).includes(safeLower(filter))) return false
      return true
    })
    const dir = sortDir === "asc" ? 1 : -1
    return [...base].sort((a, b) => {
      const get = (r: JobRowUi): string | number => {
        switch (sortKey) {
          case "status": return statusOrder(r.status)
          case "jobName": return safeLower(r.jobName)
          case "nextRun": return r.nextRun ? new Date(r.nextRun).getTime() : 0
          case "source": return sourceRank(r.source)
          case "duration": return r.durationMs ?? -1
          case "reason": return safeLower(r.reason)
          default: return 0
        }
      }
      const va = get(a), vb = get(b)
      return va < vb ? -1 * dir : va > vb ? 1 * dir : 0
    })
  }, [histFull, histRows, showAll, filter, statusFilter, sortKey, sortDir])

  const emailPreviewHtml = useMemo(() => buildEmailHtml(histFull, kpis, day, range), [histFull, kpis, day, range])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(k); setSortDir("asc") }
  }

  function exportExcel() {
    if (!selectedDay || histFull.length === 0) return
    const wb = buildExcelWorkbook(histFull, kpis, day, range)
    XLSX.writeFile(wb, `BackupsHistorico_${selectedDay}.xlsx`)
  }

  const editingJob = editingJobId ? histFull.find((r) => r.jobId === editingJobId) ?? histRows.find((r) => r.jobId === editingJobId) ?? null : null
  const editingOverride = editingJob ? (config as any)?.manualOverrides?.[editingJob.jobName] : undefined

  async function saveManualOverride(jobName: string, override: ManualOverride | null) {
    const currentCfg = ((await api().getConfig()) as AppConfig | null) ?? config
    if (!currentCfg) return
    const nextOverrides = { ...((currentCfg as any).manualOverrides ?? {}) }
    if (!override) delete nextOverrides[jobName]
    else nextOverrides[jobName] = { status: normalizeManualStatusUi(override.status), timestamp: new Date().toISOString(), ...(override.comment?.trim() ? { comment: override.comment.trim() } : {}) }
    const nextCfg = { ...(currentCfg as any), manualOverrides: nextOverrides } as AppConfig
    const ok = await api().saveConfig(nextCfg)
    if (!ok) { alert("No se pudo guardar."); return }
    await onManualOverrideSaved(nextCfg)
  }

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "0 1 320px", minWidth: 280, width: "100%", maxWidth: 320 }}>
        <div style={{ marginBottom: 8, fontSize: 12, color: "#64748b", minHeight: 16 }}>
          {loadingDays ? "Cargando días..." : daysError ? <span style={{ color: "#ef4444" }}>{daysError}</span> : `${availableDays.length} días con datos`}
        </div>
        <HistoryCalendar availableDays={availableDays} selectedDay={selectedDay} onSelect={loadDay} />
      </div>

      <div style={{ flex: "1 1 640px", minWidth: 0 }}>
        {!selectedDay && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 280, color: "#475569", flexDirection: "column", gap: 14, padding: "16px 12px", textAlign: "center" }}>
            <span style={{ fontSize: 40 }}>🗓️</span>
            <span style={{ fontSize: 14, color: "#64748b" }}>Selecciona un día en el calendario</span>
          </div>
        )}

        {selectedDay && loadingDay && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200, color: "#64748b", fontSize: 13 }}>Cargando {String(selectedDay)}...</div>
        )}

        {selectedDay && dayError && (
          <div style={{ color: "#ef4444", padding: "10px 14px", background: "rgba(239,68,68,.1)", borderRadius: 6, border: "1px solid rgba(239,68,68,.3)", marginBottom: 12 }}>{dayError}</div>
        )}

        {selectedDay && !loadingDay && !dayError && histFull.length > 0 && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>{String(day)}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{String(range)}</div>
            </div>

            <div className="kpis" style={{ marginBottom: 14 }}>
              <Kpi label="Jobs" value={kpis.total} />
              <Kpi label="Éxitos" value={kpis.success} />
              <Kpi label="Avisos" value={kpis.warning} />
              <Kpi label="Errores" value={kpis.failed} />
              <Kpi label="En curso / Pend." value={kpis.running + kpis.pending} />
            </div>

            <div className="toolbar" style={{ marginBottom: 10 }}>
              <input placeholder="Buscar job" value={filter} onChange={(e) => setFilter(e.target.value)} className="search-input" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="status-select">
                <option value="all">Todos</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="failed">Failed</option>
              </select>
              <div className="flex-spacer" />
              <button onClick={handleExportScheduleExcel} style={{ background: "#1e3a5f", color: "#f1f5f9", border: "1px solid #60a5fa", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>Planificador</button>
              <button onClick={() => setEmailModal(true)} style={{ background: "#059669", color: "white", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>Enviar</button>
              <button onClick={exportExcel} style={{ background: "#2563eb", color: "white" }}>Exportar</button>
            </div>

            <JobTable rows={filtered} onEditComment={setEditingJobId} onOpenExecutions={onOpenExecutions} onOpenLog={(jobName) => { const row = histFull.find((r) => r.jobName === jobName); setLogModalData({ jobName, content: (row as any)?.as400LogContent ?? null }) }} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
          </>
        )}
      </div>

      {editingJobId && editingJob && (
        <CommentEditor jobName={editingJob.jobName} currentComment={editingOverride?.comment ?? ""}
          currentStatus={editingOverride?.status ?? normalizeManualStatusUi(editingJob.status)}
          autoReason={editingJob.reason ?? ""} onSave={saveManualOverride} onClose={() => setEditingJobId(null)} />
      )}

      {emailModal && <EmailModal htmlPreview={emailPreviewHtml} day={day} onClose={() => setEmailModal(false)} />}
      {logModalData && (
        <div className="email-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setLogModalData(null) }} style={{ zIndex: 9999 }}>
          <div className="email-modal-panel" style={{ maxWidth: 900 }}>
            <div className="email-modal-header">
              <h2>LOG AS/400 - {String(logModalData?.jobName || 'Desconocido')}</h2>
              <button className="email-modal-close" onClick={() => setLogModalData(null)}>×</button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto', maxHeight: '65vh' }}>
              <pre style={{ background: '#000', color: '#0f0', padding: 16, borderRadius: 6, fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {logModalData?.content ? String(logModalData.content) : 'No hay contenido o no se pudo extraer.'}
              </pre>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}