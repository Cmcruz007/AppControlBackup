import { useEffect, useMemo, useState } from "react";
import type { AppConfig, JobRow, RefreshPayload } from "./types";
import Settings from "./Settings";

type Tab = "dashboard" | "settings";
type SortKey = "status" | "jobName" | "nextRun" | "email" | "duration" | "reason";
type SortDir = "asc" | "desc";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function pad2(n: number) { return String(n).padStart(2, "0"); }

function getWindowParts(windowStart: string | null | undefined, windowEnd: string | null | undefined) {
  if (!windowStart) return { day: "—", range: "" };
  const s = new Date(windowStart);
  const e = windowEnd ? new Date(windowEnd) : new Date(s.getTime() + 24 * 3600 * 1000);
  const day = `${s.getDate()} DE ${MESES[s.getMonth()].toUpperCase()} ${s.getFullYear()}`;
  const range = `Ventana: ${pad2(s.getHours())}:${pad2(s.getMinutes())} ${pad2(s.getDate())}/${pad2(s.getMonth() + 1)} → ${pad2(e.getHours())}:${pad2(e.getMinutes())} ${pad2(e.getDate())}/${pad2(e.getMonth() + 1)}`;
  return { day, range };
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
  const mm = String(totalMin % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatLocal(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [rows, setRows] = useState<JobRow[]>([]);
  const [fullRows, setFullRows] = useState<JobRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [windowEnd, setWindowEnd] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [detail, setDetail] = useState<JobRow | null>(null);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("nextRun");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Email States
  const [emailModal, setEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    window.api.getConfig().then((c) => {
      setConfig(c);
      if (!c?.pin) setPinUnlocked(true);
    });
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const p = await window.api.refresh();
      if (p.ok) {
        setRows(p.rows || []);
        setFullRows(p.fullRows || []);
        setLastRun(p.ts || null);
        if (p.windowStart) setWindowStart(p.windowStart);
        if (p.windowEnd) setWindowEnd(p.windowEnd);
      } else { setErr(p.error); }
    } catch (e: any) { setErr(e.message); }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const source = showAll ? fullRows : rows;
    const base = source.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (filter && !r.jobName.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: JobRow, b: JobRow): number => {
      const get = (r: JobRow): string | number => {
        switch (sortKey) {
          case "status": return r.status;
          case "jobName": return r.jobName.toLowerCase();
          case "nextRun": return r.nextRun ? new Date(r.nextRun).getTime() : 0;
          case "email": return r.email ? 1 : 0;
          case "duration": return r.durationMs ?? -1;
          case "reason": return r.reason.toLowerCase();
          default: return 0;
        }
      };
      const va = get(a), vb = get(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    };
    return [...base].sort(cmp);
  }, [rows, fullRows, showAll, filter, statusFilter, sortKey, sortDir]);

  const kpis = useMemo(() => {
    const k = { total: fullRows.length, success: 0, warning: 0, failed: 0, running: 0 };
    for (const r of fullRows) {
      if (r.status === "success") k.success++;
      else if (r.status === "warning") k.warning++;
      else if (r.status === "failed") k.failed++;
      else if (r.status === "running") k.running++;
    }
    return k;
  }, [fullRows]);

  const emailPreviewHtml = useMemo(() => {
    const { day } = getWindowParts(windowStart, windowEnd);
    const tableRows = filtered.map(r => `
      <tr style="border-bottom: 1px solid #ddd;">
        <td style="padding: 8px; color: ${r.status === 'failed' ? '#e11d48' : '#334155'}"><b>${r.status.toUpperCase()}</b></td>
        <td style="padding: 8px;">${r.jobName}</td>
        <td style="padding: 8px;">${formatLocal(r.nextRun)}</td>
        <td style="padding: 8px;">${formatDuration(r.durationMs)}</td>
      </tr>`).join("");

    return `
      <div style="font-family: Arial, sans-serif; max-width: 800px; padding: 20px;">
        <h2 style="color: #1e293b;">Resumen de Backups - ${day}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <thead style="background: #f1f5f9;">
            <tr>
              <th style="padding: 10px; text-align: left;">Estado</th>
              <th style="padding: 10px; text-align: left;">Job</th>
              <th style="padding: 10px; text-align: left;">Hora</th>
              <th style="padding: 10px; text-align: left;">Duración</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
  }, [filtered, windowStart, windowEnd]);

  async function handleSendEmail() {
    if (!emailTo) return alert("Indica un destinatario");
    setIsSending(true);
    const res = await window.api.sendEmail({ to: emailTo, subject: `REPORTE: ${new Date().toLocaleDateString()}`, bodyHtml: emailPreviewHtml });
    setIsSending(false);
    if (res.ok) { alert("Enviado con éxito"); setEmailModal(false); }
    else alert("Error: " + res.error);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return " ⇅";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  function rowClass(r: JobRow): string {
    if (r.status === "success") return "row-success";
    if (r.status === "warning") return "row-warning";
    if (r.status === "failed") return "row-failed";
    if (r.status === "running") return "row-running";
    return "";
  }

  return (
    <div className="app compact-mode">
      <div className="topbar">
        <h1>🛡️ Backup Monitor Pro</h1>
        <div className="meta">{lastRun ? `Actualizado: ${new Date(lastRun).toLocaleTimeString()}` : "Iniciando..."}</div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>Dashboard</div>
        <div className={`tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>Ajustes</div>
        {(() => {
          const { day, range } = getWindowParts(windowStart, windowEnd);
          return (
            <div className="window-title">
              <span className="window-title-main">SITUACIÓN BACKUP DEL DÍA {day}</span>
              {range && <span className="window-title-range">{range}</span>}
            </div>
          );
        })()}
      </div>

      <div className="content">
        {tab === "dashboard" && (
          <>
            <div className="kpis">
              <Kpi label="Jobs hoy" value={kpis.total} />
              <Kpi label="✅ Éxitos" value={kpis.success} />
              <Kpi label="⚠️ Avisos" value={kpis.warning} />
              <Kpi label="❌ Errores" value={kpis.failed} />
              <Kpi label="🏃 En curso" value={kpis.running} />
            </div>

            <div className="toolbar">
              <input placeholder="Buscar..." value={filter} onChange={(e) => setFilter(e.target.value)} className="search-input" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="status-select">
                <option value="all">Todos los estados</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="failed">Failed</option>
                <option value="running">Running</option>
              </select>

              <div className="flex-spacer" />

              <button onClick={() => setShowAll(!showAll)} className="secondary">
                {showAll ? "Ver Otros Estados" : "Mostrar todos"}
              </button>
              
              <button onClick={() => setEmailModal(true)} style={{ background: '#059669', color: 'white' }}>
                📧 Enviar
              </button>

              <button onClick={refresh} disabled={loading}>{loading ? "..." : "🔄 Refrescar"}</button>
              {err && <span className="error-badge">⚠ {err}</span>}
            </div>

            <table className="compact-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort("status")}>Estado{sortIndicator("status")}</th>
                  <th onClick={() => toggleSort("jobName")}>Job{sortIndicator("jobName")}</th>
                  <th onClick={() => toggleSort("nextRun")}>Hora{sortIndicator("nextRun")}</th>
                  <th style={{textAlign:'center'}}>Email</th>
                  <th onClick={() => toggleSort("duration")}>Dur.{sortIndicator("duration")}</th>
                  <th onClick={() => toggleSort("reason")}>Detalle{sortIndicator("reason")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>¡Todo correcto! No hay incidencias.</td></tr>
                )}
                {filtered.map(r => (
                  <tr key={r.jobId} className={`compact-row ${rowClass(r)} clickable`} onClick={() => setDetail(r)}>
                    <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                    <td className="font-small">{r.jobName}</td>
                    <td className="font-small tabular">{formatLocal(r.nextRun)}</td>
                    <td style={{ textAlign: 'center' }}>{r.email ? "✉️" : <span style={{color:'#ef4444', fontWeight:'bold'}}>✗</span>}</td>
                    <td className="font-small tabular">{formatDuration(r.durationMs)}</td>
                    <td className="font-xsmall">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === "settings" && (
          <div className="settings-wrapper">
            {config?.pin && !pinUnlocked ? (
              <div className="pin-section">
                <h2>🔒 Desbloquear Ajustes</h2>
                <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} placeholder="PIN..." />
                <button onClick={() => { if (pinInput === config.pin) setPinUnlocked(true); else alert("PIN incorrecto"); }}>Entrar</button>
              </div>
            ) : (
              <Settings config={config} onSaved={() => { window.api.getConfig().then(setConfig); alert("Guardado"); }} />
            )}
          </div>
        )}
      </div>

      {detail && (
        <div className="modal-bg" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{detail.jobName}</h2>
              <button className="close-btn" onClick={() => setDetail(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-status"><span className={`badge ${detail.status}`}>{detail.status}</span> — {detail.reason}</div>
              <div className="detail-grid" style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div><strong>Iniciado:</strong> {formatLocal(detail.nextRun)}</div>
                <div><strong>Duración:</strong> {formatDuration(detail.durationMs)}</div>
              </div>
              {detail.allEmails && detail.allEmails.length > 0 && (
                <div className="email-log" style={{ marginTop: '20px' }}>
                  <h3>Historial de correos:</h3>
                  {detail.allEmails.map((e, idx) => (
                    <div key={idx} style={{ padding: '8px', borderBottom: '1px solid #eee', fontSize: '12px' }}>
                      <span className={`badge ${e.status}`} style={{ fontSize: '10px' }}>{e.status}</span> 
                      <strong> {new Date(e.date).toLocaleTimeString()}</strong> — {e.subject}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {emailModal && (
        <div className="modal-bg">
          <div className="modal" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2>📧 Enviar Reporte</h2>
              <button className="close-btn" onClick={() => setEmailModal(false)}>×</button>
            </div>
            <div className="form-group" style={{ marginBottom: '15px' }}>
              <label>Destinatario:</label>
              <input style={{ width: '100%', padding: '10px', marginTop: '5px' }} type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="ejemplo@correo.com" />
            </div>
            <div style={{ background: 'white', padding: '15px', color: '#333', maxHeight: '400px', overflow: 'auto', border: '1px solid #ddd', borderRadius: '4px' }}>
              <div dangerouslySetInnerHTML={{ __html: emailPreviewHtml }} />
            </div>
            <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="secondary" onClick={() => setEmailModal(false)}>Cancelar</button>
              <button onClick={handleSendEmail} disabled={isSending} style={{ background: '#059669', color: 'white' }}>
                {isSending ? "Enviando..." : "Confirmar Envío"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}