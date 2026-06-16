import { useMemo, useState } from "react"
import type { JobExecutionsResponse, CategoryFilter } from "../types/ui"
import { safeLower } from "../utils/helpers"

export default function ExecutionsTab({
  jobName, data, loading, error, allJobNames, onSelectJob, onBack, activeCategory,
}: {
  jobName: string | null
  data: JobExecutionsResponse | null
  loading: boolean
  error: string | null
  allJobNames?: string[]
  onSelectJob?: (job: string) => void
  onBack?: () => void
  activeCategory: CategoryFilter
}) {
  const [filter, setFilter] = useState("")

  const filteredJobs = useMemo(() => {
    const base = allJobNames ?? []
    return base.filter(j => {
      if (filter && !safeLower(j).includes(safeLower(filter))) return false
      if (activeCategory === 'all' || activeCategory === 'nok') return true
      const name = safeLower(j)
      if (activeCategory === 'veeam') return !name.includes('barracuda') && !name.includes('as400') && !name.includes('exchange') && !name.includes('sharepoint') && !name.includes('onedrive') && !name.includes('vdc')
      if (activeCategory === 'vdc') return name.includes('veeam') && (name.includes('exchange') || name.includes('sharepoint') || name.includes('onedrive') || name.includes('vdc'))
      if (activeCategory === 'barracuda') return name.includes('barracuda')
      if (activeCategory === 'as400') return name.includes('as400')
      return true
    })
  }, [allJobNames, filter, activeCategory])

  function formatExecutionDate(value: string | null) {
    if (!value) return "—"
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return "—"
    return d.toLocaleDateString("es-ES")
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        {jobName && onBack && (
          <button className="secondary" onClick={onBack} style={{ padding: "6px 12px", fontSize: 14 }}>← Volver</button>
        )}
        <h2 style={{ margin: 0, fontSize: 20 }}>{jobName ? `Historial: ${jobName}` : "Directorio de Jobs"}</h2>
        {!jobName && (
          <span style={{ background: "rgba(99, 102, 241, 0.15)", color: "#818cf8", padding: "4px 10px", borderRadius: 20, fontSize: 13, fontWeight: 600, border: "1px solid rgba(99, 102, 241, 0.3)", marginLeft: 8 }}>
            {filteredJobs.length || 0} jobs
          </span>
        )}
      </div>

      {!jobName && (
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 860, margin: "0 auto", width: "100%" }}>
          <input placeholder="Buscar..." value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 16, padding: "10px 14px", background: "var(--panel-2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, fontSize: 14, maxWidth: 400 }} />
          <div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--panel)", overflow: "hidden" }}>
            <table className="compact-table" style={{ border: "none", margin: 0 }}>
              <tbody>
                {filteredJobs.map((j) => (
                  <tr key={j} className="compact-row" style={{ cursor: "pointer" }} onClick={() => onSelectJob?.(j)}>
                    <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 13 }}>{j}</td>
                    <td style={{ width: 40, textAlign: "center", color: "var(--muted)" }}>▶</td>
                  </tr>
                ))}
                {filteredJobs.length === 0 && (
                  <tr><td colSpan={2} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>No hay jobs</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {jobName && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {loading && <div style={{ color: "var(--muted)", padding: 20 }}>Consultando...</div>}
          {!loading && error && (
            <div style={{ color: "#fca5a5", background: "rgba(239,68,68,.10)", border: "1px solid rgba(239,68,68,.30)", borderRadius: 8, padding: 12, marginBottom: 16 }}>{error}</div>
          )}
          {!loading && !error && (
            <>
              <div style={{ marginBottom: 16, color: "var(--text)", fontSize: 13, background: "var(--panel-2)", padding: "12px 16px", borderRadius: 6, border: "1px solid var(--border)", display: "inline-block", alignSelf: "flex-start" }}>
                Total: <strong style={{ color: "var(--primary)", fontSize: 15 }}>{data?.executions?.length || 0}</strong>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                <table className="compact-table" style={{ border: "none", margin: 0 }}>
                  <thead style={{ background: "var(--panel-2)" }}>
                    <tr>
                      <th>Fecha</th>
                      <th style={{ width: 180, minWidth: 180, whiteSpace: "nowrap" }}>Inicio</th>
                      <th>Duración</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.executions ?? []).map((x: any) => (
                      <tr key={x.id} className={`compact-row row-${safeLower(x.status)}`}>
                        <td className="tabular">{formatExecutionDate(x.start)}</td>
                        <td className="tabular">{x.startDisplay ?? "—"}</td>
                        <td className="tabular">{x.duration ?? "—"}</td>
                        <td><span className={`badge ${safeLower(x.status)}`}>{String(x.status ?? "").toUpperCase()}</span></td>
                      </tr>
                    ))}
                    {(data?.executions?.length ?? 0) === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: "30px 0" }}>No hay ejecuciones.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}