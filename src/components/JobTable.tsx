import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import type { JobRow } from "../types/ui"
import type { SortKey, SortDir } from "../types/ui"
import { SourceIcon } from "./Icons"

function getDisplayState(row: any): string {
  const raw = String(row?.globalState || row?.status || row?.state || "").trim().toUpperCase()

  if (raw === "WARN") return "WARNING"
  if (raw === "FAILED" || raw === "FAILURE") return "ERROR"
  if (raw === "NO_RUN" || raw === "NORUN") return "NO-RUN"

  // B-2: pending técnico se muestra como EN CURSO.
  if (raw === "PENDING") return "RUNNING"

  return raw
}

function getVisibleStatus(row: any): string {
  const state = getDisplayState(row)

  if (state === "SUCCESS") return "SUCCESS"
  if (state === "WARNING") return "WARNING"
  if (state === "ERROR") return "ERROR"

  // B-2
  if (state === "RUNNING") return "EN CURSO"

  if (state === "NO-RUN") return "SIN EJECUCIÓN"

  return state || "-"
}

function getStatusClass(row: any): string {
  const state = getDisplayState(row)

  if (state === "SUCCESS") return "success"
  if (state === "WARNING") return "warning"
  if (state === "ERROR") return "failed"

  // Mantenemos clase running para aprovechar estilos existentes.
  if (state === "RUNNING") return "running"

  if (state === "NO-RUN") return "no-run"

  return "unknown"
}

function getVisibleDetail(row: any): string {
  return String(row?.detail || row?.reason || "")
}

function formatDateTime(value: unknown): string {
  if (!value) return "—"
  const date = new Date(String(value))
  if (isNaN(date.getTime())) return String(value)
  return date.toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

// --- Columnas redimensionables (Directorio de Jobs / Dashboard) ---------
// El ancho de cada columna se puede arrastrar desde el borde derecho de la
// cabecera y se recuerda entre sesiones en localStorage (por navegador).
type ResizableColumnKey =
  | "jobName"
  | "status"
  | "source"
  | "nextRun"
  | "endTime"
  | "duration"
  | "reason"
  | "accion"

const COLUMN_WIDTHS_STORAGE_KEY = "bm.jobTable.columnWidths.v1"

const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnKey, number> = {
  jobName: 320,
  status: 110,
  source: 90,
  nextRun: 190,
  endTime: 190,
  duration: 130,
  reason: 280,
  accion: 175,
}

const MIN_COLUMN_WIDTHS: Record<ResizableColumnKey, number> = {
  jobName: 160,
  status: 90,
  source: 70,
  nextRun: 140,
  endTime: 140,
  duration: 90,
  reason: 140,
  accion: 130,
}

function loadStoredColumnWidths(): Partial<Record<ResizableColumnKey, number>> {
  try {
    const raw = window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed

    return {}
  } catch {
    return {}
  }
}

function persistColumnWidths(widths: Record<ResizableColumnKey, number>) {
  try {
    window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // localStorage no disponible (modo privado, cuota, etc.): no persistimos,
    // pero no rompemos la UI por ello.
  }
}

export default function JobTable({
  rows,
  onEditComment,
  onOpenExecutions,
  onOpenLog,
  sortKey,
  sortDir,
  onSort,
  readOnly,
}: {
  rows: JobRow[]
  onEditComment?: (id: string) => void
  onOpenExecutions?: (jobName: string) => void
  onOpenLog?: (jobName: string) => void
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  readOnly?: boolean
}) {
  const [columnWidths, setColumnWidths] = useState<Record<ResizableColumnKey, number>>(() => ({
    ...DEFAULT_COLUMN_WIDTHS,
    ...loadStoredColumnWidths(),
  }))

  const resizingRef = useRef<{ col: ResizableColumnKey; startX: number; startWidth: number } | null>(null)

  const handleResizeMove = useCallback((e: MouseEvent) => {
    const resizing = resizingRef.current
    if (!resizing) return

    const delta = e.clientX - resizing.startX
    const minWidth = MIN_COLUMN_WIDTHS[resizing.col]
    const nextWidth = Math.max(minWidth, Math.round(resizing.startWidth + delta))

    setColumnWidths((prev) => {
      if (prev[resizing.col] === nextWidth) return prev
      return { ...prev, [resizing.col]: nextWidth }
    })
  }, [])

  const handleResizeEnd = useCallback(() => {
    if (!resizingRef.current) return

    resizingRef.current = null
    window.removeEventListener("mousemove", handleResizeMove)
    window.removeEventListener("mouseup", handleResizeEnd)

    setColumnWidths((current) => {
      persistColumnWidths(current)
      return current
    })
  }, [handleResizeMove])

  const startResize = useCallback(
    (col: ResizableColumnKey) => (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      resizingRef.current = { col, startX: e.clientX, startWidth: columnWidths[col] }

      window.addEventListener("mousemove", handleResizeMove)
      window.addEventListener("mouseup", handleResizeEnd)
    },
    [columnWidths, handleResizeMove, handleResizeEnd]
  )

  const resetColumnWidth = useCallback(
    (col: ResizableColumnKey) => (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      setColumnWidths((prev) => {
        const next = { ...prev, [col]: DEFAULT_COLUMN_WIDTHS[col] }
        persistColumnWidths(next)
        return next
      })
    },
    []
  )

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleResizeMove)
      window.removeEventListener("mouseup", handleResizeEnd)
    }
  }, [handleResizeMove, handleResizeEnd])

  const ResizeHandle = ({ col }: { col: ResizableColumnKey }) => (
    <span
      onMouseDown={startResize(col)}
      onDoubleClick={resetColumnWidth(col)}
      onClick={(e) => e.stopPropagation()}
      title="Arrastra para cambiar el ancho · doble clic para restaurar"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 8,
        cursor: "col-resize",
        userSelect: "none",
        zIndex: 2,
        borderRight: "2px solid rgba(148, 163, 184, 0.25)",
      }}
    />
  )

  const completedRowsWithDuration = rows.filter((row) => {
    const state = getDisplayState(row)
    const durationMs = Number(row.durationMs)

    return (
      (state === "SUCCESS" || state === "WARNING" || state === "ERROR") &&
      Number.isFinite(durationMs) &&
      durationMs > 0
    )
  })

  const slowestJobIds = new Set<string>(
    completedRowsWithDuration.length >= 10
      ? [...completedRowsWithDuration]
          .sort((a, b) => Number(b.durationMs) - Number(a.durationMs))
          .slice(0, 10)
          .map((row) => row.jobId)
      : []
  )

  const canShowBackupLogIcon = (r: any) => {
    const jobName = String(r?.jobName ?? r?.name ?? "").toLowerCase()
    const source = String(r?.source ?? r?.type ?? "").toLowerCase()
    const reason = String(r?.reason ?? r?.detail ?? "").toLowerCase()

    return Boolean(
      onOpenLog &&
      (
        r?.as400LogContent ||
        r?.hasLog ||
        r?.logAvailable ||
        r?.hasEmailLog ||
        r?.emailLogAvailable ||
        r?.canOpenLog ||
        r?.logIcon ||
        source === "email" ||
        source.includes("as400") ||
        source.includes("vdc") ||
        source.includes("barracuda") ||
        reason.includes("correo recibido") ||
        reason.includes("revisar manualmente el log") ||
        jobName.includes("backup sd") ||
        jobName.includes("backup sdb") ||
        jobName.includes("sdb/tgt")
      )
    )
  }


return (
  <>
    <div className="job-table-scroll" style={{ overflowX: "auto" }}>
    <table className="compact-table desktop-job-table" style={{ tableLayout: "fixed", width: "100%" }}>
      <colgroup>
        <col style={{ width: columnWidths.jobName }} />
        <col style={{ width: columnWidths.status }} />
        <col style={{ width: columnWidths.source }} />
        <col style={{ width: columnWidths.nextRun }} />
        <col style={{ width: columnWidths.endTime }} />
        <col style={{ width: columnWidths.duration }} />
        <col style={{ width: columnWidths.reason }} />
        {!readOnly && <col style={{ width: columnWidths.accion }} />}
      </colgroup>

      <thead>
        <tr>
          <th className="sortable" onClick={() => onSort("jobName")} style={{ position: "relative" }}>
            Prioridad - Job {sortKey === "jobName" ? (sortDir === "asc" ? "▲" : "▼") : ""}
            <ResizeHandle col="jobName" />
          </th>

          <th className="sortable" onClick={() => onSort("status")} style={{ position: "relative" }}>
            Estado {sortKey === "status" ? (sortDir === "asc" ? "▲" : "▼") : ""}
            <ResizeHandle col="status" />
          </th>

          <th className="sortable" onClick={() => onSort("source")} style={{ position: "relative" }}>
            Fuente {sortKey === "source" ? (sortDir === "asc" ? "▲" : "▼") : ""}
            <ResizeHandle col="source" />
          </th>

          <th className="sortable" onClick={() => onSort("nextRun")} style={{ position: "relative" }}>
            Inicio {sortKey === "nextRun" ? (sortDir === "asc" ? "▲" : "▼") : ""}
            <ResizeHandle col="nextRun" />
          </th>

          <th className="sortable" onClick={() => onSort("endTime")} style={{ position: "relative" }}>
            Fin {sortKey === "endTime" ? (sortDir === "asc" ? "▲" : "▼") : ""}
            <ResizeHandle col="endTime" />
          </th>

          <th className="sortable" onClick={() => onSort("duration")} style={{ position: "relative" }}>
            Duración {sortKey === "duration" ? (sortDir === "asc" ? "▲" : "▼") : ""}
            <ResizeHandle col="duration" />
          </th>

          <th className="sortable" onClick={() => onSort("reason")} style={{ position: "relative" }}>
            Detalle {sortKey === "reason" ? (sortDir === "asc" ? "▲" : "▼") : ""}
            <ResizeHandle col="reason" />
          </th>

          {!readOnly && (
            <th style={{ position: "relative" }}>
              Acción
              <ResizeHandle col="accion" />
            </th>
          )}
        </tr>
      </thead>

      <tbody>
        {rows.map((r) => {
          const displayStatus = getVisibleStatus(r)
          const statusClass = getStatusClass(r)
          const displayReason = getVisibleDetail(r)
          const rowClass = `compact-row row-${statusClass}`

          return (
            <tr key={r.jobId} className={rowClass}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span
                    title={`Criticidad: ${r.criticality ?? "low"}`}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      flex: "0 0 auto",
                      background:
                        r.criticality === "high"
                          ? "#ef4444"
                          : r.criticality === "medium"
                            ? "#f59e0b"
                            : "#22c55e",
                      boxShadow: "0 0 0 1px rgba(255,255,255,.08) inset",
                    }}
                  />

                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.jobName}
                  </span>

                  {r.relaunched && (
                    <span
                      title="Relanzado"
                      style={{
                        fontSize: 10,
                        lineHeight: 1,
                        padding: "3px 6px",
                        borderRadius: 999,
                        background: "rgba(96,165,250,.14)",
                        border: "1px solid rgba(96,165,250,.35)",
                        color: "#93c5fd",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        flex: "0 0 auto",
                      }}
                    >
                      REL
                    </span>
                  )}

                  {canShowBackupLogIcon(r) && (
                    <button
                      type="button"
                      title="Ver log"
                      style={{
                        background: "none",
                        border: "none",
                        padding: "0 2px",
                        cursor: "pointer",
                        fontSize: 15,
                        lineHeight: 1,
                        flex: "0 0 auto",
                        color: "#34d399",
                        filter: "drop-shadow(0 0 3px rgba(52,211,153,.5))",
                      }}
                      onClick={() => onOpenLog?.(r.jobName)}
                    >
                      📋
                    </button>
                  )}
                </div>
              </td>

              <td>
                <span className={`badge ${statusClass}`}>
                  {displayStatus}
                </span>
              </td>

              <td style={{ textAlign: "center" }}>
                <SourceIcon source={r.source} />
              </td>

              <td className="tabular" style={{ whiteSpace: "nowrap" }}>
                {formatDateTime(r.startTime ?? r.nextRun)}
              </td>

              <td className="tabular" style={{ whiteSpace: "nowrap" }}>
                {formatDateTime(r.endTime ?? r.lastRun ?? r.endTimeDisplay)}
              </td>

              <td className="tabular">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ minWidth: "45px" }}>{r.duration ?? "—"}</span>


                  {r.durationTrend === "up" && (
                    <span
                      title="Tardó >20% más que el anterior"
                      style={{ color: "#ef4444", fontSize: 16, cursor: "help" }}
                    >
                      ▲
                    </span>
                  )}

                  {r.durationTrend === "down" && (
                    <span
                      title="Tardó >20% menos que el anterior"
                      style={{ color: "#22c55e", fontSize: 16, cursor: "help" }}
                    >
                      ▼
                    </span>
                  )}

                  {r.durationTrend === "same" && (
                    <span
                      title="Duración estable (<20%)"
                      style={{ color: "#f59e0b", fontSize: 18, fontWeight: "bold", cursor: "help" }}
                    >
                      =
                    </span>
                  )}
                  {slowestJobIds.has(r.jobId) && (
                    <span aria-label="Duración elevada">⏳</span>
                  )}
                </div>
              </td>

              <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayReason}</td>

              {!readOnly && (
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    className="secondary"
                    style={{ padding: "4px 8px", fontSize: 12, marginRight: 6 }}
                    onClick={() => onOpenExecutions?.(r.jobName)}
                  >
                    Backups
                  </button>

                  <button
                    className="secondary"
                    style={{ padding: "4px 8px", fontSize: 12 }}
                    onClick={() => onEditComment?.(r.jobId)}
                  >
                    Editar
                  </button>
                </td>
              )}
            </tr>
          )
        })}
    </tbody>
    </table>
    </div>

    <div className="mobile-job-cards">
      {rows.map((r) => {
        const displayStatus = getVisibleStatus(r)
        const statusClass = getStatusClass(r)
        const displayReason = getVisibleDetail(r)

        const startText = formatDateTime(r.startTime ?? r.nextRun)
        const endText = formatDateTime(r.endTime ?? r.lastRun ?? r.endTimeDisplay)

        return (
          <article key={r.jobId} className={`mobile-job-card row-${statusClass}`}>
            <div className="mobile-job-card-header">
              <div className="mobile-job-title-wrap">
                <span
                  title={`Criticidad: ${r.criticality ?? "low"}`}
                  className={`mobile-criticality mobile-criticality-${r.criticality ?? "low"}`}
                />

                <div className="mobile-job-title">
                  {r.jobName}
                </div>
              </div>

              <span className={`badge ${statusClass}`}>
                {displayStatus}
              </span>
            </div>

            <div className="mobile-job-meta">
              <div className="mobile-job-meta-item">
                <span className="mobile-job-meta-label">Fuente</span>
                <span className="mobile-job-meta-value">
                  <SourceIcon source={r.source} />
                </span>
              </div>

              <div className="mobile-job-meta-item">
                <span className="mobile-job-meta-label">Inicio</span>
                <span className="mobile-job-meta-value">{startText}</span>
              </div>

              <div className="mobile-job-meta-item">
                <span className="mobile-job-meta-label">Fin</span>
                <span className="mobile-job-meta-value">{endText}</span>
              </div>

              <div className="mobile-job-meta-item">
                <span className="mobile-job-meta-label">Duración</span>
                <span className="mobile-job-meta-value">
                  {r.duration ?? "—"}
                  {slowestJobIds.has(r.jobId) && " ⏳"}
                </span>
              </div>
            </div>

            {displayReason && (
              <div className="mobile-job-detail">
                {displayReason}
              </div>
            )}

            {!readOnly && (
              <div className="mobile-job-actions">
                {canShowBackupLogIcon(r) && (
                  <button
                    type="button"
                    className="secondary mobile-job-action-btn"
                    onClick={() => onOpenLog?.(r.jobName)}
                  >
                    Ver log
                  </button>
                )}

                <button
                  type="button"
                  className="secondary mobile-job-action-btn"
                  onClick={() => onEditComment?.(r.jobId)}
                >
                  Editar
                </button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  </>
)
}
