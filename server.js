// ─── Proxy corporativo (si aplica) ──────────────────────────────────────────
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
if (proxyUrl) {
  const { setGlobalDispatcher, ProxyAgent } = require('undici')
  setGlobalDispatcher(new ProxyAgent(proxyUrl))
  console.log('[PROXY] Configurado:', proxyUrl)
}



// server.js — Express server for BackupMonitor (production 24/7)
const express = require('express')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

// ─── Módulos backend (reutilizados del motor Electron) ──────────────────────
const { logGraphError } = require('./electron/modules/utils.cjs')
const { loadConfig, saveConfig, isElectron } = require('./electron/modules/config.cjs')
const { closeCachedSqlPool, withTempSqlPool, sqlGetSessionsInRange, sqlGetJobExecutions, sqlGetAvailableDays, sqlGetScheduleJobs, sqlListJobs } = require('./electron/modules/sql.cjs')
const { getEmails, getEmailsInRange, sendGraphEmail } = require('./electron/modules/graph.cjs')
const { parseScheduleXml, expandSchedule30, cloneEntriesWithJobName, isBackupCopyJob, findParentJobForCopy, buildPrimaryJobIndex } = require('./electron/modules/schedule.cjs')
const { getOperationalWindow, processSessions, applyManualOverride } = require('./electron/modules/engine.cjs')
const { buildVdcRows, buildBarracudaRows, buildAs400Rows } = require('./electron/modules/rules.cjs')

// ─── Configuración ──────────────────────────────────────────────────────────
const PORT = Number(process.env.BM_PORT) || 3100
const AUTH_TOKEN = process.env.BM_AUTH_TOKEN || ''

if (!AUTH_TOKEN) {
  console.warn('⚠️  BM_AUTH_TOKEN no definido. La API NO tiene autenticacion.')
  console.warn('   Define BM_AUTH_TOKEN en las variables de entorno para produccion.')
}

// ─── Estado global ──────────────────────────────────────────────────────────
let lastPayload = null
let lastRefreshTime = null
let refreshIntervalId = null

// ─── Motor de refresco (idéntico al de main.cjs) ───────────────────────────
async function buildRefreshPayloadForWindow(cfg, inicio, fin, includeSql = true) {
  const ahora = new Date()
  const overrides = cfg?.manualOverrides || {}
  const criticalityByJob = cfg?.criticalityByJob || {}

  const [emails, sessions] = await Promise.all([
    cfg?.graph?.tenantId ? getEmailsInRange(cfg, inicio, fin) : Promise.resolve([]),
    includeSql && cfg?.sql ? sqlGetSessionsInRange(cfg.sql, inicio, fin) : Promise.resolve([]),
  ])

  const { fullRows: sqlFullRows } = processSessions(sessions || [], emails || [], ahora, overrides, criticalityByJob)
  const vdcRows = buildVdcRows(cfg?.veeamDataCloudRules || [], emails || [], inicio, fin, '', criticalityByJob).map(r => applyManualOverride(r, overrides, ahora))
  const barraRows = buildBarracudaRows(cfg?.barracudaRules || [], emails || [], inicio, fin, '', criticalityByJob).map(r => applyManualOverride(r, overrides, ahora))
  const as400Rows = (await buildAs400Rows(cfg?.as400Rules || [], emails || [], inicio, fin, cfg, criticalityByJob)).map(r => applyManualOverride(r, overrides, ahora))

  const fullRows = [...sqlFullRows, ...vdcRows, ...barraRows, ...as400Rows]
    .sort((a, b) => new Date(b.nextRun).getTime() - new Date(a.nextRun).getTime())

  return {
    ok: true,
    rows: fullRows.filter((r) => r.status !== 'success'),
    fullRows,
    ts: ahora.toISOString(),
    windowStart: inicio.toISOString(),
    windowEnd: fin.toISOString(),
  }
}

async function runRefresh() {
  const cfg = loadConfig()
  const hasSql = !!cfg?.sql
  const hasGraph = !!cfg?.graph?.tenantId

  if (!hasSql && !hasGraph) {
    console.error('[REFRESH] Falta configuracion SQL o Graph.')
    return { ok: false, error: 'Falta configuracion SQL o Graph.' }
  }

  try {
    const { inicio, fin } = getOperationalWindow(new Date())
    const payload = await buildRefreshPayloadForWindow(cfg, inicio, fin, hasSql)

    lastPayload = payload
    lastRefreshTime = new Date().toISOString()

    // Exportar JSON para app movil
    try {
      const jsonPath = process.env.BM_JSON_EXPORT_PATH || 'C:\\DashboardBackups\\backup_status.json'
      const folderPath = path.dirname(jsonPath)
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true })

      const datosParaMovil = payload.fullRows.map(r => ({
        backup_policy_name: r.jobName, status: r.status, result: r.lastResult,
        creation_time: r.nextRun, end_time: r.lastRun, duration: r.duration,
        reason: r.reason, criticality: r.criticality, source: r.source,
      }))

      fs.writeFileSync(jsonPath, JSON.stringify(datosParaMovil, null, 4), 'utf8')
      fs.writeFileSync(path.join(folderPath, 'motor_status.txt'),
        `Ultimo refresco correcto: ${new Date().toLocaleString()}`, 'utf8')
    } catch (exportErr) {
      logGraphError('JSON_EXPORT_ERROR', { message: exportErr?.message || String(exportErr) })
    }

    console.log(`[REFRESH] OK — ${payload.fullRows.length} jobs, ${new Date().toLocaleTimeString()}`)
    return payload
  } catch (e) {
    logGraphError('RUN_REFRESH_ERROR', { message: e?.message || String(e) })
    console.error('[REFRESH] ERROR:', e.message)
    return { ok: false, error: e.message }
  }
}

function startRefreshTimer(minutes) {
  if (refreshIntervalId) clearInterval(refreshIntervalId)
  const ms = Math.max(1, Number(minutes ?? 5)) * 60 * 1000
  refreshIntervalId = setInterval(() => runRefresh(), ms)
  console.log(`[TIMER] Refresh cada ${Math.round(ms / 60000)} minutos`)
}

// ─── Express App ────────────────────────────────────────────────────────────
const app = express()
app.use(express.json({ limit: '2mb' }))

// Servir React SPA desde dist/
const distPath = path.join(__dirname, 'dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
} else {
  console.warn('⚠️  Carpeta dist/ no encontrada. Ejecuta "npm run build" primero.')
}

// ─── Middleware de autenticación ────────────────────────────────────────────
function authMiddleware(req, res, next) {
  // Si no hay token configurado, permitir todo (modo desarrollo)
  if (!AUTH_TOKEN) return next()

  // Permitir acceso sin token a archivos estáticos (la SPA)
  if (!req.path.startsWith('/api/')) return next()

  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query?.token || ''

  if (token === AUTH_TOKEN) return next()

  return res.status(401).json({ ok: false, error: 'No autorizado' })
}

app.use(authMiddleware)

// ─── API Endpoints ──────────────────────────────────────────────────────────

// Estado actual (lo que el dashboard consume)
app.get('/api/status', (_req, res) => {
  if (!lastPayload) return res.json({ ok: false, error: 'Aun no hay datos. Esperando primer refresh.' })
  res.json({ ...lastPayload, lastRefreshTime })
})

// Forzar refresh manual
app.post('/api/refresh', async (_req, res) => {
  try {
    const payload = await runRefresh()
    res.json(payload)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Config
app.get('/api/config', (_req, res) => {
  try {
    const cfg = loadConfig() || {}
    res.json(cfg)
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/api/config', (req, res) => {
  try {
    const ok = saveConfig(req.body || {})
    if (ok) {
      const cfg = loadConfig()
      startRefreshTimer(cfg?.refreshMinutes)
    }
    res.json({ ok })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// SQL Tests
app.post('/api/test/sql', async (req, res) => {
  try {
    await withTempSqlPool(req.body, async () => true)
    res.json({ ok: true })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

app.post('/api/test/graph', async (req, res) => {
  try {
    const emails = await getEmails({ graph: req.body })
    res.json({ ok: true, count: Array.isArray(emails) ? emails.length : 0 })
  } catch (e) {
    res.json({ ok: false, error: e?.message || String(e) })
  }
})

// SQL Explorer
app.post('/api/sql/databases', async (req, res) => {
  try {
    const databases = await withTempSqlPool(req.body, async (pool) => {
      const result = await pool.request().query('SELECT name FROM sys.databases ORDER BY name')
      return result.recordset.map((r) => r.name)
    })
    res.json({ ok: true, databases })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

app.post('/api/sql/tables', async (req, res) => {
  try {
    const info = await withTempSqlPool(req.body, async (pool) => {
      const result = await pool.request().query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME')
      return result.recordset
    })
    res.json({ ok: true, info })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

app.post('/api/sql/columns', async (req, res) => {
  try {
    const { sqlCfg, tableName } = req.body
    const mssql = require('mssql')
    const columns = await withTempSqlPool(sqlCfg, async (pool) => {
      const r = pool.request()
      r.input('tableName', mssql.NVarChar, tableName)
      const result = await r.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tableName ORDER BY ORDINAL_POSITION`)
      return result.recordset.map((row) => row.COLUMN_NAME)
    })
    res.json({ ok: true, columns })
  } catch (e) {
    res.json({ ok: false, error: e.message, columns: [] })
  }
})

// Email
app.post('/api/email/send', async (req, res) => {
  try {
    const cfg = loadConfig()
    await sendGraphEmail(cfg, req.body)
    res.json({ ok: true })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

// History
app.get('/api/history/days', async (_req, res) => {
  const cfg = loadConfig()
  if (!cfg?.sql) return res.json({ ok: false, error: 'Falta configuracion SQL.', days: [] })
  try {
    const days = await sqlGetAvailableDays(cfg.sql)
    res.json({ ok: true, days })
  } catch (e) {
    res.json({ ok: false, error: e.message, days: [] })
  }
})

app.get('/api/history/day/:dateStr', async (req, res) => {
  const cfg = loadConfig()
  if (!cfg?.sql) return res.json({ ok: false, error: 'Falta configuracion SQL.' })
  try {
    const [year, month, day] = String(req.params.dateStr || '').split('-').map(Number)
    const inicio = new Date(year, month - 1, day, 18, 0, 0, 0)
    const fin = new Date(inicio.getTime() + 86400000)
    const payload = await buildRefreshPayloadForWindow(cfg, inicio, fin, true)
    res.json({ ok: true, rows: payload.rows, fullRows: payload.fullRows, windowStart: payload.windowStart, windowEnd: payload.windowEnd })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

// Schedule
app.get('/api/schedule/30days', async (_req, res) => {
  const cfg = loadConfig()
  if (!cfg?.sql) return res.json({ ok: false, error: 'Falta configuracion SQL.', rows: [] })
  try {
    const rawJobs = await sqlGetScheduleJobs(cfg.sql)
    const jobs = (Array.isArray(rawJobs) ? rawJobs : []).filter((j) => j && typeof j === 'object' && j.name)
    const now = new Date()
    const primaryJobs = jobs.filter((j) => !isBackupCopyJob(j))
    const copyJobs = jobs.filter((j) => isBackupCopyJob(j))
    const primaryIndex = buildPrimaryJobIndex(primaryJobs)
    const primaryEntriesByName = new Map()
    const all = []
    for (const j of primaryJobs) {
      const xml = j.schedule_xml || ''
      const parsed = parseScheduleXml(xml, j.name)
      if (!parsed) continue
      const entries = expandSchedule30(j.name, xml, now)
      primaryEntriesByName.set(j.name, entries)
      all.push(...entries)
    }
    for (const copy of copyJobs) {
      const parent = findParentJobForCopy(copy, primaryJobs, primaryIndex)
      if (!parent) continue
      const inherited = cloneEntriesWithJobName(primaryEntriesByName.get(parent.name) || [], copy.name)
      if (!inherited.length) continue
      all.push(...inherited)
    }
    all.sort((a, b) => a.date.getTime() - b.date.getTime())
    res.json({ ok: true, rows: all.map((r) => ({ job: r.job, date: r.date.toISOString() })) })
  } catch (e) {
    res.json({ ok: false, error: e.message, rows: [] })
  }
})

// Jobs
app.get('/api/jobs/list', async (_req, res) => {
  const cfg = loadConfig()
  if (!cfg?.sql) return res.json({ ok: false, error: 'Falta configuracion SQL.', jobs: [] })
  try {
    const jobs = await sqlListJobs(cfg.sql)
    res.json({ ok: true, jobs })
  } catch (e) {
    res.json({ ok: false, error: e.message, jobs: [] })
  }
})

app.get('/api/jobs/executions/:jobName', async (req, res) => {
  const cfg = loadConfig()
  if (!cfg?.sql) return res.json({ ok: false, error: 'Falta configuracion SQL.', executions: [] })
  try {
    const jobName = decodeURIComponent(req.params.jobName).trim()
    const limit = Number(req.query.limit) || 200
    const data = await sqlGetJobExecutions(cfg.sql, jobName, limit)
    res.json(data)
  } catch (e) {
    res.json({ ok: false, error: e.message, executions: [] })
  }
})

app.get('/api/jobs/executions', async (_req, res) => {
  const cfg = loadConfig()
  if (!cfg?.sql) return res.json({ ok: false, error: 'Falta configuracion SQL.', executions: [] })
  try {
    const limit = Number(_req.query.limit) || 200
    const data = await sqlGetJobExecutions(cfg.sql, null, limit)
    res.json(data)
  } catch (e) {
    res.json({ ok: false, error: e.message, executions: [] })
  }
})

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    lastRefresh: lastRefreshTime,
    totalJobs: lastPayload?.fullRows?.length ?? 0,
    mode: isElectron ? 'electron' : 'express',
  })
})

// SPA fallback — todas las rutas no-API devuelven index.html
app.get('{*path}', (_req, res) => {
  const indexPath = path.join(distPath, 'index.html')
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath)
  res.status(404).send('Build no encontrado. Ejecuta: npm run build')
})

// ─── Arranque ───────────────────────────────────────────────────────────────
// HTTPS + HTTP redirect
const https = require('https')
const http = require('http')

const HTTPS_PORT = Number(process.env.BM_HTTPS_PORT) || 443
const HTTP_REDIRECT_PORT = Number(process.env.BM_HTTP_PORT) || 80
const pfxPath = process.env.BM_PFX_PATH || path.join(__dirname, 'Certificado', 'DASHBOARD.pfx')
const pfxPassword = process.env.BM_PFX_PASSWORD || ''

if (fs.existsSync(pfxPath)) {
  const httpsServer = https.createServer({
    pfx: fs.readFileSync(pfxPath),
    passphrase: pfxPassword,
  }, app)

  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log('='.repeat(60))
    console.log('  BackupMonitor Server v1.0')
    console.log('  HTTPS: https://dashboard:' + HTTPS_PORT)
    console.log('  HTTP:  http://dashboard:' + HTTP_REDIRECT_PORT + ' (redirige a HTTPS)')
    console.log('  Modo: Express + HTTPS')
    console.log('  Auth: ' + (AUTH_TOKEN ? 'Token configurado' : 'SIN AUTENTICACION'))
    console.log('='.repeat(60))

    const cfg = loadConfig()
    startRefreshTimer(cfg?.refreshMinutes)
    runRefresh()
  })

  const httpRedirect = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0]
    const target = HTTPS_PORT === 443 ? 'https://' + host + req.url : 'https://' + host + ':' + HTTPS_PORT + req.url
    res.writeHead(301, { Location: target })
    res.end()
  })
  httpRedirect.listen(HTTP_REDIRECT_PORT, '0.0.0.0', () => {
    console.log('  Redirect HTTP->HTTPS activo en puerto ' + HTTP_REDIRECT_PORT)
  })
} else {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60))
    console.log('  BackupMonitor Server v1.0')
    console.log('  HTTP: http://localhost:' + PORT + ' (PFX no encontrado)')
    console.log('='.repeat(60))
    const cfg = loadConfig()
    startRefreshTimer(cfg?.refreshMinutes)
    runRefresh()
  })
}

// Cleanup
process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] Cerrando...')
  if (refreshIntervalId) clearInterval(refreshIntervalId)
  await closeCachedSqlPool()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  if (refreshIntervalId) clearInterval(refreshIntervalId)
  await closeCachedSqlPool()
  process.exit(0)
})