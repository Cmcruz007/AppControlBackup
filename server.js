const { buildEmailHtml } = require('./electron/modules/emailBuilder.cjs')
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY

const express = require('express')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const https = require('https')
const http = require('http')

const { logGraphError } = require('./electron/modules/utils.cjs')
const { loadConfig, saveConfig, isElectron } = require('./electron/modules/config.cjs')
const {
  closeCachedSqlPool,
  withTempSqlPool,
  sqlGetSessionsInRange,
  sqlGetJobExecutions,
  sqlGetAvailableDays,
  sqlGetScheduleJobs,
  sqlListJobs,
} = require('./electron/modules/sql.cjs')

const {
  getEmails,
  getEmailsInRange,
  sendGraphEmail,
  getJobExecutionsFromEmailHistory,
} = require('./electron/modules/graph.cjs')

const {
  parseScheduleXml,
  expandSchedule30,
  cloneEntriesWithJobName,
  isBackupCopyJob,
  findParentJobForCopy,
  buildPrimaryJobIndex,
} = require('./electron/modules/schedule.cjs')

const {
  getOperationalWindow,
  processSessions,
  applyManualOverride,
} = require('./electron/modules/engine.cjs')

const {
  buildVdcRows,
  buildBarracudaRows,
  buildAs400Rows,
} = require('./electron/modules/rules.cjs')

// ─── Proxy corporativo ──────────────────────────────────────────────────────

if (proxyUrl) {
  const { setGlobalDispatcher, ProxyAgent } = require('undici')
  setGlobalDispatcher(new ProxyAgent(proxyUrl))
  console.log('[PROXY] Configurado:', proxyUrl)
}

// server.js — Express server for BackupMonitor production 24/7

// ─── Configuración ──────────────────────────────────────────────────────────

const PORT = Number(process.env.BM_PORT) || 3100
const AUTH_TOKEN = process.env.BM_AUTH_TOKEN || ''

const HTTPS_PORT = Number(process.env.BM_HTTPS_PORT) || 443
const HTTP_REDIRECT_PORT = Number(process.env.BM_HTTP_PORT) || 80
const pfxPath = process.env.BM_PFX_PATH || path.join(__dirname, 'Certificado', 'DASHBOARD.pfx')
const pfxPassword = process.env.BM_PFX_PASSWORD || ''

if (!AUTH_TOKEN) {
  console.warn('⚠️  BM_AUTH_TOKEN no definido. La API NO tiene autenticacion.')
  console.warn('   Define BM_AUTH_TOKEN en las variables de entorno para produccion.')
}

// ─── Estado global ──────────────────────────────────────────────────────────

let lastPayload = null
let lastRefreshTime = null
let refreshIntervalId = null

let dailyReportRunning = false
const dailyReportMarkerPath = path.join(__dirname, 'daily-report-last-sent.txt')

// ─── Utilidades ─────────────────────────────────────────────────────────────

function getLocalDateKey(d = new Date()) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function getLastDailyReportDate() {
  try {
    if (!fs.existsSync(dailyReportMarkerPath)) return null
    return fs.readFileSync(dailyReportMarkerPath, 'utf8').trim() || null
  } catch {
    return null
  }
}

function setLastDailyReportDate(dateKey) {
  try {
    fs.writeFileSync(dailyReportMarkerPath, dateKey, 'utf8')
  } catch (err) {
    console.error('[S-1] No se pudo guardar marca diaria:', err?.message || err)
  }
}

// ─── Motor de refresco ──────────────────────────────────────────────────────

async function buildRefreshPayloadForWindow(cfg, inicio, fin, includeSql = true) {
  const ahora = new Date()
  const overrides = cfg?.manualOverrides || {}
  const criticalityByJob = cfg?.criticalityByJob || {}

  const [emails, sessions] = await Promise.all([
    cfg?.graph?.tenantId ? getEmailsInRange(cfg, inicio, fin) : Promise.resolve([]),
    includeSql && cfg?.sql ? sqlGetSessionsInRange(cfg.sql, inicio, fin) : Promise.resolve([]),
  ])

  const { fullRows: sqlFullRows } = processSessions(
    sessions || [],
    emails || [],
    ahora,
    overrides,
    criticalityByJob
  )

  const vdcRows = buildVdcRows(
    cfg?.veeamDataCloudRules || [],
    emails || [],
    inicio,
    fin,
    '',
    criticalityByJob
  ).map(r => applyManualOverride(r, overrides, ahora))

  const barraRows = buildBarracudaRows(
    cfg?.barracudaRules || [],
    emails || [],
    inicio,
    fin,
    '',
    criticalityByJob
  ).map(r => applyManualOverride(r, overrides, ahora))

  const as400Rows = (
    await buildAs400Rows(
      cfg?.as400Rules || [],
      emails || [],
      inicio,
      fin,
      cfg,
      criticalityByJob
    )
  ).map(r => applyManualOverride(r, overrides, ahora))

  // ───────── LIMPIEZA POR VENTANA OPERACIONAL ─────────
  // Objetivo:
  // - Evitar estados arrastrados de ventanas anteriores.
  // - Limpiar comentarios antiguos.
  // - Marcar como pending lo que no pertenece a la ventana actual.

  function isSameWindow(date) {
    if (!date) return false

    const d = new Date(date)
    if (Number.isNaN(d.getTime())) return false

    return d >= inicio && d < fin
  }

  function cleanRow(row) {
    const refDate =
      row.lastRun ||
      row.start ||
      row.end ||
      row.nextRun

    if (!isSameWindow(refDate)) {
      return {
        ...row,
        status: 'pending',
        reason: 'Pendiente ejecución',
        duration: null,
        lastRun: null,
      }
    }

    return row
  }

  // ───────── CONSTRUCCIÓN FINAL ─────────

  const fullRows = [...sqlFullRows, ...vdcRows, ...barraRows, ...as400Rows]
    .map(cleanRow)
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

      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true })
      }

      const datosParaMovil = payload.fullRows.map(r => ({
        backup_policy_name: r.jobName,
        status: r.status,
        result: r.lastResult,
        creation_time: r.nextRun,
        end_time: r.lastRun,
        duration: r.duration,
        reason: r.reason,
        criticality: r.criticality,
        source: r.source,
      }))

      fs.writeFileSync(jsonPath, JSON.stringify(datosParaMovil, null, 4), 'utf8')
      fs.writeFileSync(
        path.join(folderPath, 'motor_status.txt'),
        `Ultimo refresco correcto: ${new Date().toLocaleString()}`,
        'utf8'
      )
    } catch (exportErr) {
      logGraphError('JSON_EXPORT_ERROR', {
        message: exportErr?.message || String(exportErr),
      })
    }

    console.log(`[REFRESH] OK — ${payload.fullRows.length} jobs, ${new Date().toLocaleTimeString()}`)
    return payload
  } catch (e) {
    logGraphError('RUN_REFRESH_ERROR', {
      message: e?.message || String(e),
    })

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

// ─── S-1: Envio automatico diario ───────────────────────────────────────────

async function sendDailyReport() {
  try {
    console.log('[S-1] Generando informe diario...')
    console.log('[S-1] ENV BM_DAILY_REPORT_TO:', JSON.stringify(process.env.BM_DAILY_REPORT_TO))

    if (!lastPayload || !Array.isArray(lastPayload.fullRows)) {
      console.log('[S-1] No hay datos disponibles todavía. Ejecutando refresh previo...')

      const payload = await runRefresh()

      if (!payload?.ok || !Array.isArray(payload.fullRows)) {
        console.log('[S-1] No se pudo generar informe: no hay payload válido')
        return false
      }
    }

    const cfg = loadConfig()
    const data = lastPayload

    if (!data || !Array.isArray(data.fullRows)) {
      console.log('[S-1] Payload no válido después del refresh')
      return false
    }

    const fromEnv = (process.env.BM_DAILY_REPORT_TO || '').trim()
    const fromCfg = cfg?.dailyReport?.recipients

    console.log('[S-1] fromEnv:', JSON.stringify(fromEnv))
    console.log('[S-1] fromCfg:', JSON.stringify(fromCfg))

    const to = fromEnv
      ? fromEnv
      : Array.isArray(fromCfg)
        ? fromCfg.join(';')
        : String(fromCfg || '').trim()

    console.log('[S-1] to final:', JSON.stringify(to))

    if (!to) {
      console.warn('[S-1] No hay destinatarios. Define BM_DAILY_REPORT_TO o cfg.dailyReport.recipients')
      return false
    }

    console.log('[S-1] Destinatarios:', to)

    const bodyHtml = buildEmailHtml(data)
    const subject = `Informe Backup ${new Date().toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).toUpperCase()}`

    console.log('[S-1] Llamando a sendGraphEmail...')

    await sendGraphEmail(cfg, {
      to,
      subject,
      bodyHtml,
    })

    console.log('[S-1] Correo enviado correctamente')
    return true
  } catch (err) {
    console.error('[S-1] Error enviando correo:', err?.message || err)
    console.error('[S-1] Stack:', err?.stack)

    try {
      logGraphError('DAILY_REPORT_ERROR', {
        message: err?.message || String(err),
      })
    } catch {
      // evitar romper por fallo en logging
    }

    return false
  }
}

function startDailyReportScheduler() {
  console.log('[S-1] Scheduler diario activo a las 17:00')

  setInterval(() => {
    const now = new Date()
    const today = getLocalDateKey(now)
    const lastSentDate = getLastDailyReportDate()

    if (now.getHours() !== 17 || now.getMinutes() !== 0) return
    if (dailyReportRunning) return
    if (lastSentDate === today) {
      console.log('[S-1] Informe diario ya enviado hoy:', today)
      return
    }

    dailyReportRunning = true

    sendDailyReport()
      .then((ok) => {
        if (ok) {
          setLastDailyReportDate(today)
        }
      })
      .finally(() => {
        dailyReportRunning = false
      })
  }, 60000)
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
  if (!AUTH_TOKEN) return next()

  if (!req.path.startsWith('/api/')) return next()

  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : req.query?.token || ''

  if (token === AUTH_TOKEN) return next()

  return res.status(401).json({ ok: false, error: 'No autorizado' })
}

app.use(authMiddleware)

// ─── API Endpoints ──────────────────────────────────────────────────────────

// Estado actual
app.get('/api/status', (_req, res) => {
  if (!lastPayload) {
    return res.json({
      ok: false,
      error: 'Aun no hay datos. Esperando primer refresh.',
    })
  }

  res.json({
    ...lastPayload,
    lastRefreshTime,
  })
})

// Forzar refresh manual
app.post('/api/refresh', async (_req, res) => {
  try {
    const payload = await runRefresh()
    res.json(payload)
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message,
    })
  }
})

// Config
app.get('/api/config', (_req, res) => {
  try {
    const cfg = loadConfig() || {}
    res.json(cfg)
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message,
    })
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
    res.status(500).json({
      ok: false,
      error: e.message,
    })
  }
})

// SQL tests
app.post('/api/test/sql', async (req, res) => {
  try {
    await withTempSqlPool(req.body, async () => true)
    res.json({ ok: true })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
    })
  }
})

app.post('/api/test/graph', async (req, res) => {
  try {
    const emails = await getEmails({ graph: req.body })
    res.json({
      ok: true,
      count: Array.isArray(emails) ? emails.length : 0,
    })
  } catch (e) {
    res.json({
      ok: false,
      error: e?.message || String(e),
    })
  }
})

// SQL Explorer
app.post('/api/sql/databases', async (req, res) => {
  try {
    const databases = await withTempSqlPool(req.body, async (pool) => {
      const result = await pool.request().query('SELECT name FROM sys.databases ORDER BY name')
      return result.recordset.map((r) => r.name)
    })

    res.json({
      ok: true,
      databases,
    })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
    })
  }
})

app.post('/api/sql/tables', async (req, res) => {
  try {
    const info = await withTempSqlPool(req.body, async (pool) => {
      const result = await pool.request().query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME')
      return result.recordset
    })

    res.json({
      ok: true,
      info,
    })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
    })
  }
})

app.post('/api/sql/columns', async (req, res) => {
  try {
    const { sqlCfg, tableName } = req.body
    const mssql = require('mssql')

    const columns = await withTempSqlPool(sqlCfg, async (pool) => {
      const r = pool.request()
      r.input('tableName', mssql.NVarChar, tableName)

      const result = await r.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @tableName
        ORDER BY ORDINAL_POSITION
      `)

      return result.recordset.map((row) => row.COLUMN_NAME)
    })

    res.json({
      ok: true,
      columns,
    })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
      columns: [],
    })
  }
})

// Email manual desde UI
app.post('/api/email/send', async (req, res) => {
  try {
    const cfg = loadConfig()
    await sendGraphEmail(cfg, req.body)

    res.json({ ok: true })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
    })
  }
})

// S-1 test manual informe diario
app.post('/api/email/daily-report/test', async (_req, res) => {
  try {
    const ok = await sendDailyReport()

    res.json({
      ok,
      message: ok
        ? 'Informe diario enviado correctamente.'
        : 'No se pudo enviar el informe diario. Revisa logs.',
    })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
    })
  }
})

// History
app.get('/api/history/days', async (_req, res) => {
  const cfg = loadConfig()

  if (!cfg?.sql) {
    return res.json({
      ok: false,
      error: 'Falta configuracion SQL.',
      days: [],
    })
  }

  try {
    const days = await sqlGetAvailableDays(cfg.sql)

    res.json({
      ok: true,
      days,
    })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
      days: [],
    })
  }
})

app.get('/api/history/day/:dateStr', async (req, res) => {
  const cfg = loadConfig()

  if (!cfg?.sql) {
    return res.json({
      ok: false,
      error: 'Falta configuracion SQL.',
    })
  }

  try {
    const [year, month, day] = String(req.params.dateStr || '')
      .split('-')
      .map(Number)

    const inicio = new Date(year, month - 1, day, 18, 0, 0, 0)
    const fin = new Date(inicio.getTime() + 86400000)

    const payload = await buildRefreshPayloadForWindow(cfg, inicio, fin, true)

    res.json({
      ok: true,
      rows: payload.rows,
      fullRows: payload.fullRows,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
    })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
    })
  }
})

// Schedule
app.get('/api/schedule/30days', async (_req, res) => {
  const cfg = loadConfig()

  if (!cfg?.sql) {
    return res.json({
      ok: false,
      error: 'Falta configuracion SQL.',
      rows: [],
    })
  }

  try {
    const rawJobs = await sqlGetScheduleJobs(cfg.sql)
    const jobs = (Array.isArray(rawJobs) ? rawJobs : [])
      .filter((j) => j && typeof j === 'object' && j.name)

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

      const inherited = cloneEntriesWithJobName(
        primaryEntriesByName.get(parent.name) || [],
        copy.name
      )

      if (!inherited.length) continue

      all.push(...inherited)
    }

    all.sort((a, b) => a.date.getTime() - b.date.getTime())

    res.json({
      ok: true,
      rows: all.map((r) => ({
        job: r.job,
        date: r.date.toISOString(),
      })),
    })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
      rows: [],
    })
  }
})

// Jobs
app.get('/api/jobs/list', async (_req, res) => {
  const cfg = loadConfig()

  if (!cfg?.sql) {
    return res.json({
      ok: false,
      error: 'Falta configuracion SQL.',
      jobs: [],
    })
  }

  try {
    const jobs = await sqlListJobs(cfg.sql)

    res.json({
      ok: true,
      jobs,
    })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
      jobs: [],
    })
  }
})

app.get('/api/jobs/executions/:jobName', async (req, res) => {
  const cfg = loadConfig()

  try {
    const jobName = decodeURIComponent(req.params.jobName).trim()
    const limit = Number(req.query.limit) || 200

    const allRules = [
      ...(Array.isArray(cfg?.veeamDataCloudRules) ? cfg.veeamDataCloudRules : []),
      ...(Array.isArray(cfg?.barracudaRules) ? cfg.barracudaRules : []),
      ...(Array.isArray(cfg?.as400Rules) ? cfg.as400Rules : []),
    ]

    const matchedRule = allRules.find((r) => {
      const title = String(r?.title || '').trim().toLowerCase()
      const name = String(r?.name || '').trim().toLowerCase()
      const target = String(jobName || '').trim().toLowerCase()

      return target === title || target === name
    })

    if (matchedRule) {
      const data = await getJobExecutionsFromEmailHistory(
        cfg,
        matchedRule,
        jobName,
        limit,
        60
      )

      return res.json(data)
    }

    if (!cfg?.sql) {
      return res.json({
        ok: false,
        error: 'Falta configuracion SQL.',
        executions: [],
      })
    }

    const data = await sqlGetJobExecutions(cfg.sql, jobName, limit)
    res.json(data)
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
      executions: [],
    })
  }
})

app.get('/api/jobs/executions', async (_req, res) => {
  const cfg = loadConfig()

  if (!cfg?.sql) {
    return res.json({
      ok: false,
      error: 'Falta configuracion SQL.',
      executions: [],
    })
  }

  try {
    const limit = Number(_req.query.limit) || 200
    const data = await sqlGetJobExecutions(cfg.sql, null, limit)

    res.json(data)
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
      executions: [],
    })
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
    dailyReportLastSent: getLastDailyReportDate(),
  })
})

// SPA fallback
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      ok: false,
      error: 'Endpoint API no encontrado',
    })
  }

  const indexPath = path.join(distPath, 'index.html')

  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath)
  }

  res.status(404).send('Build no encontrado. Ejecuta: npm run build')
})

// ─── Arranque ───────────────────────────────────────────────────────────────

function startBackupMonitorRuntime() {
  const cfg = loadConfig()

  startRefreshTimer(cfg?.refreshMinutes)
  startDailyReportScheduler()
  runRefresh()
}

function startHttpFallback(reason) {
  console.warn('[HTTPS] Arrancando en HTTP fallback:', reason)

  app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60))
    console.log('  BackupMonitor Server v2.3')
    console.log('  HTTP: http://localhost:' + PORT)
    console.log('  Motivo fallback: ' + reason)
    console.log('  Auth: ' + (AUTH_TOKEN ? 'Token configurado' : 'SIN AUTENTICACION'))
    console.log('='.repeat(60))

    startBackupMonitorRuntime()
  })
}

if (fs.existsSync(pfxPath)) {
  try {
    if (!pfxPassword) {
      throw new Error('BM_PFX_PASSWORD no definido o vacío')
    }

    console.log('[HTTPS] PFX path:', pfxPath)
    console.log('[HTTPS] PFX password definida:', pfxPassword ? 'SI' : 'NO')
    console.log('[HTTPS] PFX password length:', String(pfxPassword).length)

    const httpsOptions = {
      pfx: fs.readFileSync(pfxPath),
      passphrase: pfxPassword,
    }

    const httpsServer = https.createServer(httpsOptions, app)

    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log('='.repeat(60))
      console.log('  BackupMonitor Server v2.3')
      console.log('  HTTPS: https://dashboard' + (HTTPS_PORT === 443 ? '' : ':' + HTTPS_PORT))
      console.log('  HTTP:  http://dashboard:' + HTTP_REDIRECT_PORT + ' (redirige a HTTPS)')
      console.log('  Modo: Express + HTTPS')
      console.log('  Auth: ' + (AUTH_TOKEN ? 'Token configurado' : 'SIN AUTENTICACION'))
      console.log('='.repeat(60))

      startBackupMonitorRuntime()
    })

    const httpRedirect = http.createServer((req, res) => {
      const host = (req.headers.host || '').split(':')[0]
      const target = HTTPS_PORT === 443
        ? 'https://' + host + req.url
        : 'https://' + host + ':' + HTTPS_PORT + req.url

      res.writeHead(301, {
        Location: target,
      })

      res.end()
    })

    httpRedirect.listen(HTTP_REDIRECT_PORT, '0.0.0.0', () => {
      console.log('  Redirect HTTP->HTTPS activo en puerto ' + HTTP_REDIRECT_PORT)
    })
  } catch (err) {
    console.error('[HTTPS] Error cargando certificado PFX:', err?.message || err)
    process.exit(1)
  }
} else {
  startHttpFallback('PFX no encontrado: ' + pfxPath)
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