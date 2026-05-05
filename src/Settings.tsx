import { useEffect, useState } from "react";
import type { AppConfig, GraphConfig, SqlConfig } from "./types";

export default function Settings({ config, onSaved }: { config: AppConfig | null; onSaved: () => void }) {
  const [sql, setSql] = useState<SqlConfig>({
    host: "SQLCRMCLU",
    instance: "",
    port: 1433,
    database: "VeeamBackup",
    user: "",
    password: "",
    encrypt: true,
    trustServerCertificate: true,
  });
  const [graph, setGraph] = useState<GraphConfig>({
    tenantId: "",
    clientId: "",
    clientSecret: "",
    mailbox: "backup@uci.com",
    fromFilter: "veeambackup@uci.com",
    sinceHours: 36,
  });
  const [refreshMinutes, setRefreshMinutes] = useState<number>(5);
  const [toleranceMinutes, setToleranceMinutes] = useState<number>(60);
  const [pin, setPin] = useState<string>("");

  const [sqlTest, setSqlTest] = useState<string | null>(null);
  const [graphTest, setGraphTest] = useState<string | null>(null);
  const [sqlOk, setSqlOk] = useState<boolean | null>(null);
  const [graphOk, setGraphOk] = useState<boolean | null>(null);
  const [discovery, setDiscovery] = useState<string>("");

  useEffect(() => {
    if (config?.sql) setSql({ ...sql, ...config.sql });
    if (config?.graph) setGraph({ ...graph, ...config.graph });
    if (config?.refreshMinutes) setRefreshMinutes(config.refreshMinutes);
    if (config?.toleranceMinutes) setToleranceMinutes(config.toleranceMinutes);
    if (config?.pin) setPin(config.pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doTestSql() {
    setSqlTest("Probando...");
    setSqlOk(null);
    const r = await window.api.testSql(sql);
    setSqlOk(r.ok);
    setSqlTest(r.ok ? `Conectado. ${r.info?.db || ""}` : `Error: ${r.error}`);
  }
  async function doTestGraph() {
    setGraphTest("Probando...");
    setGraphOk(null);
    const r = await window.api.testGraph(graph);
    setGraphOk(r.ok);
    setGraphTest(r.ok
      ? `OK. Buzón ${r.info?.mailbox || graph.mailbox} accesible (${r.info?.messages ?? 0} msg recientes)`
      : `Error: ${r.error}`);
  }

  async function doListDatabases() {
    setDiscovery("Listando bases de datos...");
    const r = await window.api.listDatabases(sql);
    if (!r.ok) { setDiscovery(`Error: ${r.error}`); return; }
    setDiscovery("BASES DE DATOS DISPONIBLES:\n" + (r.databases || []).join("\n"));
  }

  async function doListTables() {
    setDiscovery(`Listando tablas en "${sql.database}"...`);
    const r = await window.api.listTables(sql);
    if (!r.ok) { setDiscovery(`Error: ${r.error}`); return; }
    const info = r.info || {};
    let txt = `BD: ${info.database}  |  Total tablas/vistas: ${info.total}\n\n`;
    txt += "=== TABLAS RELEVANTES (job/session/backup/schedule) CON SUS COLUMNAS ===\n\n";
    for (const t of info.relevant || []) {
      txt += `[${t.schema}].[${t.name}]  (${t.type})\n`;
      for (const c of t.columns || []) txt += `   - ${c.name}: ${c.type}\n`;
      txt += "\n";
    }
    txt += "=== TODAS LAS TABLAS/VISTAS ===\n";
    for (const t of info.all || []) txt += `${t.full} (${t.type})\n`;
    setDiscovery(txt);
  }

  async function save() {
    await window.api.saveConfig({ sql, graph, refreshMinutes, toleranceMinutes, pin: pin || undefined });
    onSaved();
  }

  return (
    <>
      <div className="section">
        <h2>SQL Server (solo lectura) — VeeamBackup</h2>
        <div className="form-grid">
          <label>Host</label><input value={sql.host} onChange={(e) => setSql({ ...sql, host: e.target.value })} />
          <label>Instancia (opcional)</label><input value={sql.instance || ""} onChange={(e) => setSql({ ...sql, instance: e.target.value })} />
          <label>Puerto</label><input type="number" value={sql.port || 1433} onChange={(e) => setSql({ ...sql, port: Number(e.target.value) })} />
          <label>Base de datos</label><input value={sql.database || "VeeamBackup"} onChange={(e) => setSql({ ...sql, database: e.target.value })} />
          <label>Usuario</label><input value={sql.user} onChange={(e) => setSql({ ...sql, user: e.target.value })} placeholder="usuario  o  DOMINIO\usuario" />
          <label>Contraseña</label><input type="password" value={sql.password} onChange={(e) => setSql({ ...sql, password: e.target.value })} />
          <label>Cifrar conexión</label>
          <select value={String(sql.encrypt)} onChange={(e) => setSql({ ...sql, encrypt: e.target.value === "true" })}>
            <option value="true">Sí</option><option value="false">No</option>
          </select>
          <label>Confiar en certificado del servidor</label>
          <select value={String(sql.trustServerCertificate)} onChange={(e) => setSql({ ...sql, trustServerCertificate: e.target.value === "true" })}>
            <option value="true">Sí</option><option value="false">No</option>
          </select>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="secondary" onClick={doTestSql}>Probar conexión SQL</button>
          <button className="secondary" onClick={doListDatabases}>📋 Listar bases de datos</button>
          <button className="secondary" onClick={doListTables}>🔍 Listar tablas (descubrir esquema)</button>
        </div>
        {sqlTest && <div className={`test-result ${sqlOk === null ? "" : sqlOk ? "ok" : "err"}`} style={{ marginTop: 8 }}>{sqlTest}</div>}
        {discovery && (
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              Resultado del descubrimiento (cópialo y pégalo en el chat para que mapee tu esquema exacto):
            </label>
            <textarea
              readOnly
              value={discovery}
              style={{ width: "100%", height: 280, marginTop: 4, fontFamily: "monospace", fontSize: 12 }}
            />
          </div>
        )}
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
          ℹ Usuario: <code>usuario</code> = autenticación SQL Server. <code>DOMINIO\usuario</code> o <code>usuario@dominio</code> = autenticación Windows (NTLM).
        </p>
      </div>

      <div className="section">
        <h2>Microsoft 365 — Microsoft Graph (OAuth, solo lectura)</h2>
        <div className="form-grid">
          <label>Tenant ID</label>
          <input value={graph.tenantId} onChange={(e) => setGraph({ ...graph, tenantId: e.target.value })} placeholder="00000000-0000-0000-0000-000000000000" />
          <label>Client ID (Application ID)</label>
          <input value={graph.clientId} onChange={(e) => setGraph({ ...graph, clientId: e.target.value })} placeholder="00000000-0000-0000-0000-000000000000" />
          <label>Client Secret</label>
          <input type="password" value={graph.clientSecret} onChange={(e) => setGraph({ ...graph, clientSecret: e.target.value })} placeholder="Valor del secret (no el ID)" />
          <label>Buzón (UPN)</label>
          <input value={graph.mailbox} onChange={(e) => setGraph({ ...graph, mailbox: e.target.value })} placeholder="backup@uci.com" />
          <label>Filtro remitente</label>
          <input value={graph.fromFilter || ""} onChange={(e) => setGraph({ ...graph, fromFilter: e.target.value })} placeholder="veeambackup@uci.com" />
          <label>Ventana (horas)</label>
          <input type="number" min={1} value={graph.sinceHours || 36} onChange={(e) => setGraph({ ...graph, sinceHours: Number(e.target.value) })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="secondary" onClick={doTestGraph}>Probar Microsoft Graph</button>
          {graphTest && <div className={`test-result ${graphOk === null ? "" : graphOk ? "ok" : "err"}`}>{graphTest}</div>}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
          <strong>Requisitos en Entra ID</strong>:
          <ol style={{ marginTop: 6 }}>
            <li>App Registration → copia Tenant ID y Client ID.</li>
            <li>Certificates &amp; secrets → New client secret → pega aquí el <em>Value</em>.</li>
            <li>API permissions → Microsoft Graph → <strong>Application permissions</strong> → <code>Mail.Read</code> → <strong>Grant admin consent</strong>.</li>
            <li>(Recomendado) <em>Application Access Policy</em> en Exchange Online para limitar el AppId solo al buzón <code>{graph.mailbox || "backup@uci.com"}</code>.</li>
          </ol>
          No se usa contraseña del buzón. La app nunca escribe ni envía correos.
        </div>
      </div>

      <div className="section">
        <h2>General</h2>
        <div className="form-grid">
          <label>Auto-refresco (minutos)</label>
          <input type="number" min={1} value={refreshMinutes} onChange={(e) => setRefreshMinutes(Number(e.target.value))} />
          <label>Tolerancia "Sin correo" (minutos)</label>
          <input type="number" min={0} value={toleranceMinutes} onChange={(e) => setToleranceMinutes(Number(e.target.value))} />
          <label>PIN para abrir Ajustes (opcional)</label>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Vacío = sin PIN" />
        </div>
      </div>

      <button onClick={save}>💾 Guardar ajustes</button>
    </>
  );
}
