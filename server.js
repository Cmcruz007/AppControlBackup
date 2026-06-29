const { buildEmailHtml } = require('./electron/modules/emailBuilder.cjs')
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY

const express = require('express')
const path = require('path')
const fs = require('fs')
const https = require('https')
const http = require('http')

const { logGraphError } = require('./electron/modules/utils.cjs')
const { verifyEntraToken } = require('./electron/modules/entraAuth.cjs')
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

// ─── Configuración ──────────────────────────────────────────────────────────

const PORT = Number(process.env.BM_PORT) || 3100
const AUTH_TOKEN = process.env.BM_AUTH_TOKEN || ''

const HTTPS_PORT = Number(process.env.BM_HTTPS_PORT) || 443
const HTTP_REDIRECT_PORT = Number(process.env.BM_HTTP_PORT) || 80
const pfxPath = process.env.BM_PFX_PATH || path.join(__dirname, 'Certificado', 'DASHBOARD.pfx')
const pfxPassword = process.env.BM_PFX_PASSWORD || ''

if (!AUTH_TOKEN) {
  console.warn('⚠️  BM_AUTH_TOKEN no definido. La API NO tiene autenticacion por token clásico.')
  console.warn('   En producción debe existir BM_AUTH_TOKEN o validación Entra ID activa.')
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

function safeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return value
  return String(value)
}

function normalizeStatus(value) {
  return safeString(value).trim().toLowerCase()
}

function normalizeJobNameForRule(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function isWeekendOperationalWindow(windowStartDate) {
  const d = windowStartDate instanceof Date ? windowStartDate : new Date(windowStartDate)
  if (Number.isNaN(d.getTime())) return false

  const day = d.getDay()
  return day === 0 || day === 6
}

function isAs400PrRrWeekendExcluded(row) {
  const name = normalizeJobNameForRule(row?.jobName || row?.name || row?.title)

  return (
    name === 'BACKUP PR' ||
    name === 'BACKUP RR'
  )
}

function isDdvePhysicalChildDuplicate(row) {
  const rawName = safeString(row?.jobName || row?.name || row?.title).trim()
  const name = normalizeJobNameForRule(rawName)

  const dcoMain = 'DDVE-DCO FISICA - MENSUAL - DIA 29'
  const ticMain = 'DDVE-TIC FISICA - MENSUAL - DIA 29'

  const isDcoChild =
    name === `${dcoMain} - DDVE-DCO` ||
    name === `${dcoMain} - DDVE DCO`

  const isTicChild =
    name === `${ticMain} - DDVE-TIC` ||
    name === `${ticMain} - DDVE TIC`

  return isDcoChild || isTicChild
}

function filterDashboardRows(rows, windowStartDate) {
  const weekendWindow = isWeekendOperationalWindow(windowStartDate)

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const status = normalizeStatus(row.status)

    if (status === 'no-run' || status === 'idle') {
      return false
    }

    if (isDdvePhysicalChildDuplicate(row)) {
      return false
    }

    if (weekendWindow && isAs400PrRrWeekendExcluded(row)) {
      return false
    }

    return true
  })
}

function formatBackupDateFromWindow(windowStartIso) {
  const d = new Date(windowStartIso)

  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).toUpperCase()
  }

  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).toUpperCase()
}

function normalizeB2Status(row) {
  return normalizeStatus(row?.status || row?.state)
}

function getGlobalState(row) {
  const rawStatus = normalizeB2Status(row)

  if (
    rawStatus === 'no-run' ||
    rawStatus === 'no_run' ||
    rawStatus === 'norun'
  ) {
    return 'NO-RUN'
  }

  if (rawStatus === 'success') return 'SUCCESS'

  if (rawStatus === 'warning' || rawStatus === 'warn') {
    return 'WARNING'
  }

  if (
    rawStatus === 'error' ||
    rawStatus === 'failed' ||
    rawStatus === 'failure'
  ) {
    return 'ERROR'
  }

  // B-2: running + pending se unifican como EN CURSO
  if (rawStatus === 'running' || rawStatus === 'pending') {
    return 'RUNNING'
  }

  return 'UNKNOWN'
}

function getProgressValue(row) {
  const candidates = [
    row?.progress,
    row?.progressPercent,
    row?.percent,
    row?.progressPct,
    row?.completionPercent,
  ]

  for (const value of candidates) {
    if (value !== undefined && value !== null && value !== '') {
      const n = Number(String(value).replace('%', '').trim())
      if (Number.isFinite(n)) return Math.round(n)
    }
  }

  return null
}

function detectRowSource(row) {
  const value = String(
    row?.source ||
    row?.sourceType ||
    row?.parserSource ||
    row?.type ||
    ''
  ).toLowerCase()

  if (value.includes('as400') || value.includes('ibm')) return 'as400'
  if (value.includes('barracuda')) return 'barracuda'

  if (
    value.includes('vdc') ||
    value.includes('veeam data cloud') ||
    value.includes('data cloud')
  ) {
    return 'vdc'
  }

  if (
    value.includes('veeam') ||
    value.includes('sql') ||
    value.includes('backup & replication')
  ) {
    return 'veeam'
  }

  return value
}

function buildSmartDetail(row) {
  const rawStatus = normalizeB2Status(row)
  const source = detectRowSource(row)

  if (
    rawStatus === 'no-run' ||
    rawStatus === 'no_run' ||
    rawStatus === 'norun'
  ) {
    return 'Sin ejecución'
  }

// Veeam SQL
// Si viene de SQL/Veeam, significa que existe sesión en BBDD.
// Por tanto, running y pending técnico se presentan como ejecución real.
if (source === 'veeam' || source === 'sql') {
  if (rawStatus === 'running' || rawStatus === 'pending') {
    const progress = getProgressValue(row)

    if (progress !== null) {
      return `En ejecución (${progress}%)`
    }

    return 'En ejecución'
  }
}

  // Jobs por email: AS400 / Barracuda / VDC
  if (
    source === 'as400' ||
    source === 'barracuda' ||
    source === 'vdc' ||
    source === 'email'
  ) {
    if (rawStatus === 'pending') {
      return 'Pendiente recepción'
    }
  }

  return row?.detail || row?.reason || row?.message || ''
}

function applyB2StateModel(row) {
  const globalState = getGlobalState(row)
  const detail = buildSmartDetail(row)

  return {
    ...row,
    globalState,
    detail,
  }
}

function getPayloadSummary(payload) {
  const rows = Array.isArray(payload?.fullRows) ? payload.fullRows : []

  const summary = {
    total: 0,
    success: 0,
    warning: 0,
    failed: 0,
    error: 0,
    running: 0,
    pending: 0,
    noRun: 0,
    other: 0,
  }

  for (const row of rows) {
    const globalState = row?.globalState || getGlobalState(row)
    const status = normalizeStatus(row?.status)

    if (globalState === 'NO-RUN') {
      summary.noRun += 1
      continue
    }

    summary.total += 1

    if (globalState === 'SUCCESS') summary.success += 1
    else if (globalState === 'WARNING') summary.warning += 1
    else if (globalState === 'ERROR') {
      if (status === 'failed') summary.failed += 1
      else summary.error += 1
    } else if (globalState === 'RUNNING') {
      summary.running += 1
      if (status === 'pending') summary.pending += 1
    } else {
      summary.other += 1
    }
  }

  return summary
}

function sanitizeRowForFrontend(row) {
  if (!row || typeof row !== 'object') return row

  return {
    ...row,
    jobName: safeString(row.jobName || row.name || row.title || 'UNKNOWN', 'UNKNOWN'),
    name: safeString(row.name || row.jobName || row.title || 'UNKNOWN', 'UNKNOWN'),
    source: safeString(row.source),
    status: safeString(row.status),
    reason: safeString(row.reason),
    detail: safeString(row.detail || row.reason),
    type: safeString(row.type),
  }
}

function decorateLogAvailability(row) {
  if (!row || typeof row !== 'object') return row

  const jobName = safeString(row.jobName || row.name || row.title).toLowerCase()
  const source = safeString(row.source || row.type).toLowerCase()
  const reason = safeString(row.reason || row.detail).toLowerCase()

  const hasEmailEvidence = Boolean(
    row.lastEmailDate ||
    row.emailReceivedDate ||
    row.receivedDateTime ||
    row.email?.receivedDateTime ||
    row.email?.id ||
    row.emailId ||
    row.internetMessageId
  )

  const hasTextualEmailLog =
    reason.includes('correo recibido') ||
    reason.includes('revisar manualmente el log') ||
    reason.includes('log')

  const isKnownEmailJob =
    source.includes('as400') ||
    source.includes('vdc') ||
    source.includes('barracuda') ||
    source.includes('email') ||
    jobName.includes('backup sd') ||
    jobName.includes('backup sdb') ||
    jobName.includes('sdb/tgt') ||
    jobName.includes('backup sdb/tgt')

  const hasLog = Boolean(
    row.hasLog ||
    row.logAvailable ||
    row.hasEmailLog ||
    row.emailLogAvailable ||
    row.canOpenLog ||
    row.log ||
    row.logText ||
    row.logHtml ||
    row.emailLog ||
    hasEmailEvidence ||
    hasTextualEmailLog ||
    isKnownEmailJob
  )

  if (!hasLog) return row

  return {
    ...row,
    hasLog: true,
    logAvailable: true,
    hasEmailLog: true,
    emailLogAvailable: true,
    canOpenLog: true,
    logIcon: true,
  }
}

// ─── Motor de refresco ──────────────────────────────────────────────────────

async function buildRefreshPayloadForWindow(cfg, inicio, fin, includeSql = true) {
  const ahora = new Date()
  const rawOverrides = cfg?.manualOverrides || {}
  const criticalityByJob = cfg?.criticalityByJob || {}

  function parseDateFlexible(value) {
    if (!value) return null

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value
    }

    let d = new Date(value)

    if (!Number.isNaN(d.getTime())) {
      return d
    }

    if (typeof value === 'string') {
      const s = value.trim()
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/)

      if (m) {
        const [, dd, mm, yyyy, hh, mi, ss] = m

        d = new Date(
          Number(yyyy),
          Number(mm) - 1,
          Number(dd),
          Number(hh),
          Number(mi),
          Number(ss || 0)
        )

        if (!Number.isNaN(d.getTime())) {
          return d
        }
      }
    }

    return null
  }

  function isSameWindow(date) {
    const d = parseDateFlexible(date)
    if (!d) return false

    return d >= inicio && d < fin
  }

  function getOverrideDate(override) {
    if (!override || typeof override !== 'object') return null

    return (
      override.updatedAt ||
      override.updated ||
      override.modifiedAt ||
      override.createdAt ||
      override.timestamp ||
      override.ts ||
      override.date ||
      override.manualAt ||
      null
    )
  }

  function filterManualOverridesForWindow(overrides) {
    const filtered = {}

    for (const [jobName, override] of Object.entries(overrides || {})) {
      const overrideDate = getOverrideDate(override)

      if (!isSameWindow(overrideDate)) continue

      filtered[jobName] = override
    }

    return filtered
  }

  const overrides = filterManualOverridesForWindow(rawOverrides)

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
  ).map((r) => applyManualOverride(r, overrides, ahora))

  const barraRows = buildBarracudaRows(
    cfg?.barracudaRules || [],
    emails || [],
    inicio,
    fin,
    '',
    criticalityByJob
  ).map((r) => applyManualOverride(r, overrides, ahora))

  const as400Rows = (
    await buildAs400Rows(
      cfg?.as400Rules || [],
      emails || [],
      inicio,
      fin,
      cfg,
      criticalityByJob
    )
  ).map((r) => applyManualOverride(r, overrides, ahora))

  function cleanRow(row) {
    row = sanitizeRowForFrontend(decorateLogAvailability(row))

    const evidenceDates = [
      row.lastRun,
      row.start,
      row.end,
      row.lastEmailDate,
      row.emailReceivedDate,
      row.receivedDateTime,
      row.email?.receivedDateTime,
    ]

    const hasEvidenceInWindow = evidenceDates.some(isSameWindow)

    if (!hasEvidenceInWindow) {
      return sanitizeRowForFrontend(decorateLogAvailability({
        ...row,
        status: 'pending',
        reason: 'Pendiente ejecución',
        detail: 'Pendiente ejecución',
        duration: '',
        durationMs: null,
        durationTrend: null,
        lastRun: null,
        lastResult: -1,
        endTimeDisplay: '',
      }))
    }

    return sanitizeRowForFrontend(decorateLogAvailability(row))
  }

  function applyManualOverrideFinal(row) {
    row = sanitizeRowForFrontend(decorateLogAvailability(row))

    const ov = row?.jobName ? overrides?.[row.jobName] : null
    if (!ov) return row

    const manualStatus = ov.status ? safeString(ov.status).trim().toLowerCase() : ''
    const manualComment = ov.comment ? safeString(ov.comment).trim() : ''

    return sanitizeRowForFrontend(decorateLogAvailability({
      ...row,
      ...(manualStatus ? { status: manualStatus } : {}),
      ...(manualComment ? { reason: manualComment, detail: manualComment } : {}),
    }))
  }

  function applyWeekendNoRunForAs400(row) {
    row = sanitizeRowForFrontend(decorateLogAvailability(row))

    if (isWeekendOperationalWindow(inicio) && isAs400PrRrWeekendExcluded(row)) {
      return sanitizeRowForFrontend(decorateLogAvailability({
        ...row,
        status: 'no-run',
        reason: 'Sin ejecución',
        detail: 'Sin ejecución',
        duration: '',
        durationMs: null,
        durationTrend: null,
        lastRun: null,
        lastResult: -1,
        startTimeDisplay: '',
        endTimeDisplay: '',
      }))
    }

    return row
  }

  // Catalogo fijo AS400/email:
  // Los jobs definidos en cfg.as400Rules deben existir siempre en Directorio de Jobs.
  // No se inyectan como SQL porque su historico depende de reglas AS400/email.

  const existingAs400JobNames = new Set(
    (Array.isArray(as400Rows) ? as400Rows : []).map((r) => {
      return safeString(r && (r.jobName || r.name || r.title)).toUpperCase().trim()
    })
  )

  function ensureAs400CatalogFromRules() {
    const rules = Array.isArray(cfg && cfg.as400Rules) ? cfg.as400Rules : []

    rules.forEach((rule) => {
      const jobName = safeString(rule && (rule.title || rule.name)).trim()
      const key = jobName.toUpperCase()

      if (!key || existingAs400JobNames.has(key)) return

      as400Rows.push({
        jobName,
        name: jobName,
        source: 'as400',
        type: 'as400',
        status: 'pending',
        reason: 'Pendiente recepción',
        detail: 'Pendiente recepción',
        duration: '',
        durationMs: null,
        durationTrend: null,
        lastRun: null,
        lastResult: -1,
        endTimeDisplay: '',
        hasLog: true,
        logAvailable: true,
        hasEmailLog: true,
        emailLogAvailable: true,
        canOpenLog: true,
        logIcon: true,
      })

      existingAs400JobNames.add(key)
    })
  }

  ensureAs400CatalogFromRules()

  // Catálogo obligatorio AS400
  const forcedAs400Jobs = ['Backup SD', 'Backup PR', 'Backup RR', 'Backup SDB/TGT']

  forcedAs400Jobs.forEach((jobName) => {
    const key = jobName.toUpperCase()
    const normalizedName = normalizeJobNameForRule(jobName)
    const isPrRr = normalizedName === 'BACKUP PR' || normalizedName === 'BACKUP RR'
    const weekendWindow = isWeekendOperationalWindow(inicio)

    if (existingAs400JobNames.has(key)) return

    as400Rows.push({
      jobName,
      name: jobName,
      source: 'as400',
      type: 'as400',

      // PR/RR en fin de semana existen para Directorio, pero no computan como pendientes.
      status: isPrRr && weekendWindow ? 'no-run' : 'pending',
      reason: isPrRr && weekendWindow ? 'Sin ejecución' : 'Pendiente recepción',
      detail: isPrRr && weekendWindow ? 'Sin ejecución' : 'Pendiente recepción',

      duration: '',
      durationMs: null,
      durationTrend: null,
      lastRun: null,
      lastResult: -1,
      endTimeDisplay: '',
      hasLog: true,
      logAvailable: true,
      hasEmailLog: true,
      emailLogAvailable: true,
      canOpenLog: true,
      logIcon: true,
    })

    existingAs400JobNames.add(key)
  })

  const fullRows = [...sqlFullRows, ...vdcRows, ...barraRows, ...as400Rows]
    .map(sanitizeRowForFrontend)
    .map(decorateLogAvailability)
    .map(cleanRow)
    .map(applyManualOverrideFinal)
    .map(applyWeekendNoRunForAs400)
    .map(sanitizeRowForFrontend)
    .map(applyB2StateModel)
    .sort((a, b) => {
      const aTime = new Date(a.nextRun || 0).getTime()
      const bTime = new Date(b.nextRun || 0).getTime()

      if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
        return safeString(a.jobName).localeCompare(safeString(b.jobName), 'es')
      }

      if (Number.isNaN(aTime)) return 1
      if (Number.isNaN(bTime)) return -1

      return bTime - aTime
    })

  // SOLO para dashboard
  const dashboardRows = filterDashboardRows(fullRows, inicio)

  return {
    ok: true,
    ts: ahora.toISOString(),
    windowStart: inicio.toISOString(),
    windowEnd: fin.toISOString(),
    rows: dashboardRows.filter((r) => {
      const state = r.globalState || getGlobalState(r)
      return state !== 'SUCCESS' && state !== 'NO-RUN'
    }),
    fullRows,
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

    try {
      const jsonPath = process.env.BM_JSON_EXPORT_PATH || 'C:\\DashboardBackups\\backup_status.json'
      const folderPath = path.dirname(jsonPath)

      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true })
      }

      const datosParaMovil = payload.fullRows.map((r) => ({
        backup_policy_name: r.jobName,
        status: r.globalState || r.status,
        raw_status: r.status,
        result: r.lastResult,
        creation_time: r.nextRun,
        end_time: r.lastRun,
        duration: r.duration,
        reason: r.detail || r.reason,
        detail: r.detail || r.reason,
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

    const summary = getPayloadSummary(payload)

    console.log(
      `[REFRESH] OK — total=${summary.total}, ok=${summary.success}, avisos=${summary.warning}, errores=${summary.failed + summary.error}, enCurso=${summary.running}, noRun=${summary.noRun}, pendingTecnico=${summary.pending}, ${new Date().toLocaleTimeString()}`
    )

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

    const cfg = loadConfig()
    const hasSql = !!cfg?.sql
    const hasGraph = !!cfg?.graph?.tenantId

    if (!hasSql && !hasGraph) {
      console.log('[S-1] No se pudo generar informe: falta configuracion SQL o Graph')
      return false
    }

    console.log('[S-1] Forzando refresh previo al envio para sincronizar correo y dashboard...')

    const freshPayload = await runRefresh()

    if (!freshPayload?.ok || !Array.isArray(freshPayload.fullRows)) {
      console.log('[S-1] No se pudo generar informe: refresh previo no devolvio payload valido')
      return false
    }

    const data = lastPayload

    if (!data || !Array.isArray(data.fullRows)) {
      console.log('[S-1] Payload no valido despues del refresh previo')
      return false
    }

    const summary = getPayloadSummary(data)

    console.log('[S-1] Snapshot usado para email:')
    console.log('[S-1]   windowStart:', data.windowStart)
    console.log('[S-1]   windowEnd  :', data.windowEnd)
    console.log('[S-1]   ts         :', data.ts)
    console.log(
      `[S-1]   resumen    : total=${summary.total}, ok=${summary.success}, avisos=${summary.warning}, errores=${summary.failed + summary.error}, enCurso=${summary.running}, noRun=${summary.noRun}, pendingTecnico=${summary.pending}, other=${summary.other}`
    )

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

    const backupDateStr = formatBackupDateFromWindow(data.windowStart)
    const subject = `Informe Backup ${backupDateStr}`

    console.log('[S-1] Subject:', subject)

    const bodyHtml = buildEmailHtml(data)

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

    if (now.getHours() !== 17) return
    if (now.getMinutes() > 1) return
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

const distPath = path.join(__dirname, 'dist')

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
} else {
  console.warn('⚠️  Carpeta dist/ no encontrada. Ejecuta "npm run build" primero.')
}

// ─── Middleware de autenticación ────────────────────────────────────────────

async function authMiddleware(req, res, next) {
  if (!req.path.startsWith('/api/')) return next()

  const header = req.headers.authorization || ''
  const bearerToken = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : ''

  const queryToken = req.query?.token || ''

  if (AUTH_TOKEN && (bearerToken === AUTH_TOKEN || queryToken === AUTH_TOKEN)) {
    return next()
  }

  try {
    if (bearerToken) {
      const decoded = await verifyEntraToken(bearerToken)
      req.entraUser = decoded
      return next()
    }
  } catch {
    // Si no valida como Entra, cae al 401.
  }

  return res.status(401).json({
    ok: false,
    error: 'No autorizado',
  })
}

app.use(authMiddleware)

// ─── API Endpoints ──────────────────────────────────────────────────────────

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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    lastRefresh: lastRefreshTime,
    totalJobs: lastPayload?.fullRows?.length ?? 0,
    mode: isElectron ? 'electron' : 'express',
    dailyReportLastSent: getLastDailyReportDate(),
    summary: getPayloadSummary(lastPayload),
    windowStart: lastPayload?.windowStart || null,
    windowEnd: lastPayload?.windowEnd || null,
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
    console.log('  BackupMonitor Server v5.0')
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
      console.log('  BackupMonitor Server v5.0')
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
