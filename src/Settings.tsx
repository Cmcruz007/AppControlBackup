import { api } from "./utils/api"
import { useEffect, useState } from 'react'
import type { AppConfig, GraphConfig, SqlConfig } from './types'

const DEFAULT_SQL: SqlConfig = {
  host: 'SQLCRMCLU',
  instance: '',
  port: 1433,
  database: 'VeeamBackup',
  user: '',
  password: '',
  encrypt: true,
  trustServerCertificate: true,
}

const DEFAULT_GRAPH: GraphConfig = {
  tenantId: '',
  clientId: '',
  clientSecret: '',
  mailbox: 'backup@uci.com',
  fromFilter: 'veeambackup@uci.com',
  sinceHours: 36,
}

export default function Settings({
  config,
  onSaved,
}: {
  config: AppConfig | null
  onSaved: (cfg: AppConfig) => void | Promise<void>
}) {
  const [sql, setSql] = useState<SqlConfig>(DEFAULT_SQL)
  const [graph, setGraph] = useState<GraphConfig>(DEFAULT_GRAPH)
  const [refreshMinutes, setRefreshMinutes] = useState<number>(5)
  const [toleranceMinutes, setToleranceMinutes] = useState<number>(60)
  const [pin, setPin] = useState<string>('')

  const [sqlTest, setSqlTest] = useState<string | null>(null)
  const [graphTest, setGraphTest] = useState<string | null>(null)
  const [sqlOk, setSqlOk] = useState<boolean | null>(null)
  const [graphOk, setGraphOk] = useState<boolean | null>(null)
  const [discovery, setDiscovery] = useState<string>('')

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSql({ ...DEFAULT_SQL, ...(config?.sql ?? {}) })
    setGraph({ ...DEFAULT_GRAPH, ...(config?.graph ?? {}) })
    setRefreshMinutes(config?.refreshMinutes ?? 5)
    setToleranceMinutes(config?.toleranceMinutes ?? 60)
    setPin(config?.pin ?? '')
  }, [config])

  async function doTestSql() {
    setSqlTest('Probando conexión SQL...')
    setSqlOk(null)

    try {
      const r = await api().testSql(sql)
      setSqlOk(!!r?.ok)
      setSqlTest(r?.ok ? 'Conexión SQL correcta.' : `Error: ${r?.error ?? 'sin detalle'}`)
    } catch (e: any) {
      setSqlOk(false)
      setSqlTest(`Error: ${e.message}`)
    }
  }

  async function doTestGraph() {
    setGraphTest('Probando Microsoft Graph...')
    setGraphOk(null)

    try {
      const r = await api().testGraph(graph)
      setGraphOk(!!r?.ok)
      setGraphTest(
        r?.ok
          ? `Conexión Graph correcta. Buzón: ${graph.mailbox || '(sin buzón)'}`
          : `Error: ${r?.error ?? 'sin detalle'}`
      )
    } catch (e: any) {
      setGraphOk(false)
      setGraphTest(`Error: ${e.message}`)
    }
  }

  async function doListDatabases() {
    setDiscovery('Listando bases de datos...')

    try {
      const r = await api().listDatabases(sql)
      if (!r?.ok) {
        setDiscovery(`Error: ${r?.error ?? 'No se pudieron listar las bases de datos.'}`)
        return
      }

      const dbs = Array.isArray(r?.databases) ? r.databases : []
      setDiscovery(`BASES DE DATOS DISPONIBLES:\n${dbs.join('\n')}`)
    } catch (e: any) {
      setDiscovery(`Error: ${e.message}`)
    }
  }

  async function doListTables() {
    setDiscovery(`Listando tablas en "${sql.database}"...`)

    try {
      const r = await api().listTables(sql)
      if (!r?.ok) {
        setDiscovery(`Error: ${r?.error ?? 'No se pudieron listar las tablas.'}`)
        return
      }

      const info = r?.info

      if (Array.isArray(info)) {
        const lines = info.map((t: any) => {
          if (typeof t === 'string') return t
          return t?.full || t?.TABLE_NAME || t?.name || JSON.stringify(t)
        })
        setDiscovery(`TABLAS/VISTAS DISPONIBLES EN ${sql.database}:\n\n${lines.join('\n')}`)
        return
      }

      if (info && typeof info === 'object') {
        let txt = `BD: ${info.database ?? sql.database}  |  Total tablas/vistas: ${info.total ?? '-'}\n\n`

        if (Array.isArray(info.relevant) && info.relevant.length) {
          txt += '=== TABLAS RELEVANTES (job/session/backup/schedule) CON SUS COLUMNAS ===\n\n'
          for (const t of info.relevant) {
            txt += `[${t.schema ?? 'dbo'}].[${t.name ?? '?'}]  (${t.type ?? '?'})\n`
            for (const c of t.columns ?? []) txt += `   - ${c.name}: ${c.type}\n`
            txt += '\n'
          }
        }

        if (Array.isArray(info.all) && info.all.length) {
          txt += '=== TODAS LAS TABLAS/VISTAS ===\n'
          for (const t of info.all) {
            txt += `${t.full ?? `${t.schema ?? 'dbo'}.${t.name ?? '?'}`} (${t.type ?? '?'})\n`
          }
        }

        setDiscovery(txt)
        return
      }

      setDiscovery('No se recibió información utilizable del descubrimiento.')
    } catch (e: any) {
      setDiscovery(`Error: ${e.message}`)
    }
  }

  async function save() {
    setSaving(true)

    try {
      const nextCfg: AppConfig = {
        ...(config ?? {}),
        sql: {
          ...sql,
          host: sql.host.trim(),
          instance: (sql.instance ?? '').trim(),
          port: Number(sql.port) || 1433,
          database: sql.database.trim(),
          user: sql.user.trim(),
          password: sql.password,
          encrypt: !!sql.encrypt,
          trustServerCertificate: !!sql.trustServerCertificate,
        },
        graph: {
          ...graph,
          tenantId: graph.tenantId.trim(),
          clientId: graph.clientId.trim(),
          clientSecret: graph.clientSecret,
          mailbox: graph.mailbox.trim(),
          fromFilter: (graph.fromFilter ?? '').trim(),
          sinceHours: Math.max(1, Number(graph.sinceHours) || 36),
        },
        refreshMinutes: Math.max(1, Number(refreshMinutes) || 5),
        toleranceMinutes: Math.max(0, Number(toleranceMinutes) || 0),
        pin: pin.trim() || undefined,
      }

      const ok = await api().saveConfig(nextCfg)
      if (!ok) {
        alert('No se pudieron guardar los ajustes.')
        return
      }

      await onSaved(nextCfg)
    } catch (e: any) {
      alert(`Error al guardar: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="section">
        <h2>SQL Server (solo lectura) — VeeamBackup</h2>

        <div className="form-grid">
          <label>Host</label>
          <input
            value={sql.host}
            onChange={(e) => setSql((prev) => ({ ...prev, host: e.target.value }))}
          />

          <label>Instancia (opcional)</label>
          <input
            value={sql.instance || ''}
            onChange={(e) => setSql((prev) => ({ ...prev, instance: e.target.value }))}
          />

          <label>Puerto</label>
          <input
            type="number"
            value={sql.port || 1433}
            onChange={(e) => setSql((prev) => ({ ...prev, port: Number(e.target.value) }))}
          />

          <label>Base de datos</label>
          <input
            value={sql.database || 'VeeamBackup'}
            onChange={(e) => setSql((prev) => ({ ...prev, database: e.target.value }))}
          />

          <label>Usuario</label>
          <input
            value={sql.user}
            onChange={(e) => setSql((prev) => ({ ...prev, user: e.target.value }))}
            placeholder="usuario  o  DOMINIO\\usuario"
          />

          <label>Contraseña</label>
          <input
            type="password"
            value={sql.password}
            onChange={(e) => setSql((prev) => ({ ...prev, password: e.target.value }))}
          />

          <label>Cifrar conexión</label>
          <select
            value={String(sql.encrypt)}
            onChange={(e) => setSql((prev) => ({ ...prev, encrypt: e.target.value === 'true' }))}
          >
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>

          <label>Confiar en certificado del servidor</label>
          <select
            value={String(sql.trustServerCertificate)}
            onChange={(e) =>
              setSql((prev) => ({ ...prev, trustServerCertificate: e.target.value === 'true' }))
            }
          >
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="secondary" onClick={doTestSql}>
            Probar conexión SQL
          </button>
          <button className="secondary" onClick={doListDatabases}>
            📋 Listar bases de datos
          </button>
          <button className="secondary" onClick={doListTables}>
            🔍 Listar tablas
          </button>
        </div>

        {sqlTest && (
          <div
            className={`test-result ${sqlOk === null ? '' : sqlOk ? 'ok' : 'err'}`}
            style={{ marginTop: 8 }}
          >
            {sqlTest}
          </div>
        )}

        {discovery && (
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>
              Resultado del descubrimiento:
            </label>
            <textarea
              readOnly
              value={discovery}
              style={{
                width: '100%',
                height: 280,
                marginTop: 4,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            />
          </div>
        )}

        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10 }}>
          ℹ Usuario: <code>usuario</code> = autenticación SQL Server. <code>DOMINIO\\usuario</code>{' '}
          o <code>usuario@dominio</code> = autenticación Windows/NTLM según la configuración del
          backend.
        </p>
      </div>

      <div className="section">
        <h2>Microsoft 365 — Microsoft Graph</h2>

        <div className="form-grid">
          <label>Tenant ID</label>
          <input
            value={graph.tenantId}
            onChange={(e) => setGraph((prev) => ({ ...prev, tenantId: e.target.value }))}
            placeholder="00000000-0000-0000-0000-000000000000"
          />

          <label>Client ID (Application ID)</label>
          <input
            value={graph.clientId}
            onChange={(e) => setGraph((prev) => ({ ...prev, clientId: e.target.value }))}
            placeholder="00000000-0000-0000-0000-000000000000"
          />

          <label>Client Secret</label>
          <input
            type="password"
            value={graph.clientSecret}
            onChange={(e) => setGraph((prev) => ({ ...prev, clientSecret: e.target.value }))}
            placeholder="Valor del secret (no el ID)"
          />

          <label>Buzón (UPN)</label>
          <input
            value={graph.mailbox}
            onChange={(e) => setGraph((prev) => ({ ...prev, mailbox: e.target.value }))}
            placeholder="backup@uci.com"
          />

          <label>Filtro remitente</label>
          <input
            value={graph.fromFilter || ''}
            onChange={(e) => setGraph((prev) => ({ ...prev, fromFilter: e.target.value }))}
            placeholder="veeambackup@uci.com"
          />

          <label>Ventana lectura (horas)</label>
          <input
            type="number"
            min={1}
            value={graph.sinceHours || 36}
            onChange={(e) => setGraph((prev) => ({ ...prev, sinceHours: Number(e.target.value) }))}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="secondary" onClick={doTestGraph}>
            Probar Microsoft Graph
          </button>

          {graphTest && (
            <div className={`test-result ${graphOk === null ? '' : graphOk ? 'ok' : 'err'}`}>
              {graphTest}
            </div>
          )}
        </div>

        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
          <strong>Requisitos en Entra ID</strong>
          <ol style={{ marginTop: 6 }}>
            <li>App Registration → copia Tenant ID y Client ID.</li>
            <li>
              Certificates &amp; secrets → New client secret → pega aquí el <em>Value</em>.
            </li>
            <li>
              API permissions → Microsoft Graph → <strong>Application permissions</strong> →{' '}
              <code>Mail.Read</code> y, si vas a enviar informes desde la app, también{' '}
              <code>Mail.Send</code>.
            </li>
            <li>Grant admin consent para los permisos anteriores.</li>
            <li>
              (Recomendado) Application Access Policy en Exchange Online para limitar el AppId al
              buzón <code>{graph.mailbox || 'backup@uci.com'}</code>.
            </li>
          </ol>
          La app usa Graph para leer correos y también para enviar el informe HTML.
        </div>
      </div>

      <div className="section">
        <h2>General</h2>

        <div className="form-grid">
          <label>Auto-refresco (minutos)</label>
          <input
            type="number"
            min={1}
            value={refreshMinutes}
            onChange={(e) => setRefreshMinutes(Number(e.target.value))}
          />

          <label>Tolerancia "Sin correo" (minutos)</label>
          <input
            type="number"
            min={0}
            value={toleranceMinutes}
            onChange={(e) => setToleranceMinutes(Number(e.target.value))}
          />

          <label>PIN para abrir Configuración (opcional)</label>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Vacío = sin PIN"
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={saving}>
          {saving ? 'Guardando...' : '💾 Guardar ajustes'}
        </button>
      </div>
    </>
  )
}