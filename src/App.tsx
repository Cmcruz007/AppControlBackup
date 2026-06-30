import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import * as XLSX from "xlsx-js-style"
import TokenGate from "./components/TokenGate"
import { exportScheduleExcel } from "./scheduleExcel"
import type {
  AppConfig,
  JobRowUi,
  CategoryFilter,
  Tab,
  SortKey,
  SortDir,
  DashboardKpiFilter,
  ManualOverride,
  JobExecutionsResponse,
  RefreshPayload,
} from "./types/ui"
import { JOB_CATEGORIES } from "./types/ui"
import { api } from "./utils/api"
import {
  safeLower,
  getWindowParts,
  statusOrder,
  sourceRank,
  normalizeManualStatusUi,
} from "./utils/helpers"
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
import VersionModal from "./components/VersionModal"
import { APP_VERSION } from "./version"

async function handleExportScheduleExcel() {
  try {
    const res = await api().getSchedule30()
    await exportScheduleExcel(async () => res as any)
  } catch (e) {
    alert(`Error getSchedule30: ${String(e)}`)
  }
}

function getAs400LogColor(jobName?: string) {
  const name = String(jobName || "").toLowerCase()

  if (name.includes("backup sd") && !name.includes("sdb")) return "#00FF00"
  if (name.includes("backup pr")) return "#F01818"
  if (name.includes("backup rr")) return "#A0A000"
  if (name.includes("sdb") || name.includes("tgt")) return "#7890F0"

  return "#E5E7EB"
}

function formatBackupTitleDay(value?: string | null) {
  if (!value) return ""

  const d = new Date(value)

  if (Number.isNaN(d.getTime())) return ""

  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).toUpperCase()
}

function formatBackupWindowRange(startValue?: string | null, endValue?: string | null) {
  if (!startValue || !endValue) return ""

  const start = new Date(startValue)
  const end = new Date(endValue)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ""

  // La ventana del backend es inicio inclusivo / fin exclusivo:
  // 18:00 del día anterior -> 18:00 del día actual.
  // En UI se muestra como 18:00 -> 17:59.
  const displayEnd = new Date(end.getTime() - 60 * 1000)

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })

  return `Ventana ${fmtDate(start)}, ${fmtTime(start)} — ${fmtDate(displayEnd)}, ${fmtTime(displayEnd)}`
}

function normalizeNameForUi(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function normalizeUiState(value?: string | null) {
  return String(value || "").trim().toLowerCase()
}

function getDisplayState(row?: JobRowUi | null): string {
  const anyRow = row as any

  const raw = String(
    anyRow?.globalState ||
    anyRow?.status ||
    anyRow?.state ||
    ""
  ).trim()

  const s = raw.toUpperCase()

  if (s === "WARN") return "WARNING"
  if (s === "FAILED" || s === "FAILURE") return "ERROR"
  if (s === "NO_RUN" || s === "NORUN") return "NO-RUN"

  // B-2: PENDING técnico también se visualiza como RUNNING / EN CURSO.
  if (s === "PENDING") return "RUNNING"

  return s
}

function getDisplayStateLower(row?: JobRowUi | null): string {
  return getDisplayState(row).toLowerCase()
}

function getStateLabel(row?: JobRowUi | null): string {
  const state = getDisplayState(row)

  if (state === "SUCCESS") return "SUCCESS"
  if (state === "WARNING") return "WARNING"
  if (state === "ERROR") return "ERROR"

  // B-2
  if (state === "RUNNING") return "EN CURSO"

  if (state === "NO-RUN") return "SIN EJECUCIÓN"

  return state || "-"
}

function getStateClass(row?: JobRowUi | null): string {
  const state = getDisplayState(row)

  if (state === "SUCCESS") return "success"
  if (state === "WARNING") return "warning"
  if (state === "ERROR") return "error"

  // B-2
  if (state === "RUNNING") return "running"

  if (state === "NO-RUN") return "no-run"

  return "unknown"
}

function isNoRunRow(row?: JobRowUi | null) {
  const state = getDisplayState(row)
  const status = normalizeUiState((row as any)?.status)

  return (
    state === "NO-RUN" ||
    status === "no-run" ||
    status === "no_run" ||
    status === "norun" ||
    status === "idle"
  )
}

function isSuccessRow(row?: JobRowUi | null) {
  return getDisplayState(row) === "SUCCESS"
}

function isBackupPrRrRow(row?: JobRowUi | null) {
  const name = normalizeNameForUi(row?.jobName || "")
  return name === "backup pr" || name === "backup rr"
}

function detectIsAs400Job(source: any, fallbackName?: string | null): boolean {
  const idStr = String(source?.jobId ?? "").toLowerCase()
  const nameStr = String(source?.jobName ?? source?.name ?? fallbackName ?? "").toLowerCase()
  const srcStr = String(source?.source ?? source?.type ?? "").toLowerCase()

  if (idStr.startsWith("as400:")) return true
  if (srcStr.includes("as400")) return true
  if (/\bbackup\s+(sd|sdb|pr|rr)\b/.test(nameStr)) return true
  if (/sdb\/tgt/.test(nameStr)) return true

  return false
}

function normalizeB2Row(row: JobRowUi): JobRowUi {
  const anyRow = row as any

  const rawStatus = String(anyRow?.status || anyRow?.state || "").trim().toLowerCase()
  const globalState = String(anyRow?.globalState || "").trim().toUpperCase()
  const displayState = getDisplayState(row)

  let normalizedStatus = rawStatus

  if (displayState === "SUCCESS") normalizedStatus = "success"
  else if (displayState === "WARNING") normalizedStatus = "warning"
  else if (displayState === "ERROR") normalizedStatus = "failed"
  else if (displayState === "RUNNING") normalizedStatus = "running"
  else if (displayState === "NO-RUN") normalizedStatus = "no-run"

  const detail = String(anyRow?.detail || anyRow?.reason || "")

  return {
    ...row,
    ...(anyRow?.rawStatus ? {} : { rawStatus }),
    globalState: globalState || displayState,
    status: normalizedStatus,
    reason: detail,
    detail,
    stateLabel: getStateLabel({
      ...row,
      globalState: globalState || displayState,
      status: normalizedStatus,
    } as any),
    stateClass: getStateClass({
      ...row,
      globalState: globalState || displayState,
      status: normalizedStatus,
    } as any),
  } as any
}

function normalizeB2Rows(input: JobRowUi[] | undefined | null): JobRowUi[] {
  return (Array.isArray(input) ? input : []).map(normalizeB2Row)
}

function computeB2Kpis(inputRows: JobRowUi[]) {
  const kpis = {
    total: 0,
    success: 0,
    warning: 0,
    failed: 0,
    error: 0,
    running: 0,
    pending: 0,
  }

  for (const row of inputRows || []) {
    if (isNoRunRow(row)) continue

    const state = getDisplayState(row)

    kpis.total += 1

    if (state === "SUCCESS") kpis.success += 1
    else if (state === "WARNING") kpis.warning += 1
    else if (state === "ERROR") {
      kpis.failed += 1
      kpis.error += 1
    } else if (state === "RUNNING") {
      kpis.running += 1
    }
  }

  return kpis
}

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard")
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all")
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
  const [authGateOpen, setAuthGateOpen] = useState(false)

  const [dbJobs, setDbJobs] = useState<string[]>([])
  const [logModalData, setLogModalData] = useState<{ jobName: string; content: string | null; isAs400?: boolean } | null>(null)
  const [versionModalOpen, setVersionModalOpen] = useState(false)

  useEffect(() => {
    function handleUnauthorized() {
      setAuthGateOpen(true)
    }

    window.addEventListener("bm:unauthorized", handleUnauthorized)

    try {
      const hasToken = !!window.localStorage.getItem("bm.authToken")
      if (!hasToken) setAuthGateOpen(true)
    } catch {
      // ignorar
    }

    return () => {
      window.removeEventListener("bm:unauthorized", handleUnauthorized)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)

    try {
      const p = ((await api().refresh()) as RefreshPayload | null) ?? null

      if ((p as any)?.ok) {
        setRows(normalizeB2Rows(((p as any).rows ?? []) as JobRowUi[]))
        setFullRows(normalizeB2Rows(((p as any).fullRows ?? []) as JobRowUi[]))
        setLastRun((p as any).ts ?? null)

        if ((p as any).windowStart) {
          setWindowStart((p as any).windowStart)

          if (tab === "dashboard") {
            setDisplayWindowStart((p as any).windowStart)
          }
        }

        if ((p as any).windowEnd) {
          setWindowEnd((p as any).windowEnd)

          if (tab === "dashboard") {
            setDisplayWindowEnd((p as any).windowEnd)
          }
        }
      } else {
        setErr((p as any)?.error ?? "Error desconocido")
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [tab])

  async function reloadJobsDirectory() {
    try {
      const res = await api().listJobs()

      if (res?.ok && Array.isArray(res.jobs)) {
        setDbJobs(
          res.jobs
            .map((x: any) => {
              if (typeof x === "string") return x
              return x?.jobName || x?.name || x?.title || ""
            })
            .filter(Boolean)
        )
      }
    } catch {
      // Si falla listJobs, intentamos refrescar estado igualmente.
    }

    try {
      const p = ((await api().refresh()) as RefreshPayload | null) ?? null

      if ((p as any)?.ok) {
        setRows(normalizeB2Rows(((p as any).rows ?? []) as JobRowUi[]))
        setFullRows(normalizeB2Rows(((p as any).fullRows ?? []) as JobRowUi[]))
        setLastRun((p as any).ts ?? null)

        if ((p as any).windowStart) {
          setWindowStart((p as any).windowStart)
        }

        if ((p as any).windowEnd) {
          setWindowEnd((p as any).windowEnd)
        }
      }
    } catch {
      // No rompemos la navegación si el refresh falla puntualmente.
    }
  }

  useEffect(() => {
    if (configPanelOpen || editingJobId || emailModal || logModalData) return

    api().getConfig().then((c: AppConfig | null) => {
      setConfig(c)
      if (!(c as any)?.pin) setPinUnlocked(true)
    })

    api()
      .listJobs()
      .then((res: any) => {
        if (res?.ok && Array.isArray(res.jobs)) {
          setDbJobs(
            res.jobs
              .map((x: any) => {
                if (typeof x === "string") return x
                return x?.jobName || x?.name || x?.title || ""
              })
              .filter(Boolean)
          )
        }
      })
      .catch(console.error)

    const maybeCleanup = api().onAutoUpdate?.((p: RefreshPayload) => {
      if ((p as any)?.ok) {
        setRows(normalizeB2Rows(((p as any).rows ?? []) as JobRowUi[]))
        setFullRows(normalizeB2Rows(((p as any).fullRows ?? []) as JobRowUi[]))

        if ((p as any).ts) {
          setLastRun((p as any).ts)
        }

        if ((p as any).windowStart) {
          setWindowStart((p as any).windowStart)

          if (tab === "dashboard") {
            setDisplayWindowStart((p as any).windowStart)
          }
        }

        if ((p as any).windowEnd) {
          setWindowEnd((p as any).windowEnd)

          if (tab === "dashboard") {
            setDisplayWindowEnd((p as any).windowEnd)
          }
        }
      } else {
        refresh()
      }
    })

    let pollingId: ReturnType<typeof setInterval> | null = null

    if (!api().onAutoUpdate) {
      pollingId = setInterval(() => refresh(), 5 * 60 * 1000)
    }

    refresh()

    return () => {
      if (typeof maybeCleanup === "function") maybeCleanup()
      if (pollingId) clearInterval(pollingId)
    }
  }, [refresh, configPanelOpen, editingJobId, emailModal, logModalData, tab])

  useEffect(() => {
    if (tab === "dashboard") {
      setDisplayWindowStart(windowStart)
      setDisplayWindowEnd(windowEnd)
    }
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

    fullRows.forEach((r) => {
      if (r?.jobName) names.add(String(r.jobName))
    })

    rows.forEach((r) => {
      if (r?.jobName) names.add(String(r.jobName))
    })

    return Array.from(names).sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }))
  }, [dbJobs, fullRows, rows])

  const { fullRowsCalendario } = useMemo(() => {
    const ahora = new Date()
    const diaActual = ahora.getDay()
    const esFinDeSemana = diaActual === 0 || diaActual === 6

    if (!esFinDeSemana) {
      return { rowsCalendario: rows, fullRowsCalendario: fullRows }
    }

    const filtrarJob = (r: JobRowUi) => {
      if (!r.jobName) return true

      // Solo se excluyen los AS400 exactos Backup PR / Backup RR.
      // No se filtran genéricamente nombres SQL que contengan "pr" o "rr".
      if (isBackupPrRrRow(r)) {
        return false
      }

      return true
    }

    return {
      rowsCalendario: rows.filter(filtrarJob),
      fullRowsCalendario: fullRows.filter(filtrarJob),
    }
  }, [rows, fullRows])

  const dashboardRows = useMemo(() => {
    return fullRowsCalendario.filter((r) => !isNoRunRow(r))
  }, [fullRowsCalendario])

  const kpis = useMemo(() => computeB2Kpis(dashboardRows), [dashboardRows])

  const { day, range } = getWindowParts(windowStart, windowEnd)

  const effectiveWindowStart = displayWindowStart || windowStart
  const effectiveWindowEnd = displayWindowEnd || windowEnd

  const titleDay = formatBackupTitleDay(effectiveWindowStart)
  const titleRange = formatBackupWindowRange(effectiveWindowStart, effectiveWindowEnd)

  const isWarningRow = useCallback((r: JobRowUi) => {
    const status = safeLower((r as any).status || "")
    const reason = safeLower((r as any).reason || "")
    const detail = safeLower((r as any).detail || "")

    return (
      status === "warning" ||
      status === "warn" ||
      status.includes("warning") ||
      status.includes("warn") ||
      status.includes("aviso") ||
      reason.includes("warning") ||
      reason.includes("warn") ||
      reason.includes("aviso") ||
      detail.includes("warning") ||
      detail.includes("warn") ||
      detail.includes("aviso")
    )
  }, [])

  const isErrorRow = useCallback((r: JobRowUi) => {
    const status = safeLower((r as any).status || "")
    const reason = safeLower((r as any).reason || "")
    const detail = safeLower((r as any).detail || "")

    const hasWarningSignal =
      status.includes("warning") ||
      status.includes("warn") ||
      status.includes("aviso") ||
      reason.includes("warning") ||
      reason.includes("warn") ||
      reason.includes("aviso") ||
      detail.includes("warning") ||
      detail.includes("warn") ||
      detail.includes("aviso")

    if (hasWarningSignal) return false

    return (
      status === "error" ||
      status === "failed" ||
      status === "failure" ||
      status.includes("error") ||
      reason.includes("error") ||
      detail.includes("error")
    )
  }, [])

  const isSuccessRowCb = useCallback((r: JobRowUi) => {
    const status = safeLower((r as any).status || "")
    return status === "success" || status === "ok"
  }, [])

  const isRunningOrPendingRow = useCallback((r: JobRowUi) => {
    const status = safeLower((r as any).status || "")
    const globalStatus = safeLower((r as any).globalStatus || "")

    return (
      status === "running" ||
      status === "pending" ||
      globalStatus === "running" ||
      globalStatus === "pending"
    )
  }, [])

  const filtered = useMemo(() => {
    let source = dashboardRows

    if (activeCategory !== "all") {
      source = source.filter((r) => {
        const name = safeLower(r.jobName || "")

        if (activeCategory === "nok") {
          if (isNoRunRow(r)) return false
          return isErrorRow(r) || isWarningRow(r)
        }

        if (activeCategory === "veeam") {
          return (
            (r.source === "sql" || r.source === "both") &&
            !name.includes("exchange") &&
            !name.includes("sharepoint") &&
            !name.includes("onedrive") &&
            !name.includes("vdc") &&
            !name.includes("barracuda") &&
            !name.includes("as400")
          )
        }

        if (activeCategory === "vdc") {
          return (
            name.includes("veeam") &&
            (
              name.includes("exchange") ||
              name.includes("sharepoint") ||
              name.includes("onedrive") ||
              name.includes("vdc")
            )
          )
        }

        if (activeCategory === "barracuda") {
          return name.includes("barracuda")
        }

        if (activeCategory === "as400") {
          return (
            name.includes("as400") ||
            (r.source === "email" && !name.includes("barracuda") && !name.includes("veeam"))
          )
        }

        return true
      })
    }

    if (statusFilter !== "all") {
      source = source.filter((r) => {
        if (isNoRunRow(r)) return false

        if (statusFilter === "success") return isSuccessRowCb(r)
        if (statusFilter === "warning") return isWarningRow(r)
        if (statusFilter === "error") return isErrorRow(r)
        if (statusFilter === "failed") return isErrorRow(r)
        if (statusFilter === "running") return isRunningOrPendingRow(r)

        return true
      })
    }

    const base = source.filter((r) => {
      if (filter && !safeLower(r.jobName).includes(safeLower(filter))) return false
      return true
    })

    const dir = sortDir === "asc" ? 1 : -1

    return [...base].sort((a, b) => {
      const get = (r: JobRowUi): string | number => {
        switch (sortKey) {
          case "status":
            return statusOrder(getDisplayStateLower(r))
          case "jobName":
            return safeLower(r.jobName)
          case "nextRun":
            return r.nextRun ? new Date(r.nextRun).getTime() : 0
          case "source":
            return sourceRank(r.source)
          case "duration":
            return r.durationMs ?? -1
          case "reason":
            return safeLower((r as any).detail || r.reason)
          default:
            return 0
        }
      }

      const va = get(a)
      const vb = get(b)

      return va < vb ? -1 * dir : va > vb ? 1 * dir : 0
    })
  }, [
    dashboardRows,
    filter,
    statusFilter,
    sortKey,
    sortDir,
    activeCategory,
    isErrorRow,
    isWarningRow,
    isSuccessRowCb,
    isRunningOrPendingRow,
  ])

  const emailPreviewHtml = useMemo(
    () => buildEmailHtml(dashboardRows, kpis, day, range),
    [dashboardRows, kpis, day, range]
  )

  function exportToExcel() {
    const wb = buildExcelWorkbook(dashboardRows, kpis, day, range)
    XLSX.writeFile(wb, `Backups_${(day || "sin_fecha").replace(/\s+/g, "_")}.xlsx`)
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  function handleDashboardKpiClick(next: DashboardKpiFilter) {
    setStatusFilter(next)
    setShowAll(true)
    setActiveCategory("all")
  }

  const editingJob = editingJobId
    ? fullRows.find((r) => r.jobId === editingJobId) ?? rows.find((r) => r.jobId === editingJobId) ?? null
    : null

  const editingOverride = editingJob ? (config as any)?.manualOverrides?.[editingJob.jobName] : undefined

  async function handleConfigUpdated(nextCfg: AppConfig) {
    const fresh = ((await api().getConfig()) as AppConfig | null) ?? nextCfg
    setConfig(fresh)
    await refresh()
  }

  async function handleManualOverrideSaved(nextCfg: AppConfig) {
    const fresh = ((await api().getConfig()) as AppConfig | null) ?? nextCfg
    setConfig(fresh)
    await refresh()
  }

  async function saveManualOverride(jobName: string, override: ManualOverride | null) {
    const currentCfg = ((await api().getConfig()) as AppConfig | null) ?? config
    if (!currentCfg) return

    const nextOverrides = { ...((currentCfg as any).manualOverrides ?? {}) }

    if (!override) {
      delete nextOverrides[jobName]
    } else {
      nextOverrides[jobName] = {
        status: normalizeManualStatusUi(override.status),
        timestamp: new Date().toISOString(),
        ...(override.comment?.trim() ? { comment: override.comment.trim() } : {}),
      }
    }

    const nextCfg = { ...(currentCfg as any), manualOverrides: nextOverrides } as AppConfig
    const ok = await api().saveConfig(nextCfg)

    if (!ok) {
      alert("No se pudo guardar.")
      return
    }

    await handleManualOverrideSaved(nextCfg)
  }

  async function loadExecutions(jobName: string | null) {
    setExecutionsError(null)
    setExecutionsLoading(true)
    setExecutionsData(null)

    try {
      const res = (await api().getJobExecutions(jobName || "", 200)) as JobExecutionsResponse

      if (res?.ok) setExecutionsData(res)
      else setExecutionsError(res?.error ?? "Error al cargar")
    } catch (e: any) {
      setExecutionsError(e?.message ?? "Error")
    } finally {
      setExecutionsLoading(false)
    }
  }

  async function openExecutionsView(jobName?: any) {
    const targetJob = typeof jobName === "string" && jobName.trim() ? jobName.trim() : null

    setTab("executions")
    setSelectedJobName(targetJob)
    setExecutionsError(null)
    setExecutionsData(null)

    if (targetJob) {
      await loadExecutions(targetJob)
    } else {
      await reloadJobsDirectory()
    }
  }

  useEffect(() => {
    if (tab === "executions" && !selectedJobName && allJobNames.length === 0) {
      reloadJobsDirectory()
    }
  }, [tab, selectedJobName, allJobNames.length])

  async function openLogModal(jobName: string) {
    // Detección inicial por nombre (por si getJobExecutions tarda o falla)
    const rowFromMemory: any =
      fullRows.find((r) => r.jobName === jobName) ??
      rows.find((r) => r.jobName === jobName) ??
      null

    const initialIsAs400 = detectIsAs400Job(rowFromMemory, jobName)

    setLogModalData({
      jobName,
      content: "Cargando log...",
      isAs400: initialIsAs400,
    })

    try {
      const res = await api().getJobExecutions(jobName, 1)

      const execution = Array.isArray((res as any)?.executions)
        ? (res as any).executions[0]
        : null

      const content =
        execution?.as400LogContent ??
        execution?.logContent ??
        execution?.logText ??
        execution?.emailLog ??
        execution?.bodyContent ??
        execution?.body ??
        execution?.bodyPreview ??
        null

      const finalIsAs400 = detectIsAs400Job(execution ?? rowFromMemory, jobName)

      setLogModalData({
        jobName,
        content,
        isAs400: finalIsAs400,
      })
    } catch {
      setLogModalData({
        jobName,
        content: null,
        isAs400: initialIsAs400,
      })
    }
  }

  return (
    <>
      <div className="app compact-mode">
        <div className="topbar">
          <h1>
            Backup Monitor Pro{" "}
            <button
              className="version-badge"
              onClick={() => setVersionModalOpen(true)}
              title="Ver historial de cambios"
            >
              v{APP_VERSION}
            </button>
          </h1>

          <div className="meta">
            {lastRun ? `Actualizado ${new Date(lastRun).toLocaleTimeString("es-ES")}` : "Cargando..."}
          </div>
        </div>

        <div className="tabs">
          <div
            className={`tab ${tab === "dashboard" ? "active" : ""}`}
            onClick={() => setTab("dashboard")}
          >
            Dashboard
          </div>

          <div
            className={`tab ${tab === "history" ? "active" : ""}`}
            onClick={() => setTab("history")}
          >
            Histórico
          </div>

          {tab !== "executions" && (
            <div className="window-title">
              <span className="window-title-main">
                SITUACIÓN BACKUP DEL DÍA {titleDay}
              </span>

              {titleRange && (
                <span className="window-title-range">
                  {titleRange}
                </span>
              )}
            </div>
          )}

          <div className="flex-spacer" />

          <button
            type="button"
            className="tabs-config-btn"
            onClick={() => openExecutionsView()}
            title="Backups"
          >
            <BackupsIcon size={20} />
          </button>

          <button
            type="button"
            className="tabs-config-btn white-icon"
            onClick={() => setConfigPanelOpen(true)}
            title="Configuración"
          >
            <WhiteGearIcon size={20} />
          </button>
        </div>

        <div className="content">
          {tab === "dashboard" && (
            <>
              <div className="kpis">
                <Kpi
                  label="Jobs hoy"
                  value={kpis.total}
                  accentColor="#94a3b8"
                  active={statusFilter === "all"}
                  onClick={() => handleDashboardKpiClick("all")}
                />

                <Kpi
                  label="Éxitos"
                  value={kpis.success}
                  accentColor="#22c55e"
                  active={statusFilter === "success"}
                  onClick={() => handleDashboardKpiClick("success")}
                />

                <Kpi
                  label="Avisos"
                  value={kpis.warning}
                  accentColor="#f59e0b"
                  active={statusFilter === "warning"}
                  onClick={() => handleDashboardKpiClick("warning")}
                />

                <Kpi
                  label="Errores"
                  value={kpis.failed}
                  accentColor="#ef4444"
                  active={statusFilter === "error"}
                  onClick={() => handleDashboardKpiClick("error")}
                />

                <Kpi
                  label="En curso"
                  value={kpis.running}
                  accentColor="#60a5fa"
                  active={statusFilter === "running"}
                  onClick={() => handleDashboardKpiClick("running")}
                />
              </div>

              <div
                className="toolbar"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", width: "100%", alignItems: "center", gap: "10px" }}>
                  <input
                    placeholder="Buscar..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="search-input"
                  />

                  <div className="flex-spacer" />

                  <button onClick={() => setEmailModal(true)} style={{ background: "#059669", color: "white" }}>
                    Enviar
                  </button>

                  <button
                    onClick={exportToExcel}
                    disabled={dashboardRows.length === 0}
                    style={{ background: "#2563eb", color: "white" }}
                  >
                    Exportar
                  </button>

                  <button
                    onClick={handleExportScheduleExcel}
                    style={{
                      background: "#1e3a5f",
                      color: "#f1f5f9",
                      border: "1px solid #60a5fa",
                      borderRadius: 6,
                      padding: "7px 14px",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    Planificador
                  </button>

                  <button
                    onClick={refresh}
                    disabled={loading}
                    style={{ background: loading ? "#334155" : "#475569", color: "white" }}
                  >
                    {loading ? "Refrescando..." : "Refrescar"}
                  </button>
                </div>

                <div
                  className="category-tabs"
                  style={{
                    display: "flex",
                    gap: "6px",
                    width: "100%",
                    padding: "4px 0",
                  }}
                >
                  {JOB_CATEGORIES.map((cat) => {
                    const isNok = cat.id === "nok"
                    const isActive = activeCategory === cat.id

                    let btnStyle: CSSProperties = {
                      border: "1px solid var(--border)",
                      padding: "6px 14px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }

                    if (isNok) {
                      btnStyle.marginLeft = "14px"
                      btnStyle.background = isActive ? "#e28704" : "rgba(245, 158, 11, 0.2)"
                      btnStyle.color = isActive ? "#ffffff" : "#f59e0b"
                      btnStyle.borderColor = "#f59e0b"
                    } else {
                      btnStyle.background = isActive ? "#2563eb" : "var(--panel-2)"
                      btnStyle.color = isActive ? "#ffffff" : "var(--text)"
                    }

                    return (
                      <button
                        key={cat.id}
                        onClick={() => {
                          setActiveCategory(cat.id)
                          setStatusFilter("all")
                        }}
                        style={btnStyle}
                      >
                        {cat.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {err && <span className="error-badge">{err}</span>}

              <JobTable
                rows={filtered}
                onEditComment={setEditingJobId}
                onOpenExecutions={openExecutionsView}
                onOpenLog={openLogModal}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
              />
            </>
          )}

          {tab === "history" && (
            <HistoryTab
              onWindowChange={handleHistoryWindowChange}
              config={config}
              onManualOverrideSaved={handleManualOverrideSaved}
              onOpenExecutions={openExecutionsView}
              activeCategory={activeCategory}
            />
          )}

          {tab === "executions" && (
            <ExecutionsTab
              jobName={selectedJobName}
              data={executionsData}
              loading={executionsLoading}
              error={executionsError}
              allJobNames={allJobNames}
              onSelectJob={async (j) => {
                setSelectedJobName(j)
                await loadExecutions(j)
              }}
              onBack={async () => {
                setSelectedJobName(null)
                setExecutionsData(null)
                setExecutionsError(null)
                await reloadJobsDirectory()
              }}
              activeCategory={activeCategory}
            />
          )}
        </div>

        <ConfigurationPanel
          open={configPanelOpen}
          onClose={() => setConfigPanelOpen(false)}
          config={config}
          onSaved={handleConfigUpdated}
          pinLocked={!pinUnlocked}
          pinInput={pinInput}
          setPinInput={setPinInput}
          onUnlock={unlockWithPin}
          allJobNames={allJobNames}
        />

        {editingJobId && editingJob && (
          <CommentEditor
            jobName={editingJob.jobName}
            currentComment={editingOverride?.comment ?? ""}
            currentStatus={editingOverride?.status ?? normalizeManualStatusUi((editingJob as any).rawStatus || editingJob.status)}
            autoReason={(editingJob as any).detail || editingJob.reason || ""}
            onSave={saveManualOverride}
            onClose={() => setEditingJobId(null)}
          />
        )}

        {emailModal && (
          <EmailModal
            htmlPreview={emailPreviewHtml}
            day={day}
            onClose={() => setEmailModal(false)}
          />
        )}

        {versionModalOpen && <VersionModal onClose={() => setVersionModalOpen(false)} />}

        {logModalData && (
          <div
            className="email-modal-overlay"
            onClick={() => setLogModalData(null)}
            style={{ zIndex: 9999 }}
          >
            <div
              className="email-modal-panel"
              style={{ maxWidth: 900 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="email-modal-header">
                <h2>{logModalData?.isAs400 ? "LOG AS/400" : "LOG BACKUP"} - {String(logModalData?.jobName || "Desconocido")}</h2>

                <button
                  className="email-modal-close"
                  onClick={() => setLogModalData(null)}
                >
                  ×
                </button>
              </div>

              <div style={{ padding: 16, overflowY: "auto", maxHeight: "65vh" }}>
                <pre
                  style={{
                    margin: 0,
                    color: getAs400LogColor(logModalData?.jobName),
                    background: "#020617",
                    border: "1px solid rgba(148, 163, 184, 0.25)",
                    borderRadius: 10,
                    padding: 16,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "Consolas, 'Courier New', monospace",
                    fontSize: 13,
                    lineHeight: 1.45,
                  }}
                >
                  {logModalData?.content
                    ? String(logModalData.content)
                    : "⚠️ No hay contenido o no se pudo extraer."}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>

      <TokenGate
        open={authGateOpen}
        onClose={() => setAuthGateOpen(false)}
      />
    </>
  )
}