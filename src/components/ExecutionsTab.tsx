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
  // La duración llega en dos formatos distintos segun el origen del job:
  // - AS400/Barracuda (electron/modules/graph.cjs): numero en milisegundos
  //   (durationMs), o null si no se pudo calcular.
  // - Veeam/VDC-SQL (electron/modules/sql.cjs): STRING ya formateado por
  //   formatDurationMs(), tipo "01:32:39" o "32:39" (o '' si no hay dato).
  // Antes solo se contemplaba el caso numerico (Number(ms)), por lo que
  // Number("01:32:39") daba NaN y la celda siempre mostraba "—" para TODOS
  // los jobs Veeam/VDC-SQL, aunque el dato sí existiera. Ahora se detecta el
  // tipo y se formatea cada caso, sin tocar ninguno de los dos backends.
  function formatDuration(value: any): string {
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (!trimmed) return "—"
      const parts = trimmed.split(":").map((p) => parseInt(p, 10))
      if (parts.some((p) => Number.isNaN(p))) return "—"
      let h = 0
      let m = 0
      let s = 0
      if (parts.length === 3) {
        [h, m, s] = parts
      } else if (parts.length === 2) {
        [m, s] = parts
      } else {
        return "—"
      }
      if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
      if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`
      return `${s}s`
    }
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return "—"
    const totalSeconds = Math.round(n / 1000)
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
    if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`
    return `${s}s`
  }
  // Fallback: cuando la ejecución no trae duration/durationMs (p.ej. algun
  // origen puntual sin ese campo), calculamos la duración directamente a
  // partir de start/end en vez de mostrar siempre "—".
  function computeDurationFallback(start: any, end: any): number | null {
    if (!start || !end) return null
    const s = new Date(start).getTime()
    const e = new Date(end).getTime()
    if (Number.isNaN(s) || Number.isNaN(e)) return null
    const ms = e - s
    return ms > 0 ? ms : null
  }
  function statusLabel(status: any): string {
    const s = String(status || "").toLowerCase()
    if (s === "success") return "SUCCESS"
    if (s === "warning") return "WARNING"
    if (s === "failed") return "ERROR"
    if (s === "running") return "RUNNING"
    if (s === "pending") return "PENDING"
    // FIX: nuevo estado 'missing' para ventanas operacionales de Barracuda
    // sin ningun correo recibido (ver fillMissingBarracudaWindows en
    // electron/modules/graph.cjs). Reutiliza el estilo .badge.missing ya
    // existente en styles.css (color morado, coherente con "Sin ejecución"
    // usado en el resto de la app para jobs NO-RUN).
    if (s === "missing") return "SIN EJECUCIÓN"
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
        padding: "0 32px",
      }}
    >
      <div
        className="toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          maxWidth: 760,
          margin: "0 auto 16px auto",
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
        <div style={{ color: "#9ca3af", marginBottom: 12, maxWidth: 760, margin: "0 auto 12px auto" }}>
          Cargando historial...
        </div>
      )}
      {error && (
        <div className="error-badge" style={{ marginBottom: 12, maxWidth: 760, margin: "0 auto 12px auto" }}>
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
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        {/*
          Anchos del colgroup en PORCENTAJE (no en px). Con table-layout:
          fixed, si los anchos en px suman menos que el ancho real del
          contenedor, el navegador vuelca todo el sobrante en la ULTIMA
          columna (por eso ESTADO se disparaba hacia la derecha dejando un
          hueco enorme). Usando % que suman 100%, la tabla siempre reparte
          el ancho de forma proporcional, sin sobrante que volcar. Además
          el panel ahora tiene maxWidth:760 + margin:auto, para que quede
          centrado y con márgenes iguales a ambos lados en pantallas anchas.
        */}
        <table className="compact-table" style={{ margin: 0, tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "22%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Duración</th>
              <th style={{ textAlign: "right" }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {executions.map((x: any, idx: number) => {
              // FIX: filas "missing" (ventana operacional de Barracuda sin
              // ningun correo recibido, ver fillMissingBarracudaWindows en
              // electron/modules/graph.cjs). x.start y x.end vienen null a
              // proposito; NO deben caer en el fallback "x?.start ?? dateValue"
              // (que mostraria la hora de fin de ventana, 18:00, como si
              // fuera un Inicio real). Se muestran explicitamente como "—".
              const isMissing = String(x?.status ?? "").toLowerCase() === "missing"

              const dateValue = x?.start ?? x?.end ?? x?.date ?? x?.receivedDateTime
              const status = String(x?.status ?? "pending").toLowerCase()
              const durationValue =
                x?.duration ?? x?.durationMs ?? computeDurationFallback(x?.start, x?.end)
              return (
                <tr key={x?.id ?? `${jobName}-${idx}`} className={`compact-row row-${status}`}>
                  <td>{formatDate(dateValue)}</td>
                  <td className="tabular">{isMissing ? "—" : formatTime(x?.start ?? dateValue)}</td>
                  <td className="tabular">{isMissing ? "—" : formatTime(x?.end)}</td>
                  <td className="tabular">{isMissing ? "—" : formatDuration(durationValue)}</td>
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
                <td colSpan={5} style={{ padding: 18, color: "#9ca3af", textAlign: "center" }}>
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
