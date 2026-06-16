import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import * as XLSX from "xlsx-js-style"
import { exportScheduleExcel } from "./scheduleExcel"
import type { AppConfig, JobRowUi, CategoryFilter, Tab, SortKey, SortDir, DashboardKpiFilter, ManualOverride, JobExecutionsResponse, RefreshPayload } from "./types/ui"
import { JOB_CATEGORIES } from "./types/ui"
import { api } from "./utils/api"
import { safeLower, buildKpis, getWindowParts, statusOrder, sourceRank, normalizeManualStatusUi } from "./utils/helpers"
import { buildEmailHtml } from "./utils/emailBuilder"
import { buildExcelWorkbook } from "./utils/excelBuilder"
import { WhiteGearIcon, BackupsIcon } from "./components/Icons"
import Kpi from "./components/Kpi"
import JobTable from "./components/JobTable"
import CommentEditor from "./components/CommentEditor"
import EmailModal from "./components/EmailModal"
import ExecutionsTab from "./components/ExecutionsTab"
import ConfigurationPanel from "./components/ConfigurationPanel"
import HistoryTab from "./components/HistoryTab"

async function handleExportScheduleExcel() {
  try {
    const res = await api().getSchedule30()
    await exportScheduleExcel(async () => res as any)
  } catch (e) { alert(`Error getSchedule30: ${String(e)}`) }
}

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard")
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all')
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [rows, setRows] = useState<JobRowUi[]>([])
  const [fullRows, setFullRows] = useState<JobRowUi[]>([])
  const [showAll, setShowAll] = useState(true)
  const [lastRun, setLastRun] = useState<string | null>(null)
  const [windowStart, setWindowStart] = useState<string | null>(null)
  const [windowEnd, setWindowEnd] = useState<string | null>(null)
  const [displayWindowStart, setDisplayWindowStart] = useState<string | null>(null)
  const [displayWindowEnd, setDisplayWindowEnd] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<DashboardKpiFilter>("all")
  const [sortKey, setSortKey] = useState<SortKey>("nextRun")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [pinUnlocked, setPinUnlocked] = useState(false)
  const [pinInput, setPinInput] = useState("")
  const [emailModal, setEmailModal] = useState(false)
  const [editingJobId, setEditingJobId] = useState<string | null>(null)
  const [configPanelOpen, setConfigPanelOpen] = useState(false)
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null)
  const [executionsData, setExecutionsData] = useState<JobExecutionsResponse | null>(null)
  const [executionsLoading, setExecutionsLoading] = useState(false)
  const [executionsError, setExecutionsError] = useState<string | null>(null)
  const [dbJobs, setDbJobs] = useState<string[]>([])
  const [logModalData, setLogModalData] = useState<{ jobName: string; content: string } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const p = ((await api().refresh()) as RefreshPayload | null) ?? null
      if ((p as any)?.ok) {
        setRows(((p as any).rows ?? []) as JobRowUi[])
        setFullRows(((p as any).fullRows ?? []) as JobRowUi[])
        setLastRun((p as any).ts ?? null)
        if ((p as any).windowStart) { setWindowStart((p as any).windowStart); if (tab === "dashboard") setDisplayWindowStart((p as any).windowStart) }
        if ((p as any).windowEnd) { setWindowEnd((p as any).windowEnd); if (tab === "dashboard") setDisplayWindowEnd((p as any).windowEnd) }
      } else { setErr((p as any)?.error ?? "Error desconocido") }
    } catch (e: any) { setErr(e?.message ?? String(e)) }
    finally { setLoading(false) }
  }, [tab])

  useEffect(() => {
    if (configPanelOpen || editingJobId || emailModal || logModalData) return
    api().getConfig().then((c: AppConfig | null) => { setConfig(c); if (!(c as any)?.pin) setPinUnlocked(true) })
    api().listJobs().then((res: any) => { if (res?.ok && Array.isArray(res.jobs)) setDbJobs(res.jobs.filter(Boolean)) }).catch(console.error)
    const maybeCleanup = api().onAutoUpdate?.((p: RefreshPayload) => {
      if ((p as any)?.ok) {
        setRows(((p as any).rows ?? []) as JobRowUi[])
        setFullRows(((p as any).fullRows ?? []) as JobRowUi[])
        if ((p as any).ts) setLastRun((p as any).ts)
        if ((p as any).windowStart) setWindowStart((p as any).windowStart)
        if ((p as any).windowEnd) setWindowEnd((p as any).windowEnd)
      } else { refresh() }
    })

    // Polling para modo Express (sin IPC push)
    let pollingId: ReturnType<typeof setInterval> | null = null
    if (!api().onAutoUpdate) {
      pollingId = setInterval(() => refresh(), 5 * 60 * 1000)
    }

    refresh()

    return () => {
      if (typeof maybeCleanup === "function") maybeCleanup()
      if (pollingId) clearInterval(pollingId)
    }
  }, [refresh, configPanelOpen, editingJobId, emailModal, logModalData])

  useEffect(() => {
    if (tab === "dashboard") { setDisplayWindowStart(windowStart); setDisplayWindowEnd(windowEnd) }
  }, [tab, windowStart, windowEnd])

  const handleHistoryWindowChange = useCallback((start: string | Date | null, end: string | Date | null) => {
    setDisplayWindowStart(start instanceof Date ? start.toISOString() : start)
    setDisplayWindowEnd(end instanceof Date ? end.toISOString() : end)
  }, [])

  function unlockWithPin() {
    if (pinInput === (config as any)?.pin) setPinUnlocked(true)
    else alert("PIN incorrecto")
  }

  const allJobNames = useMemo(() => {
    const names = new Set<string>(dbJobs.filter(Boolean))
    fullRows.forEach((r) => { if (r?.jobName) names.add(r.jobName) })
    rows.forEach((r) => { if (r?.jobName) names.add(r.jobName) })
    return Array.from(names).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
  }, [dbJobs, fullRows, rows])

  const { rowsCalendario, fullRowsCalendario } = useMemo(() => {
    const ahora = new Date()
    const diaActual = ahora.getDay()
    const esFinDeSemana = diaActual === 0 || diaActual === 6
    if (!esFinDeSemana) return { rowsCalendario: rows, fullRowsCalendario: fullRows }
    const filtrarJob = (r: JobRowUi) => {
      if (!r.jobName) return true
      const name = safeLower(r.jobName)
      if (name.includes("pr") || name.includes("rr")) return false
      return true
    }
    return { rowsCalendario: rows.filter(filtrarJob), fullRowsCalendario: fullRows.filter(filtrarJob) }
  }, [rows, fullRows])

  const kpis = useMemo(() => buildKpis(fullRowsCalendario), [fullRowsCalendario])
  const { day, range } = getWindowParts(windowStart, windowEnd)
  const { day: displayDay, range: displayRange } = getWindowParts(displayWindowStart, displayWindowEnd)

  const filtered = useMemo(() => {
    let source = showAll ? fullRowsCalendario : rowsCalendario
    if (statusFilter !== "all") {
      source = source.filter((r) => {
        if (statusFilter === "running") return r.status === "running" || r.status === "pending"
        return r.status === statusFilter
      })
    } else if (activeCategory !== 'all') {
      source = source.filter(r => {
        const name = safeLower(r.jobName || "")
        if (activeCategory === 'nok') return r.status !== 'success'
        if (activeCategory === 'veeam') return (r.source === 'sql' || r.source === 'both') && !name.includes('exchange') && !name.includes('sharepoint') && !name.includes('onedrive') && !name.includes('vdc') && !name.includes('barracuda') && !name.includes('as400')
        if (activeCategory === 'vdc') return name.includes('veeam') && (name.includes('exchange') || name.includes('sharepoint') || name.includes('onedrive') || name.includes('vdc'))
        if (activeCategory === 'barracuda') return name.includes('barracuda')
        if (activeCategory === 'as400') return name.includes('as400') || (r.source === 'email' && !name.includes('barracuda') && !name.includes('veeam'))
        return true
      })
    }
    const base = source.filter((r) => { if (filter && !safeLower(r.jobName).includes(safeLower(filter))) return false; return true })
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
  }, [rowsCalendario, fullRowsCalendario, showAll, filter, statusFilter, sortKey, sortDir, activeCategory])

  const emailPreviewHtml = useMemo(() => buildEmailHtml(fullRowsCalendario, kpis, day, range), [fullRowsCalendario, kpis, day, range])

  function exportToExcel() {
    const wb = buildExcelWorkbook(fullRowsCalendario, kpis, day, range)
    XLSX.writeFile(wb, `Backups_${(day || "sin_fecha").replace(/\s+/g, "_")}.xlsx`)
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("asc") }
  }

  function handleDashboardKpiClick(next: DashboardKpiFilter) {
    setStatusFilter(next); setShowAll(true); setActiveCategory('all')
  }

  const editingJob = editingJobId ? fullRows.find((r) => r.jobId === editingJobId) ?? rows.find((r) => r.jobId === editingJobId) ?? null : null
  const editingOverride = editingJob ? (config as any)?.manualOverrides?.[editingJob.jobName] : undefined

  async function handleConfigUpdated(nextCfg: AppConfig) {
    const fresh = ((await api().getConfig()) as AppConfig | null) ?? nextCfg
    setConfig(fresh); await refresh()
  }

  async function handleManualOverrideSaved(nextCfg: AppConfig) {
    const fresh = ((await api().getConfig()) as AppConfig | null) ?? nextCfg
    setConfig(fresh); await refresh()
  }

  async function saveManualOverride(jobName: string, override: ManualOverride | null) {
    const currentCfg = ((await api().getConfig()) as AppConfig | null) ?? config
    if (!currentCfg) return
    const nextOverrides = { ...((currentCfg as any).manualOverrides ?? {}) }
    if (!override) delete nextOverrides[jobName]
    else nextOverrides[jobName] = { status: normalizeManualStatusUi(override.status), ...(override.comment?.trim() ? { comment: override.comment.trim() } : {}) }
    const nextCfg = { ...(currentCfg as any), manualOverrides: nextOverrides } as AppConfig
    const ok = await api().saveConfig(nextCfg)
    if (!ok) { alert("No se pudo guardar."); return }
    await handleManualOverrideSaved(nextCfg)
  }

  async function loadExecutions(jobName: string | null) {
    setExecutionsError(null); setExecutionsLoading(true); setExecutionsData(null)
    try {
      const res = (await api().getJobExecutions(jobName || "", 200)) as JobExecutionsResponse
      if (res?.ok) setExecutionsData(res)
      else setExecutionsError(res?.error ?? "Error al cargar")
    } catch (e: any) { setExecutionsError(e?.message ?? "Error") }
    finally { setExecutionsLoading(false) }
  }

  async function openExecutionsView(jobName?: any) {
    const targetJob = typeof jobName === "string" && jobName.trim() ? jobName.trim() : null
    setTab("executions"); setSelectedJobName(targetJob); setExecutionsError(null); setExecutionsData(null)
    if (targetJob) await loadExecutions(targetJob)
  }

  return (
    <div className="app compact-mode">
      <div className="topbar">
        <h1>Backup Monitor Pro</h1>
        <div className="meta">{lastRun ? `Actualizado ${new Date(lastRun).toLocaleTimeString("es-ES")}` : "Cargando..."}</div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>Dashboard</div>
        <div className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>Histórico</div>
        {tab !== "executions" && (
          <div className="window-title">
            <span className="window-title-main">SITUACIÓN BACKUP DEL DÍA {typeof displayDay === "string" ? displayDay : ""}</span>
            {displayRange && <span className="window-title-range">{typeof displayRange === "string" ? displayRange : ""}</span>}
          </div>
        )}
        <div className="flex-spacer" />
        <button type="button" className="tabs-config-btn" onClick={() => openExecutionsView()} title="Backups"><BackupsIcon size={20} /></button>
        <button type="button" className="tabs-config-btn white-icon" onClick={() => setConfigPanelOpen(true)} title="Configuración"><WhiteGearIcon size={20} /></button>
      </div>

      <div className="content">
        {tab === "dashboard" && (
          <>
            <div className="kpis">
              <Kpi label="Jobs hoy" value={kpis.total} accentColor="#94a3b8" active={statusFilter === "all"} onClick={() => handleDashboardKpiClick("all")} />
              <Kpi label="Éxitos" value={kpis.success} accentColor="#22c55e" active={statusFilter === "success"} onClick={() => handleDashboardKpiClick("success")} />
              <Kpi label="Avisos" value={kpis.warning} accentColor="#f59e0b" active={statusFilter === "warning"} onClick={() => handleDashboardKpiClick("warning")} />
              <Kpi label="Errores" value={kpis.failed} accentColor="#ef4444" active={statusFilter === "failed"} onClick={() => handleDashboardKpiClick("failed")} />
              <Kpi label="En curso" value={kpis.running + kpis.pending} accentColor="#60a5fa" active={statusFilter === "running"} onClick={() => handleDashboardKpiClick("running")} />
            </div>

            <div className="toolbar" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "12px" }}>
              <div style={{ display: "flex", width: "100%", alignItems: "center", gap: "10px" }}>
                <input placeholder="Buscar..." value={filter} onChange={(e) => setFilter(e.target.value)} className="search-input" />
                <div className="flex-spacer" />
                <button onClick={() => setEmailModal(true)} style={{ background: "#059669", color: "white" }}>Enviar</button>
                <button onClick={exportToExcel} disabled={fullRows.length === 0} style={{ background: "#2563eb", color: "white" }}>Exportar</button>
                <button onClick={handleExportScheduleExcel} style={{ background: "#1e3a5f", color: "#f1f5f9", border: "1px solid #60a5fa", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>Planificador</button>
                <button onClick={refresh} disabled={loading} style={{ background: loading ? "#334155" : "#475569", color: "white" }}>{loading ? "Refrescando..." : "Refrescar"}</button>
              </div>

              <div className="category-tabs" style={{ display: "flex", gap: "6px", width: "100%", padding: "4px 0" }}>
                {JOB_CATEGORIES.map(cat => {
                  const isNok = cat.id === 'nok'
                  const isActive = activeCategory === cat.id
                  let btnStyle: CSSProperties = { border: "1px solid var(--border)", padding: "6px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", transition: "all 0.15s ease" }
                  if (isNok) { btnStyle.marginLeft = "14px"; btnStyle.background = isActive ? "#e28704" : "rgba(245, 158, 11, 0.2)"; btnStyle.color = isActive ? "#ffffff" : "#f59e0b"; btnStyle.borderColor = "#f59e0b" }
                  else { btnStyle.background = isActive ? "#2563eb" : "var(--panel-2)"; btnStyle.color = isActive ? "#ffffff" : "var(--text)" }
                  return <button key={cat.id} onClick={() => { setActiveCategory(cat.id); setStatusFilter("all") }} style={btnStyle}>{cat.label}</button>
                })}
              </div>
            </div>

            {err && <span className="error-badge">{err}</span>}

            <JobTable rows={filtered} onEditComment={setEditingJobId} onOpenExecutions={openExecutionsView}
              onOpenLog={(jobName) => { const row = fullRows.find((r) => r.jobName === jobName); setLogModalData({ jobName, content: (row as any)?.as400LogContent ?? null }) }}
              sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
          </>
        )}

        {tab === "history" && (
          <HistoryTab onWindowChange={handleHistoryWindowChange} config={config}
            onManualOverrideSaved={handleManualOverrideSaved} onOpenExecutions={openExecutionsView} activeCategory={activeCategory} />
        )}

        {tab === "executions" && (
          <ExecutionsTab jobName={selectedJobName} data={executionsData} loading={executionsLoading} error={executionsError}
            allJobNames={allJobNames} onSelectJob={async (j) => { setSelectedJobName(j); await loadExecutions(j) }}
            onBack={() => { setSelectedJobName(null); setExecutionsData(null) }} activeCategory={activeCategory} />
        )}
      </div>

      <ConfigurationPanel open={configPanelOpen} onClose={() => setConfigPanelOpen(false)} config={config}
        onSaved={handleConfigUpdated} pinLocked={!pinUnlocked} pinInput={pinInput} setPinInput={setPinInput}
        onUnlock={unlockWithPin} allJobNames={allJobNames} />

      {editingJobId && editingJob && (
        <CommentEditor jobName={editingJob.jobName} currentComment={editingOverride?.comment ?? ""}
          currentStatus={editingOverride?.status ?? normalizeManualStatusUi(editingJob.status)}
          autoReason={editingJob.reason ?? ""} onSave={saveManualOverride} onClose={() => setEditingJobId(null)} />
      )}

      {emailModal && <EmailModal htmlPreview={emailPreviewHtml} day={day} onClose={() => setEmailModal(false)} />}

      {logModalData && (
        <div className="email-modal-overlay" onClick={() => setLogModalData(null)} style={{ zIndex: 9999 }}>
          <div className="email-modal-panel" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
            <div className="email-modal-header">
              <h2>LOG AS/400 - {String(logModalData?.jobName || "Desconocido")}</h2>
              <button className="email-modal-close" onClick={() => setLogModalData(null)}>×</button>
            </div>
            <div style={{ padding: 16, overflowY: "auto", maxHeight: "65vh" }}>
              <pre style={{ background: "#000", color: "#0f0", padding: 16, borderRadius: 6, fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {logModalData?.content ? String(logModalData.content) : "⚠️ No hay contenido o no se pudo extraer."}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}