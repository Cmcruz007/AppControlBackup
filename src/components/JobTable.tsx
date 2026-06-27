import type { JobRow } from "../types/ui"
import type { SortKey, SortDir } from "../types/ui"
import { SourceIcon } from "./Icons"

export default function JobTable({
  rows, onEditComment, onOpenExecutions, onOpenLog, sortKey, sortDir, onSort, readOnly,
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
  const canShowBackupLogIcon = (r: any) => {
    const jobName = String(r?.jobName ?? r?.name ?? "").toLowerCase()
    const source = String(r?.source ?? r?.type ?? "").toLowerCase()
    const reason = String(r?.reason ?? "").toLowerCase()

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
    <table className="compact-table">
      <thead>
        <tr>
          <th className="sortable" onClick={() => onSort("jobName")}>
            Job {sortKey === "jobName" ? (sortDir === "asc" ? "▲" : "▼") : ""}
          </th>
          <th className="sortable" onClick={() => onSort("status")}>
            Estado {sortKey === "status" ? (sortDir === "asc" ? "▲" : "▼") : ""}
          </th>
          <th className="sortable" onClick={() => onSort("source")}>
            Fuente {sortKey === "source" ? (sortDir === "asc" ? "▲" : "▼") : ""}
          </th>
          <th className="sortable" onClick={() => onSort("nextRun")}>
            Inicio {sortKey === "nextRun" ? (sortDir === "asc" ? "▲" : "▼") : ""}
          </th>
          <th>Duración</th>
          <th className="sortable" onClick={() => onSort("reason")}>
            Detalle {sortKey === "reason" ? (sortDir === "asc" ? "▲" : "▼") : ""}
          </th>
          {!readOnly && <th>Acción</th>}
        </tr>
      </thead>

      <tbody>
        {rows.map((r) => {
          const displayStatus = r.status
          const displayReason = r.reason ?? ""
          const rowClass = `compact-row row-${displayStatus}`

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
                <span className={`badge ${displayStatus}`}>
                  {displayStatus === "success"
                    ? "SUCCESS"
                    : displayStatus === "warning"
                      ? "WARNING"
                      : displayStatus === "failed"
                        ? "ERROR"
                        : displayStatus === "running"
                          ? "RUNNING"
                          : displayStatus === "pending"
                            ? "PENDING"
                            : String(displayStatus).toUpperCase()}
                </span>
              </td>

              <td style={{ textAlign: "center" }}>
                <SourceIcon source={r.source} />
              </td>

              <td className="tabular" style={{ width: 180, minWidth: 180, whiteSpace: "nowrap" }}>
                {(() => {
                  const val = r.nextRun ?? r.startTime
                  if (!val) return "—"

                  const d = new Date(val)

                  return isNaN(d.getTime())
                    ? String(val)
                    : d.toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                })()}
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
                </div>
              </td>

              <td>{displayReason}</td>

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
  )
}