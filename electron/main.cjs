// electron/main.cjs — Slim orchestrator
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const mssql = require('mssql')

// ─── Módulos ────────────────────────────────────────────────────────────────
const { logGraphError } = require('./modules/utils.cjs')
const { loadConfig, saveConfig } = require('./modules/config.cjs')
const { closeCachedSqlPool, withTempSqlPool, sqlGetSessionsInRange, sqlGetJobExecutions, sqlGetAvailableDays, sqlGetScheduleJobs, sqlListJobs } = require('./modules/sql.cjs')
const { getEmails, getEmailsInRange, sendGraphEmail } = require('./modules/graph.cjs')
const { parseScheduleXml, expandSchedule30, cloneEntriesWithJobName, isBackupCopyJob, findParentJobForCopy, buildPrimaryJobIndex } = require('./modules/schedule.cjs')
const { getOperationalWindow, processSessions, applyManualOverride } = require('./modules/engine.cjs')
const { buildVdcRows, buildBarracudaRows, buildAs400Rows } = require('./modules/rules.cjs')

// ─── Estado global ──────────────────────────────────────────────────────────
let mainWin = null
let refreshIntervalId = null

// ─── Motor de refresco ──────────────────────────────────────────────────────
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
    try {
      fs.writeFileSync('C:\\Users\\Public\\LOG_MOTOR_ERROR.txt',
        `[${new Date().toLocaleTimeString()}] El motor arranco pero no encontro configuracion de SQL ni de Graph.\n`, 'utf8')
    } catch (e) {}
    return { ok: false, error: 'Falta configuracion SQL o Graph.' }
  }

  try {
    const { inicio, fin } = getOperationalWindow(new Date())
    const payload = await buildRefreshPayloadForWindow(cfg, inicio, fin, hasSql)

    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('auto:update', payload)
    }

    // ── Exportación JSON móvil ──────────────────────────────────────────
    try {
      const jsonPath = 'C:\\DashboardBackups\\backup_status.json'
      const folderPath = path.dirname(jsonPath)
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true })

      const datosParaMovil = payload.fullRows.map(r => ({
        backup_policy_name: r.jobName, status: r.status, result: r.lastResult,
        creation_time: r.nextRun, end_time: r.lastRun, duration: r.duration,
        reason: r.reason, criticality: r.criticality, source: r.source,
      }))

      fs.writeFileSync(jsonPath, JSON.stringify(datosParaMovil, null, 4), 'utf8')
      fs.writeFileSync('C:\\DashboardBackups\\motor_status.txt',
        `Ultimo refresco correcto: ${new Date().toLocaleString()}`, 'utf8')
    } catch (exportErr) {
      try {
        fs.writeFileSync('C:\\Users\\Public\\LOG_MOTOR_ERROR.txt',
          `Error en exportacion: ${exportErr?.message || String(exportErr)}\n`, 'utf8')
      } catch (_) {}
      logGraphError('JSON_EXPORT_ERROR', { message: exportErr?.message || String(exportErr) })
    }

    return payload
  } catch (e) {
    logGraphError('RUN_REFRESH_ERROR', { message: e?.message || String(e) })
    return { ok: false, error: e.message }
  }
}

function startRefreshTimer(minutes) {
  if (refreshIntervalId) clearInterval(refreshIntervalId)
  const ms = Math.max(1, Number(minutes ?? 5)) * 60 * 1000
  refreshIntervalId = setInterval(() => runRefresh(), ms)
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────
function setupIpc() {
  console.log('DEBUG: Registrando ipcMain handlers...')
  const handle = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn) }

  handle('config:get', async () => loadConfig() || {})

  handle('config:save', async (_e, cfg) => {
    try { saveConfig(cfg || {}); startRefreshTimer(cfg?.refreshMinutes); return true }
    catch (e) { throw new Error(e?.message || String(e)) }
  })

  handle('test:sql', async (_e, sqlCfg) => {
    try { await withTempSqlPool(sqlCfg, async () => true); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })

  handle('test:graph', async (_e, graphCfg) => {
    try {
      const emails = await getEmails({ graph: graphCfg })
      return { ok: true, count: Array.isArray(emails) ? emails.length : 0 }
    } catch (e) { return { ok: false, error: e?.message || String(e) } }
  })

  handle('sql:listDatabases', async (_e, sqlCfg) => {
    try {
      const databases = await withTempSqlPool(sqlCfg, async (pool) => {
        const result = await pool.request().query('SELECT name FROM sys.databases ORDER BY name')
        return result.recordset.map((r) => r.name)
      })
      return { ok: true, databases }
    } catch (e) { return { ok: false, error: e.message } }
  })

  handle('sql:listTables', async (_e, sqlCfg) => {
    try {
      const info = await withTempSqlPool(sqlCfg, async (pool) => {
        const result = await pool.request().query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME')
        return result.recordset
      })
      return { ok: true, info }
    } catch (e) { return { ok: false, error: e.message } }
  })

  handle('sql:listColumns', async (_e, sqlCfg, tableName) => {
    try {
      const columns = await withTempSqlPool(sqlCfg, async (pool) => {
        const req = pool.request()
        req.input('tableName', mssql.NVarChar, tableName)
        const result = await req.query(`
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @tableName ORDER BY ORDINAL_POSITION
        `)
        return result.recordset.map((r) => r.COLUMN_NAME)
      })
      return { ok: true, columns }
    } catch (e) { return { ok: false, error: e.message, columns: [] } }
  })

  handle('email:send', async (_e, payload) => {
    const cfg = loadConfig()
    try { await sendGraphEmail(cfg, payload); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })

  handle('refresh', async () => runRefresh())

  handle('history:getDays', async () => {
    const cfg = loadConfig()
    if (!cfg?.sql) return { ok: false, error: 'Falta configuracion SQL.', days: [] }
    try { const days = await sqlGetAvailableDays(cfg.sql); return { ok: true, days } }
    catch (e) { return { ok: false, error: e.message, days: [] } }
  })

  handle('history:getDay', async (_e, dateStr) => {
    const cfg = loadConfig()
    if (!cfg?.sql) return { ok: false, error: 'Falta configuracion SQL.' }
    try {
      const [year, month, day] = String(dateStr || '').split('-').map(Number)
      const inicio = new Date(year, month - 1, day, 18, 0, 0, 0)
      const fin = new Date(inicio.getTime() + 86400000)
      const payload = await buildRefreshPayloadForWindow(cfg, inicio, fin, true)
      return { ok: true, rows: payload.rows, fullRows: payload.fullRows, windowStart: payload.windowStart, windowEnd: payload.windowEnd }
    } catch (e) { return { ok: false, error: e.message } }
  })

  handle('schedule:get30days', async () => {
    const cfg = loadConfig()
    if (!cfg?.sql) return { ok: false, error: 'Falta configuracion SQL.', rows: [], debug: { hasSqlConfig: false } }
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
      return { ok: true, rows: all.map((r) => ({ job: r.job, date: r.date.toISOString() })) }
    } catch (e) { return { ok: false, error: e.message, rows: [] } }
  })

  const handleGetExecutions = async (_e, jobName, limit = 100) => {
    const cfg = loadConfig()
    if (!cfg?.sql) return { ok: false, error: 'Falta configuracion SQL.', executions: [] }
    try {
      const normalizedJobName = jobName ? String(jobName).trim() : null
      return await sqlGetJobExecutions(cfg.sql, normalizedJobName, limit)
    } catch (e) { return { ok: false, error: e.message, executions: [] } }
  }

  handle('jobs:list', async () => {
    const cfg = loadConfig()
    if (!cfg?.sql) return { ok: false, error: 'Falta configuracion SQL.', jobs: [] }
    try { const jobs = await sqlListJobs(cfg.sql); return { ok: true, jobs } }
    catch (e) { return { ok: false, error: e.message, jobs: [] } }
  })

  handle('jobs:getExecutions', handleGetExecutions)
  handle('jobs:get-executions', handleGetExecutions)
}

// ─── Ventana ────────────────────────────────────────────────────────────────
function createWindow() {
  mainWin = new BrowserWindow({
    width: 1300, height: 900, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  })

  mainWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logGraphError('WINDOW_DID_FAIL_LOAD', { errorCode, errorDescription, validatedURL })
  })
  mainWin.once('ready-to-show', () => { mainWin.show() })
  mainWin.on('closed', () => { mainWin = null })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWin.loadURL(process.env.VITE_DEV_SERVER_URL).catch((err) => {
      logGraphError('LOAD_URL_ERROR', { message: err?.message || String(err) })
    })
  } else {
    mainWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch((err) => {
      logGraphError('LOAD_FILE_ERROR', { message: err?.message || String(err) })
    })
  }
}

// ─── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  console.log('--- INICIANDO SETUP IPC ---')
  setupIpc()
  console.log('--- SETUP IPC COMPLETADO ---')
  createWindow()
  const cfg = loadConfig()
  startRefreshTimer(cfg?.refreshMinutes)
})

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', async () => { await closeCachedSqlPool() })
app.on('window-all-closed', () => { app.quit() })