import { useEffect, useMemo, useState } from "react"
import type { JobExecutionsResponse, CategoryFilter } from "../types/ui"
import { api } from "../utils/api"

export default function ExecutionsTab({
  jobName,
  data,
  loading,
  error,
  allJobNames,
  onSelectJob,
  onBack,
  activeCategory,
}: {
  jobName: string | null
  data: JobExecutionsResponse | null
  loading: boolean
  error: string | null
  allJobNames: string[]
  onSelectJob: (jobName: string) => void | Promise<void>
  onBack: () => void | Promise<void>
  activeCategory?: CategoryFilter
}) {
  const [search, setSearch] = useState("")
  const [directoryNames, setDirectoryNames] = useState<string[]>([])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState<string | null>(null)

  void activeCategory

  function normalizeJobName(value: any): string {
    if (typeof value === "string") return value.trim()

    return String(
      value?.jobName ||
      value?.name ||
      value?.title ||
      value?.JobName ||
      value?.Name ||
      value?.displayName ||
      ""
    ).trim()
  }

  function uniqueSorted(values: any[]): string[] {
    const set = new Set<string>()

    for (const value of values || []) {
      const name = normalizeJobName(value)
      if (name) set.add(name)
    }

    return Array.from(set).sort((a, b) =>
      String(a).localeCompare(String(b), "es", { sensitivity: "base" })
    )
  }

  async function reloadDirectoryInsideTab() {
    setDirectoryLoading(true)
    setDirectoryError(null)

    try {
      const collected: any[] = []

      try {
        const jobsRes = await api().listJobs()

        if ((jobsRes as any)?.ok && Array.isArray((jobsRes as any).jobs)) {
          collected.push(...(jobsRes as any).jobs)
        }
      } catch {
        // fallback con refresh
      }

      try {
        const refreshRes = await api().refresh()

        const fullRows = Array.isArray((refreshRes as any)?.fullRows)
          ? (refreshRes as any).fullRows
          : []

        const rows = Array.isArray((refreshRes as any)?.rows)
          ? (refreshRes as any).rows
          : []

        collected.push(...fullRows)
        collected.push(...rows)
      } catch {
        // si falla refresh seguimos con lo que haya de listJobs
      }

      const nextNames = uniqueSorted(collected)

      setDirectoryNames(nextNames)

      if (nextNames.length === 0) {
        setDirectoryError("No se han podido cargar jobs desde listJobs ni desde refresh.")
      }
    } catch (e: any) {
      setDirectoryError(e?.message ?? "Error cargando directorio de jobs.")
      setDirectoryNames([])
    } finally {
      setDirectoryLoading(false)
    }
  }

  useEffect(() => {
    const names = uniqueSorted(allJobNames || [])

    if (names.length > 0) {
      setDirectoryNames(names)
      setDirectoryError(null)
    }
  }, [allJobNames])

  useEffect(() => {
    if (!jobName && directoryNames.length === 0 && !directoryLoading) {
      reloadDirectoryInsideTab()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobName, directoryNames.length])

  const filteredJobNames = useMemo(() => {
    const q = search.trim().toLowerCase()

    const source = directoryNames.length > 0
      ? directoryNames
      : uniqueSorted(allJobNames || [])

    if (!q) return source

    return source.filter((name) => name.toLowerCase().includes(q))
  }, [directoryNames, allJobNames, search])

  function formatDate(value: any): string {
    if (!value) return "—"

    const d = new Date(value)

    if (Number.isNaN(d.getTime())) return String(value)

    return d.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  function formatTime(value: any): string {
    if (!value) return "—"

    const d = new Date(value)

    if (Number.isNaN(d.getTime())) return String(value)

    return d.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }

  function formatDuration(ms: any): string {
    const n = Number(ms)

    if (!Number.isFinite(n) || n <= 0) return "—"

    const totalSeconds = Math.round(n / 1000)
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60

    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
    if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`

    return `${s}s`
  }

  function statusLabel(status: any): string {
    const s = String(status || "").toLowerCase()

    if (s === "success") return "SUCCESS"
    if (s === "warning") return "WARNING"
    if (s === "failed") return "ERROR"
    if (s === "running") return "RUNNING"
    if (s === "pending") return "PENDING"

    return String(status || "—").toUpperCase()
  }

  // ─────────────────────────────────────────────────────────────
  // Directorio de jobs
  // ─────────────────────────────────────────────────────────────

  if (!jobName) {
    return (
      <div
        style={{
          background: "var(--bg)",
          color: "var(--text)",
          minHeight: "calc(100vh - 150px)",
          padding: "0 32px",
        }}
      >
        <div
          className="toolbar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "0 auto 16px auto",
            maxWidth: 860,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, color: "var(--text)" }}>
            Directorio de Jobs
          </h2>

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 12px",
              borderRadius: 999,
              background: "rgba(79,70,229,.20)",
              border: "1px solid rgba(129,140,248,.45)",
              color: "#c4b5fd",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {filteredJobNames.length} jobs
          </span>

          <div className="flex-spacer" />

          <input
            placeholder="Buscar job..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
            style={{
              width: 280,
              maxWidth: 280,
              minWidth: 220,
            }}
          />

          <button
            className="secondary"
            style={{ padding: "6px 12px", fontSize: 12 }}
            onClick={reloadDirectoryInsideTab}
            disabled={directoryLoading}
            title="Recargar directorio"
          >
            {directoryLoading ? "Cargando..." : "Recargar"}
          </button>
        </div>

        {directoryError && (
          <div className="error-badge" style={{ marginBottom: 12 }}>
            {directoryError}
          </div>
        )}

        <div
          style={{
            maxWidth: 860,
            margin: "0 auto",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 10px 30px rgba(0,0,0,.18)",
          }}
        >
          <table className="compact-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Job</th>
                <th style={{ width: 130, textAlign: "right" }}>Acción</th>
              </tr>
            </thead>

            <tbody>
              {directoryLoading && filteredJobNames.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ padding: 18, color: "#9ca3af" }}>
                    Cargando directorio de jobs...
                  </td>
                </tr>
              )}

              {!directoryLoading && filteredJobNames.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ padding: 18, color: "#9ca3af", textAlign: "center" }}>
                    No hay jobs
                  </td>
                </tr>
              )}

              {filteredJobNames.map((name) => (
                <tr key={name} className="compact-row">
                  <td
                    style={{
                      color: "var(--text)",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={name}
                  >
                    {name}
                  </td>

                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="secondary"
                      style={{
                        padding: "4px 9px",
                        fontSize: 12,
                        color: "#bfdbfe",
                      }}
                      onClick={() => onSelectJob(name)}
                    >
                      Ver histórico
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────
  // Historial de un job
  // ─────────────────────────────────────────────────────────────

  const executions = Array.isArray((data as any)?.executions)
    ? (data as any).executions
    : []

  return (
    <div
      style={{
        background: "var(--bg)",
        color: "var(--text)",
        minHeight: "calc(100vh - 150px)",
        padding: 0,
      }}
    >
      <div
        className="toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 12,
        }}
      >
        <button
          className="secondary"
          onClick={onBack}
          style={{ padding: "6px 13px", fontSize: 13 }}
        >
          ← Volver
        </button>

        <h2 style={{ margin: 0, fontSize: 20, color: "var(--text)" }}>
          Historial: {jobName}
        </h2>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 12px",
            borderRadius: 999,
            background: "rgba(79,70,229,.20)",
            border: "1px solid rgba(129,140,248,.45)",
            color: "#c4b5fd",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          Total: {executions.length}
        </span>
      </div>

      {loading && (
        <div style={{ color: "#9ca3af", marginBottom: 12 }}>
          Cargando historial...
        </div>
      )}

      {error && (
        <div className="error-badge" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 10px 30px rgba(0,0,0,.18)",
        }}
      >
        <table className="compact-table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Inicio</th>
              <th>Duración</th>
              <th style={{ textAlign: "right" }}>Estado</th>
            </tr>
          </thead>

          <tbody>
            {executions.map((x: any, idx: number) => {
              const dateValue = x?.start || x?.end || x?.date || x?.receivedDateTime
              const status = String(x?.status || "pending").toLowerCase()

              return (
                <tr key={x?.id || `${jobName}-${idx}`} className={`compact-row row-${status}`}>
                  <td>{formatDate(dateValue)}</td>
                  <td className="tabular">{formatTime(x?.start || dateValue)}</td>
                  <td className="tabular">{formatDuration(x?.duration ?? x?.durationMs)}</td>
                  <td style={{ textAlign: "right" }}>
                    <span className={`badge ${status}`}>
                      {statusLabel(status)}
                    </span>
                  </td>
                </tr>
              )
            })}

            {!loading && executions.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 18, color: "#9ca3af", textAlign: "center" }}>
                  No hay ejecuciones
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}