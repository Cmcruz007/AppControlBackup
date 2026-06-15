const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { randomUUID } = require('crypto')
const mssql = require('mssql')

// ─── Rutas de configuración ────────────────────────────────────────────────
// Config PRIVADA: credenciales SQL y Graph, cifrada por usuario Windows
const PRIVATE_CONFIG_FILE = () => path.join(app.getPath('userData'), 'config-private.enc')

// Config COMPARTIDA: jobs VDC/Barracuda/AS400 y criticidades, JSON plano en red
// Cambia esta ruta a la carpeta compartida del servidor, por ejemplo:
// '\\DASHBOARD\AppControlBackup\config-shared.json'
// O define la variable de entorno SHARED_CONFIG_PATH al arrancar la app.
const SHARED_CONFIG_FILE = () =>
  process.env.SHARED_CONFIG_PATH ||
  path.join(app.getPath('userData'), 'config-shared.json')

// Campos que van a cada fichero
const PRIVATE_KEYS = ['sql', 'graph', 'refreshMinutes', 'toleranceMinutes', 'pin', 'manualOverrides']
const SHARED_KEYS  = ['criticalityByJob', 'veeamDataCloudRules', 'barracudaRules', 'as400Rules']
// ───────────────────────────────────────────────────────────────────────────

let mainWin = null
let sqlPoolPromise = null
let sqlPoolKey = null
let refreshIntervalId = null

function safeLower(value) {
  if (value == null) return ''
  return String(value).toLowerCase()
}

function normalizeCriticality(value) {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low'
}

function normalizeManualStatus(value) {
  return ['success', 'warning', 'failed', 'running', 'pending'].includes(value) ? value : undefined
}

function logGraphError(message, extra = {}) {
  try {
    const dir = app.getPath('userData')
    const file = path.join(dir, 'graph-debug.log')
    const line = `[${new Date().toISOString()}] ${message} ${JSON.stringify(extra)}\n`
    fs.appendFileSync(file, line, 'utf8')
  } catch (err) {
    try {
      const fallback = path.join(process.cwd(), 'graph-debug.log')
      const line = `[${new Date().toISOString()}] LOG_WRITE_FAIL ${message} ${JSON.stringify({
        extra,
        writeError: err?.message || String(err),
      })}\n`
      fs.appendFileSync(fallback, line, 'utf8')
    } catch (_) {}
  }
}

function normalizeVdcRule(rule, index = 0, prefix = 'vdc') {
  return {
    id: String(rule?.id || `${prefix}-rule-${index + 1}`),
    title: String(rule?.title || '').trim(),
    sender: String(rule?.sender || '').trim(),
    subjectContains: String(rule?.subjectContains || '').trim(),
    errorWord: String(rule?.errorWord || '').trim(),
    successWord: String(rule?.successWord || '').trim(),
    enabled: rule?.enabled !== false,
  }
}

function normalizeAs400Rule(rule, index = 0) {
  return {
    id: String(rule?.id || `as400-rule-${index + 1}`),
    title: String(rule?.title || rule?.name || '').trim(),
    name: String(rule?.name || rule?.title || '').trim(),
    sender: String(rule?.sender || '').trim(),
    subjectContains: String(rule?.subjectContains || '').trim(),
    pattern: String(rule?.pattern || rule?.subjectContains || '').trim(),
    errorWord: String(rule?.errorWord || '').trim(),
    successWord: String(rule?.successWord || '').trim(),
    enabled: rule?.enabled !== false,
    notes: String(rule?.notes || '').trim(),
  }
}

function includesCI(text, search) {
  if (!text || !search) return false
  const t = String(text).toLowerCase()
  const s = String(search).trim().toLowerCase()

  if (s.startsWith('regex:')) {
    try {
      const pattern = s.substring(6).trim()
      const rx = new RegExp(pattern, 'i')
      return rx.test(t)
    } catch (e) {
      return false
    }
  }
  return t.includes(s)
}

function normalizeVdcRules(rules) {
  const list = Array.isArray(rules) ? rules : []
  return list.slice(0, 100).map((rule, index) => normalizeVdcRule(rule, index))
}

function isValidDate(value) {
  if (!(value instanceof Date)) return false
  return !Number.isNaN(value.getTime()) && value.getFullYear() > 1970
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toDateOrNull(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return isValidDate(d) ? d : null
}

function formatDisplayTime(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (!isValidDate(d)) return ''
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function formatDurationMs(ms) {
  if (ms == null || typeof ms !== 'number' || Number.isNaN(ms) || !Number.isFinite(ms) || ms < 0) {
    return ''
  }

  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  }
  return `${pad2(minutes)}:${pad2(seconds)}`
}

function isExcludedJobName(name) {
  if (!name || typeof name !== 'string') {
    if (name == null) return true
    name = String(name)
  }

  const n = name.trim().toLowerCase()
  const blocked = [
    'host discovery',
    'shell run',
    'checkpoint removal',
    'infrastructure rescan',
    'malware detection',
    'security & compliance analyzer',
  ]

  return blocked.some((x) => n === x || n.includes(x))
}

function jobBasename(name) {
  if (!name) return ''
  const safeName = String(name)
  const parts = safeName.split('\\')
  return parts[0] ? parts[0].trim().toLowerCase() : ''
}

function normalizePlannerText(value) {
  if (!value || typeof value !== 'string') return ''
  try {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
  } catch (e) {
    return ''
  }
}

function getCopySourceKey(jobName) {
  if (!jobName || typeof jobName !== 'string') return ''
  const name = normalizePlannerText(jobName)
  if (!name || typeof name !== 'string' || typeof name.indexOf !== 'function') return ''

  const idxDesde = name.indexOf(' desde ')
  if (idxDesde > 0) return name.slice(0, idxDesde).trim()

  const withoutCopySuffix = name
    .replace(/\s*\(copy\)\s*\d*$/i, '')
    .replace(/\s*copy\s*\d*$/i, '')
    .trim()

  if (withoutCopySuffix !== name) return withoutCopySuffix
  return ''
}

function getPrimaryLinkKeys(jobName) {
  const name = normalizePlannerText(jobName)
  const keys = new Set()
  if (!name || typeof name !== 'string' || name.trim() === '') return []

  keys.add(name)

  if (typeof name.split === 'function') {
    const parts = name.split(' - ')
    const firstDash = parts[0] ? parts[0].trim() : null
    if (firstDash) keys.add(firstDash)
  }

  return [...keys].filter(Boolean)
}

function isBackupCopyJob(job) {
  if (!job) return false

  const name = String(job.name || '')
  const normalizedName = normalizePlannerText(name)
  const options = String(job.options_xml || '')

  return (
    Number(job.type) === 65 ||
    /<BackupCopyOptions\b/i.test(options) ||
    /<IsBackupCopySimpleMode>/i.test(options) ||
    /\(copy\)\s*\d*$/i.test(name) ||
    /\bbackup copy\b/i.test(normalizedName)
  )
}

function pickBestPrimaryMatch(sourceKey, candidates) {
  if (!sourceKey || !Array.isArray(candidates) || !candidates.length) return null
  const validCandidates = candidates.filter((c) => c && c.name)
  if (!validCandidates.length) return null
  const exactShort = [...validCandidates].sort((a, b) => String(a.name).length - String(b.name).length)
  return exactShort[0] || null
}

function findParentJobForCopy(copyJob, primaryJobs, primaryIndex) {
  if (!copyJob || !copyJob.name) return null

  const sourceKey = getCopySourceKey(copyJob.name)
  if (!sourceKey) return null

  const directCandidates =
    primaryIndex && typeof primaryIndex.get === 'function'
      ? primaryIndex.get(sourceKey) || []
      : []

  const direct = pickBestPrimaryMatch(sourceKey, directCandidates)
  if (direct) return direct

  const safePrimaryJobs = Array.isArray(primaryJobs) ? primaryJobs : []

  const fuzzyCandidates = safePrimaryJobs.filter((p) => {
    if (!p || !p.name) return false
    const full = normalizePlannerText(p.name)
    const keys = getPrimaryLinkKeys(p.name)
    return full.startsWith(sourceKey) || keys.includes(sourceKey)
  })

  return pickBestPrimaryMatch(sourceKey, fuzzyCandidates)
}

function buildPrimaryJobIndex(primaryJobs) {
  const index = new Map()

  for (const p of primaryJobs) {
    if (!p || !p.name) continue
    const keys = getPrimaryLinkKeys(p.name)
    for (const k of keys) {
      if (!index.has(k)) index.set(k, [])
      index.get(k).push(p)
    }
  }

  return index
}

function loadConfig() {
  // Carga config PRIVADA (cifrada, local de cada usuario)
  let priv = {}
  try {
    if (fs.existsSync(PRIVATE_CONFIG_FILE())) {
      const encrypted = fs.readFileSync(PRIVATE_CONFIG_FILE())
      priv = JSON.parse(safeStorage.decryptString(encrypted))
    } else if (fs.existsSync(path.join(app.getPath('userData'), 'config.enc'))) {
      const encrypted = fs.readFileSync(path.join(app.getPath('userData'), 'config.enc'))
      const old = JSON.parse(safeStorage.decryptString(encrypted))
      priv = {}
      PRIVATE_KEYS.forEach(k => { if (old[k] !== undefined) priv[k] = old[k] })
      console.log('Migración: config.enc → config-private.enc')
    }
  } catch (e) {
    console.error('Error cargando config privada:', e)
  }

  // Carga config COMPARTIDA (JSON plano, servidor)
  let shared = {}
  try {
    const sharedFile = SHARED_CONFIG_FILE()
    if (fs.existsSync(sharedFile)) {
      shared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'))
    } else if (fs.existsSync(path.join(app.getPath('userData'), 'config.enc'))) {
      const encrypted = fs.readFileSync(path.join(app.getPath('userData'), 'config.enc'))
      const old = JSON.parse(safeStorage.decryptString(encrypted))
      SHARED_KEYS.forEach(k => { if (old[k] !== undefined) shared[k] = old[k] })
      console.log('Migración: config.enc → config-shared.json')
    }
  } catch (e) {
    console.error('Error cargando config compartida:', e)
  }

  return { ...priv, ...shared }
}

function saveConfig(cfg) {
  let oldPriv = {}
  let oldShared = {}

  try {
    if (fs.existsSync(PRIVATE_CONFIG_FILE())) {
      const encrypted = fs.readFileSync(PRIVATE_CONFIG_FILE())
      oldPriv = JSON.parse(safeStorage.decryptString(encrypted))
    }
  } catch (e) {
    console.error('Error leyendo config privada anterior:', e)
  }

  try {
    const sharedFile = SHARED_CONFIG_FILE()
    if (fs.existsSync(sharedFile)) {
      oldShared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'))
    }
  } catch (e) {
    console.error('Error leyendo config compartida anterior:', e)
  }

  const newPriv = { ...oldPriv }
  PRIVATE_KEYS.forEach(k => {
    if (cfg[k] !== undefined) newPriv[k] = cfg[k]
  })
  newPriv.manualOverrides = {
    ...(oldPriv.manualOverrides || {}),
    ...(cfg.manualOverrides || {}),
  }

  const hasCriticalityIncoming = cfg && typeof cfg.criticalityByJob === 'object' && cfg.criticalityByJob !== null
  const newShared = {
    ...oldShared,
    criticalityByJob: hasCriticalityIncoming
      ? { ...cfg.criticalityByJob }
      : (oldShared.criticalityByJob || {}),
    veeamDataCloudRules: cfg.veeamDataCloudRules !== undefined
      ? cfg.veeamDataCloudRules
      : (oldShared.veeamDataCloudRules || []),
    barracudaRules: cfg.barracudaRules !== undefined
      ? cfg.barracudaRules
      : (oldShared.barracudaRules || []),
    as400Rules: cfg.as400Rules !== undefined
      ? cfg.as400Rules
      : (oldShared.as400Rules || []),
  }

  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(newPriv))
    fs.writeFileSync(PRIVATE_CONFIG_FILE(), encrypted)
  } catch (e) {
    console.error('Error escribiendo config privada:', e)
    return false
  }

  try {
    const sharedFile = SHARED_CONFIG_FILE()
    const sharedDir = path.dirname(sharedFile)
    if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true })
    fs.writeFileSync(sharedFile, JSON.stringify(newShared, null, 2), 'utf8')
    console.log('GUARDADO EXITOSO. criticalityByJob:', JSON.stringify(newShared.criticalityByJob))
  } catch (e) {
    console.error('Error escribiendo config compartida:', e)
    return false
  }

  return true
}

function buildMssqlConfig(sqlCfg) {
  const rawUser = String(sqlCfg?.user || '')
  const isDomainUser = rawUser.includes('\\')
  const [domain, userName] = isDomainUser ? rawUser.split('\\') : [undefined, undefined]

  return {
    server: sqlCfg.host,
    port: Number(sqlCfg.port) || 1433,
    database: sqlCfg.database || 'VeeamBackup',
    user: isDomainUser ? undefined : rawUser,
    password: isDomainUser ? undefined : sqlCfg.password,
    authentication: isDomainUser
      ? {
          type: 'ntlm',
          options: {
            domain,
            userName,
            password: sqlCfg.password,
          },
        }
      : undefined,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      useUTC: false,
    },
    connectionTimeout: 15000,
    requestTimeout: 30000,
  }
}

function getSqlPoolCacheKey(sqlCfg) {
  return JSON.stringify({
    host: sqlCfg?.host || '',
    port: Number(sqlCfg?.port) || 1433,
    database: sqlCfg?.database || 'VeeamBackup',
    user: sqlCfg?.user || '',
    password: sqlCfg?.password || '',
  })
}

async function closeCachedSqlPool() {
  const currentPromise = sqlPoolPromise
  sqlPoolPromise = null
  sqlPoolKey = null

  if (!currentPromise) return

  try {
    const pool = await currentPromise
    if (pool && (pool.connected || pool.connecting)) {
      await pool.close()
    }
  } catch (_) {}
}

async function getSqlPool(sqlCfg) {
  const nextKey = getSqlPoolCacheKey(sqlCfg)

  if (!sqlPoolPromise || sqlPoolKey !== nextKey) {
    await closeCachedSqlPool()

    sqlPoolKey = nextKey
    sqlPoolPromise = new mssql.ConnectionPool(buildMssqlConfig(sqlCfg))
      .connect()
      .then((pool) => {
        pool.on('error', async () => {
          if (sqlPoolPromise) {
            try {
              const p = await sqlPoolPromise
              if (p === pool) {
                sqlPoolPromise = null
                sqlPoolKey = null
              }
            } catch (_) {
              sqlPoolPromise = null
              sqlPoolKey = null
            }
          }
        })
        return pool
      })
      .catch((err) => {
        sqlPoolPromise = null
        sqlPoolKey = null
        throw err
      })
  }
  const pool = await sqlPoolPromise

  if (!pool.connected) {
    sqlPoolPromise = null
    sqlPoolKey = null
    throw new Error('Conexión SQL perdida.')
  }

  return pool
}

async function withTempSqlPool(sqlCfg, fn) {
  const pool = new mssql.ConnectionPool(buildMssqlConfig(sqlCfg))
  await pool.connect()
  try {
    return await fn(pool)
  } finally {
    try {
      await pool.close()
    } catch (_) {}
  }
}

async function getGraphToken(graphCfg) {
  const authUrl = `https://login.microsoftonline.com/${graphCfg.tenantId}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: graphCfg.clientId,
    client_secret: graphCfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })

  const resAuth = await fetch(authUrl, { method: 'POST', body })
  const authJson = await resAuth.json()

  if (!resAuth.ok) {
    logGraphError('GRAPH_TOKEN_HTTP_ERROR', {
      status: resAuth.status,
      body: authJson,
    })
    throw new Error(`Graph OAuth HTTP ${resAuth.status}: ${JSON.stringify(authJson)}`)
  }

  if (!authJson.access_token) {
    logGraphError('GRAPH_TOKEN_MISSING', { body: authJson })
    throw new Error(`No se pudo obtener token OAuth: ${JSON.stringify(authJson)}`)
  }

  return authJson.access_token
}

async function getEmailsInRange(cfg, inicio, fin) {
  if (!cfg?.graph?.tenantId) {
    throw new Error('Falta configuración de Microsoft Graph (tenantId).')
  }

  const g = cfg.graph
  const token = await getGraphToken(g)

  const filter = `receivedDateTime ge ${inicio.toISOString()} and receivedDateTime lt ${fin.toISOString()}`
  const params = new URLSearchParams({
    $filter: filter,
    $select: 'id,subject,receivedDateTime,bodyPreview,sender,from,hasAttachments',
    $top: '200',
    $orderby: 'receivedDateTime desc',
  })

  let nextUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(g.mailbox)}/messages?${params.toString()}`
  const all = []

  while (nextUrl) {
    const resMail = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    })

    const mailData = await resMail.json()

    if (!resMail.ok) {
      logGraphError('GRAPH_LIST_MESSAGES_HTTP_ERROR', {
        status: resMail.status,
        mailbox: g.mailbox,
        body: mailData,
        inicio: inicio.toISOString(),
        fin: fin.toISOString(),
      })
      throw new Error(`Graph list messages HTTP ${resMail.status}: ${JSON.stringify(mailData)}`)
    }

    all.push(...(mailData.value || []))
    nextUrl = mailData['@odata.nextLink'] || null

    if (all.length >= 2000) break
  }

  return all
}

async function getEmails(cfg) {
  const hours = Math.max(1, Number(cfg?.graph?.sinceHours) || 24)
  const fin = new Date()
  const inicio = new Date(fin.getTime() - hours * 60 * 60 * 1000)
  return getEmailsInRange(cfg, inicio, fin)
}

async function fetchAs400Attachment(cfg, messageId) {
  if (!cfg?.graph?.tenantId || !messageId) return null
  try {
    const token = await getGraphToken(cfg.graph)
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.graph.mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      logGraphError('AS400_ATTACHMENT_ERROR', { status: res.status, messageId })
      return null
    }
    const data = await res.json()
    const attachments = data.value || []
    const file = attachments.find((a) => a.contentType && a.contentType.includes('text')) || attachments.find((a) => a.contentBytes)
    if (file && file.contentBytes) {
      return Buffer.from(file.contentBytes, 'base64').toString('utf8')
    }
  } catch (e) {
    logGraphError('AS400_ATTACHMENT_EXCEPTION', { message: e?.message, messageId })
  }
  return null
}

async function sendGraphEmail(cfg, { to, cc, bcc, subject, bodyHtml }) {
  const g = cfg?.graph
  if (!g?.tenantId) {
    throw new Error('Falta configuración de Microsoft Graph.')
  }

  const parseRecipients = (value) => {
    if (Array.isArray(value)) {
      return value.map((x) => String(x).trim()).filter(Boolean)
    }

    return String(value || '')
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean)
  }

  const toList = parseRecipients(to)
  const ccList = parseRecipients(cc)
  const bccList = parseRecipients(bcc)

  if (!toList.length) throw new Error('No hay destinatarios válidos en "Para".')

  const mapRecipients = (list) => list.map((address) => ({ emailAddress: { address } }))
  const accessToken = await getGraphToken(g)
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(g.mailbox)}/sendMail`

  const res = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: bodyHtml },
        toRecipients: mapRecipients(toList),
        ccRecipients: mapRecipients(ccList),
        bccRecipients: mapRecipients(bccList),
      },
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    logGraphError('GRAPH_SENDMAIL_HTTP_ERROR', {
      status: res.status,
      mailbox: g.mailbox,
      body: errBody,
    })
    throw new Error(`Graph sendMail HTTP ${res.status}: ${errBody}`)
  }

  return true
}

async function sqlFindCompatibleSessionsTable(pool) {
  const candidates = [
    'Backup.Model.BackupJobSessions',
    'Backup.Model.JobSessions',
    'BackupJobSessions',
    'BSessions',
  ]
  const inList = candidates.map((x) => `'${x.replace(/'/g, "''")}'`).join(', ')

  const tablesRes = await pool
    .request()
    .query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN (${inList})`)

  const available = tablesRes.recordset.map((r) => r.TABLE_NAME)
  if (!available.length) throw new Error('No se encontró ninguna tabla candidata de sesiones.')

  const colsRes = await pool.request().query(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME IN (${inList})
  `)

  const colsByTable = new Map()
  for (const row of colsRes.recordset) {
    if (!colsByTable.has(row.TABLE_NAME)) colsByTable.set(row.TABLE_NAME, new Set())
    colsByTable.get(row.TABLE_NAME).add(String(row.COLUMN_NAME).toLowerCase())
  }

  const required = ['job_id', 'creation_time', 'end_time', 'result']
  for (const tName of candidates) {
    if (!available.includes(tName)) continue
    const cols = colsByTable.get(tName) || new Set()
    if (required.every((c) => cols.has(c))) return tName
  }

  const detail = candidates
    .filter((t) => available.includes(t))
    .map((t) => `${t}: ${[...(colsByTable.get(t) || new Set())].join(', ')}`)
    .join(' | ')

  throw new Error('No se encontró tabla sesiones compatible. ' + detail)
}

async function sqlGetSessionsInRange(sqlCfg, inicio, fin) {
  const pool = await getSqlPool(sqlCfg)
  const tName = await sqlFindCompatibleSessionsTable(pool)

  const req = pool.request()
  req.input('inicio', mssql.DateTime, inicio)
  req.input('fin', mssql.DateTime, fin)

  const result = await req.query(`
    SELECT 
      s.job_id, 
      s.creation_time, 
      s.end_time, 
      s.result, 
      j.name AS job_name,
      CASE 
        WHEN prev.prev_duration_sec IS NULL OR prev.prev_duration_sec = 0 OR curr.curr_duration_sec IS NULL THEN 'same'
        WHEN (curr.curr_duration_sec - prev.prev_duration_sec) * 1.0 / prev.prev_duration_sec > 0.2 THEN 'up'
        WHEN (curr.curr_duration_sec - prev.prev_duration_sec) * 1.0 / prev.prev_duration_sec < -0.2 THEN 'down'
        ELSE 'same'
      END AS durationTrend
    FROM [dbo].[${tName}] s WITH (NOLOCK)
    INNER JOIN [dbo].[BJobs] j WITH (NOLOCK) ON j.id = s.job_id
    
    OUTER APPLY (
        SELECT 
          CASE 
            WHEN s.end_time IS NOT NULL AND YEAR(s.end_time) > 2000 AND s.end_time > s.creation_time 
            THEN DATEDIFF(SECOND, s.creation_time, s.end_time) 
            ELSE NULL 
          END AS curr_duration_sec
    ) curr
    
    OUTER APPLY (
        SELECT TOP 1 DATEDIFF(SECOND, s2.creation_time, s2.end_time) AS prev_duration_sec
        FROM [dbo].[${tName}] s2 WITH (NOLOCK)
        WHERE s2.job_id = s.job_id 
          AND s2.creation_time < s.creation_time
          AND s2.end_time IS NOT NULL 
          AND YEAR(s2.end_time) > 2000
          AND s2.end_time > s2.creation_time 
        ORDER BY s2.creation_time DESC
    ) prev
    
    WHERE s.creation_time >= @inicio AND s.creation_time < @fin
    ORDER BY s.creation_time DESC
  `)

  return (result.recordset || []).filter((r) => !isExcludedJobName(r.job_name))
}

async function sqlGetJobExecutions(sqlCfg, jobName, limit = 200) {
  const pool = await getSqlPool(sqlCfg)
  const tName = await sqlFindCompatibleSessionsTable(pool)
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200))

  const req = pool.request()
  let whereClause = ''

  if (jobName) {
    req.input('jobName', mssql.NVarChar, jobName)
    whereClause = 'WHERE j.name = @jobName'
  }

  const query = `
    SELECT TOP (${safeLimit}) s.job_id, s.creation_time AS creationtime, s.end_time AS endtime, s.result, j.name AS jobname
    FROM [dbo].[${tName}] AS s WITH (NOLOCK)
    INNER JOIN [dbo].[BJobs] AS j WITH (NOLOCK) ON j.id = s.job_id
    ${whereClause}
    ORDER BY s.creation_time DESC
  `

  const result = await req.query(query)

  const executions = (result.recordset || []).map((r, index) => {
    const start = toDateOrNull(r.creationtime)
    const end = toDateOrNull(r.endtime)

    let status = 'running'
    if (r.result === 0) status = 'success'
    else if (r.result === 1) status = 'warning'
    else if (r.result === 2) status = 'failed'

    const durationMs = start && isValidDate(end) ? end.getTime() - start.getTime() : null

    return {
      id: `${r.jobname}-${start ? start.getTime() : index}`,
      jobName: r.jobname,
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
      startDisplay: formatDisplayTime(start),
      endDisplay: formatDisplayTime(end),
      duration: formatDurationMs(durationMs),
      status,
      result: r.result ?? null,
    }
  })

  return {
    ok: true,
    jobName: jobName || 'Todos los Jobs',
    totalExecutions: executions.length,
    executions,
  }
}

async function sqlGetAvailableDays(sqlCfg) {
  const pool = await getSqlPool(sqlCfg)
  const tName = await sqlFindCompatibleSessionsTable(pool)

  const result = await pool.request().query(`
    SELECT DISTINCT CONVERT(date, DATEADD(hour, -18, creation_time)) AS ventana_date
    FROM [dbo].[${tName}] WITH (NOLOCK)
    ORDER BY ventana_date DESC
  `)

  return result.recordset.map((r) => {
    const d = new Date(r.ventana_date)
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  })
}

async function sqlGetScheduleJobs(sqlCfg) {
  const pool = await getSqlPool(sqlCfg)
  const result = await pool.request().query(`
    SELECT name, type, target_type, job_source_type, CAST(options AS NVARCHAR(MAX)) AS options_xml, CAST(schedule AS NVARCHAR(MAX)) AS schedule_xml
    FROM [dbo].[BJobs] WITH (NOLOCK)
    WHERE is_deleted = 0 AND schedule_enabled = 1 AND schedule IS NOT NULL
    ORDER BY name
  `)

  return (result.recordset || []).filter((r) => !isExcludedJobName(r.name))
}

async function sqlListJobs(sqlCfg) {
  const pool = await getSqlPool(sqlCfg)
  const result = await pool
    .request()
    .query(`SELECT name FROM [dbo].[BJobs] WITH (NOLOCK) WHERE ISNULL(is_deleted, 0) = 0 ORDER BY name`)

  return (result.recordset || [])
    .map((r) => r.name)
    .filter(Boolean)
    .filter((name) => !isExcludedJobName(name))
}

function tagVal(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

function blockContent(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? m[1] : null
}

function isEnabled(block) {
  if (!block) return false
  return safeLower(tagVal(block, 'Enabled')) === 'true'
}

function parseTime(block) {
  const t =
    tagVal(block, 'Time') ||
    tagVal(block, 'StartTime') ||
    tagVal(block, 'TimeOfDay') ||
    tagVal(block, 'DailyTime') ||
    tagVal(block, 'StartDateTime') ||
    ''

  const m = t.match(/T(\d{2}):(\d{2})/) || t.match(/(\d{2}):(\d{2})/)
  return m ? { h: parseInt(m[1], 10), m: parseInt(m[2], 10) } : { h: 22, m: 0 }
}

function parseIntSafe(value, fallback) {
  const n = parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

const DOW_MAP = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
}

const MONTH_MAP = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
}

const NTH_MAP = {
  First: 1,
  Second: 2,
  Third: 3,
  Fourth: 4,
  Last: -1,
}

function nthWeekdayOfMonth(year, month, dow, nth) {
  if (nth === -1) {
    const lastDay = new Date(year, month + 1, 0)
    let d = lastDay.getDate()
    while (new Date(year, month, d).getDay() !== dow) d--
    return new Date(year, month, d)
  }

  let count = 0
  for (let d = 1; d <= 31; d++) {
    const candidate = new Date(year, month, d)
    if (candidate.getMonth() !== month) break
    if (candidate.getDay() === dow) {
      count++
      if (count === nth) return candidate
    }
  }

  return null
}

function extractWeekDays(block) {
  const days = [
    ...String(block || '').matchAll(/<DayOfWeek[^>]*>([\s\S]*?)<\/DayOfWeek>/gi),
    ...String(block || '').matchAll(/<EWeekDay[^>]*>([\s\S]*?)<\/EWeekDay>/gi),
  ]
    .map((x) => String(x[1] || '').trim())
    .map((x) => DOW_MAP[x])
    .filter((x) => x !== undefined)

  return Array.from(new Set(days))
}

function extractMonths(block) {
  const months = [
    ...String(block || '').matchAll(/<EMonth[^>]*>([\s\S]*?)<\/EMonth>/gi),
    ...String(block || '').matchAll(
      /<Month[^>]*>(January|February|March|April|May|June|July|August|September|October|November|December)<\/Month>/gi
    ),
  ]
    .map((x) => String(x[1] || '').trim())
    .map((x) => MONTH_MAP[x])
    .filter((x) => x !== undefined)

  return Array.from(new Set(months))
}

function parseScheduleXml(xml, jobName = '') {
  if (!xml) return null

  const monthlyBlock = blockContent(xml, 'OptionsMonthly')
  if (monthlyBlock && isEnabled(monthlyBlock)) {
    const tm = parseTime(monthlyBlock)
    const dayNumberInMonth =
      tagVal(monthlyBlock, 'DayNumberInMonth') ||
      tagVal(monthlyBlock, 'WeekNumberInMonth') ||
      'OnDay'
    const months = extractMonths(monthlyBlock)

    if (dayNumberInMonth === 'OnDay') {
      const domBlock = blockContent(monthlyBlock, 'DayOfMonth') || monthlyBlock
      const dom =
        parseIntSafe(tagVal(domBlock, 'Day'), NaN) ||
        parseIntSafe(tagVal(monthlyBlock, 'Day'), 1)

      return {
        type: 'monthly',
        hour: tm.h,
        minute: tm.m,
        dayOfMonth: Number.isNaN(dom) ? 1 : dom,
        months: months.length ? months : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      }
    }

    const nth = NTH_MAP[dayNumberInMonth] ?? 1
    const dowStr = tagVal(monthlyBlock, 'DayOfWeek') || tagVal(monthlyBlock, 'WeekDay') || 'Monday'

    return {
      type: 'monthly-nth',
      hour: tm.h,
      minute: tm.m,
      nth,
      dow: DOW_MAP[dowStr] ?? 1,
      months: months.length ? months : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    }
  }

  const dailyBlock = blockContent(xml, 'OptionsDaily')
  if (dailyBlock && isEnabled(dailyBlock)) {
    const tm = parseTime(dailyBlock)
    const kind = tagVal(dailyBlock, 'Kind') || 'Everyday'

    if (kind === 'SelectedDays') {
      return {
        type: 'weekly',
        hour: tm.h,
        minute: tm.m,
        weekDays: extractWeekDays(dailyBlock).length ? extractWeekDays(dailyBlock) : [1],
      }
    }

    if (kind === 'Weekdays') {
      return { type: 'weekly', hour: tm.h, minute: tm.m, weekDays: [1, 2, 3, 4, 5] }
    }

    return { type: 'daily', hour: tm.h, minute: tm.m }
  }

  const weeklyBlock = blockContent(xml, 'OptionsWeekly')
  if (weeklyBlock && isEnabled(weeklyBlock)) {
    const tm = parseTime(weeklyBlock)
    return {
      type: 'weekly',
      hour: tm.h,
      minute: tm.m,
      weekDays: extractWeekDays(weeklyBlock).length ? extractWeekDays(weeklyBlock) : [1],
    }
  }

  const periodicBlock = blockContent(xml, 'OptionsPeriodically')
  if (periodicBlock && isEnabled(periodicBlock)) {
    return {
      type: 'periodically',
      intervalMs: parseIntSafe(tagVal(periodicBlock, 'FullPeriod'), 3600) * 1000,
    }
  }

  const continuousBlock = blockContent(xml, 'OptionsContinuous')
  if (continuousBlock && isEnabled(continuousBlock)) {
    return {
      type: 'periodically',
      intervalMs:
        (parseIntSafe(tagVal(continuousBlock, 'FullPeriod'), NaN) ||
          parseIntSafe(tagVal(continuousBlock, 'Period'), NaN) ||
          3600) * 1000,
    }
  }

  const rawXml = String(xml || '')
  const fallbackTime = parseTime(rawXml)
  const weekdays = []

  if (/<Monday>true<\/Monday>/i.test(rawXml)) weekdays.push(1)
  if (/<Tuesday>true<\/Tuesday>/i.test(rawXml)) weekdays.push(2)
  if (/<Wednesday>true<\/Wednesday>/i.test(rawXml)) weekdays.push(3)
  if (/<Thursday>true<\/Thursday>/i.test(rawXml)) weekdays.push(4)
  if (/<Friday>true<\/Friday>/i.test(rawXml)) weekdays.push(5)
  if (/<Saturday>true<\/Saturday>/i.test(rawXml)) weekdays.push(6)
  if (/<Sunday>true<\/Sunday>/i.test(rawXml)) weekdays.push(0)

  const nameMonthly =
    String(jobName).match(/\bDIA\s*0?(\d{1,2})\b/i) ||
    String(jobName).match(/\bD[IÍ]A\s*0?(\d{1,2})\b/i)

  const xmlMonthlyCandidates = [
    tagVal(rawXml, 'DayOfMonth'),
    tagVal(rawXml, 'MonthDay'),
    tagVal(rawXml, 'DayNumberInMonth'),
    tagVal(rawXml, 'Day'),
    tagVal(rawXml, 'DayOfWeekInMonth'),
  ]
    .map((v) => {
      const m = String(v || '').match(/\b(\d{1,2})\b/)
      return m ? Number(m[1]) : null
    })
    .filter((v) => Number.isInteger(v) && v >= 1 && v <= 31)

  const monthlyDay =
    xmlMonthlyCandidates.length > 0
      ? xmlMonthlyCandidates[0]
      : nameMonthly
      ? Number(nameMonthly[1])
      : null

  if ((/<Monthly/i.test(rawXml) || /\bMENSUAL\b/i.test(jobName)) && monthlyDay) {
    return {
      type: 'monthly',
      hour: fallbackTime.h,
      minute: fallbackTime.m,
      dayOfMonth: monthlyDay,
      months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    }
  }

  if (/<Weekly/i.test(rawXml) || weekdays.length > 0) {
    return {
      type: 'weekly',
      hour: fallbackTime.h,
      minute: fallbackTime.m,
      weekDays: weekdays.length ? weekdays : [1],
    }
  }

  if (/<Daily/i.test(rawXml) || /\bDIARIO\b/i.test(jobName)) {
    return { type: 'daily', hour: fallbackTime.h, minute: fallbackTime.m }
  }

  return null
}

function floorToMinute(d) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function startOfToday(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function pushIfInRange(result, jobName, candidate, now, limit) {
  if (candidate >= now && candidate <= limit) {
    result.push({ job: jobName, date: new Date(candidate) })
  }
}

function expandSchedule30(jobName, scheduleXml, nowArg = new Date()) {
  try {
    const sched = parseScheduleXml(scheduleXml, jobName)
    if (!sched) return []

    const now = floorToMinute(nowArg)
    const limit = new Date(now.getTime() + 30 * 86400000)
    const result = []

    if (sched.type === 'daily') {
      let d = startOfToday(now)
      while (d <= limit) {
        const candidate = new Date(d)
        candidate.setHours(sched.hour, sched.minute, 0, 0)
        pushIfInRange(result, jobName, candidate, now, limit)
        d.setDate(d.getDate() + 1)
      }
      return result
    }

    if (sched.type === 'weekly') {
      let d = startOfToday(now)
      while (d <= limit) {
        if (sched.weekDays.includes(d.getDay())) {
          const candidate = new Date(d)
          candidate.setHours(sched.hour, sched.minute, 0, 0)
          pushIfInRange(result, jobName, candidate, now, limit)
        }
        d.setDate(d.getDate() + 1)
      }
      return result
    }

    if (sched.type === 'monthly') {
      for (let offset = 0; offset <= 3; offset++) {
        const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
        if (!sched.months.includes(base.getMonth())) continue

        const maxDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
        const candidate = new Date(
          base.getFullYear(),
          base.getMonth(),
          Math.min(sched.dayOfMonth, maxDay),
          sched.hour,
          sched.minute,
          0,
          0
        )

        pushIfInRange(result, jobName, candidate, now, limit)
      }

      return result
    }

    if (sched.type === 'monthly-nth') {
      for (let offset = 0; offset <= 3; offset++) {
        const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
        if (!sched.months.includes(base.getMonth())) continue
        const d = nthWeekdayOfMonth(base.getFullYear(), base.getMonth(), sched.dow, sched.nth)
        if (d) {
          pushIfInRange(
            result,
            jobName,
            new Date(d.getFullYear(), d.getMonth(), d.getDate(), sched.hour, sched.minute, 0, 0),
            now,
            limit
          )
        }
      }
      return result
    }

    if (sched.type === 'periodically') {
      let nextTimestamp = Math.ceil(now.getTime() / sched.intervalMs) * sched.intervalMs
      let d = new Date(nextTimestamp)
      while (d <= limit) {
        result.push({ job: jobName, date: new Date(d) })
        nextTimestamp += sched.intervalMs
        d = new Date(nextTimestamp)
      }
      return result
    }

    return []
  } catch (e) {
    return []
  }
}

function cloneEntriesWithJobName(entries, newJobName) {
  return (entries || []).map((e) => ({ job: newJobName, date: new Date(e.date) }))
}

function getOperationalWindow(baseDate = new Date()) {
  const inicio = new Date(baseDate)
  inicio.setHours(18, 0, 0, 0)
  if (baseDate.getHours() < 18) inicio.setDate(inicio.getDate() - 1)
  const fin = new Date(inicio.getTime() + 86400000)
  return { inicio, fin }
}

function buildRow(s, emails, ahora, criticalityByJob) {
  const rawStart = s.creation_time || s.creationtime || s.nextRun;
  const start = rawStart ? new Date(rawStart) : null;
  if (!start || Number.isNaN(start.getTime())) return null;

  const safeEmails = Array.isArray(emails) ? emails : [];
  const jobName = (s.job_name || s.jobname || '').trim();

  const relevantEmails = safeEmails.filter((e) => {
    if (!e || !e.subject || !jobName || !e.receivedDateTime) return false;
    return (
      String(e.subject).toLowerCase().includes(jobName.toLowerCase()) &&
      new Date(e.receivedDateTime) >= start
    );
  });

  const email = relevantEmails[0];
  const source = email ? 'both' : 'sql';

  let status = 'running';
  let reason = 'En ejecución';

  if (s.result === 0) {
    status = 'success';
    reason = 'Backup correcto';
  } else if (s.result === 1) {
    status = 'warning';
    reason = email ? 'Aviso Email' : 'Aviso SQL';
  } else if (s.result === 2) {
    status = 'failed';
    reason = email ? 'Error Email' : 'Error SQL';
  } else if (s.result === -1) {
    status = 'success';
    reason = 'Backup continuo (Correcto)';
  }

  const rawEnd = email?.receivedDateTime || s.end_time || s.endtime || s.lastRun;
  let puntoFinal = rawEnd ? new Date(rawEnd) : null;

  if (puntoFinal && puntoFinal.getFullYear() < 2000) {
    puntoFinal = null;
  }

  if (puntoFinal && status === 'running') {
    status = 'warning';
    reason = `Finalizado sin código (cód: ${s.result ?? 'desc'})`;
  }

  let durationMs = null;
  if (puntoFinal && !Number.isNaN(puntoFinal.getTime())) {
    durationMs = puntoFinal.getTime() - start.getTime();
  } else if (status === 'running') {
    durationMs = ahora.getTime() - start.getTime();
  }

  let fStart = null;
  let fEnd = null;
  let fDur = null;

  if (start && !Number.isNaN(start.getTime())) {
    fStart = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
  }

  if (puntoFinal && !Number.isNaN(puntoFinal.getTime())) {
    fEnd = `${pad2(puntoFinal.getHours())}:${pad2(puntoFinal.getMinutes())}`;
  }

  if (durationMs !== null && durationMs >= 0) {
    const totalSecs = Math.floor(durationMs / 1000);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const sec = totalSecs % 60;
    fDur = h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
  }

  const map = criticalityByJob || {};
  const foundKey = Object.keys(map).find(
    (k) => k.trim().toLowerCase() === jobName.toLowerCase()
  );
  
  const rawCrit = foundKey ? map[foundKey] : 'low';
  const criticality = normalizeCriticality(rawCrit);

  return {
    jobId: String(s.job_id || s.id || 'unknown') + '-' + start.getTime(),
    jobName,
    nextRun: s.creation_time || s.creationtime || null,
    lastRun: s.end_time || s.endtime || null,
    lastResult: s.result ?? null,
    status,
    reason,
    source,
    durationMs: durationMs !== null && durationMs >= 0 ? durationMs : null,
    durationTrend: null,
    startTimeDisplay: fStart,
    endTimeDisplay: fEnd,
    duration: fDur,
    relaunched: false,
    email: email ? { subject: email.subject ?? '', date: email.receivedDateTime ?? null } : null,
    allEmails: relevantEmails.map((e) => ({
      subject: e?.subject ?? '',
      date: e?.receivedDateTime ?? null,
      status: String(e?.bodyPreview || '').toLowerCase().includes('success') ? 'success' : 'failed',
    })),
    criticality,
  };
}

function calculateDurationTrend(currentMs, previousMs) {
  if (
    currentMs == null ||
    previousMs == null ||
    !Number.isFinite(currentMs) ||
    !Number.isFinite(previousMs) ||
    currentMs < 0 ||
    previousMs <= 0
  ) {
    return null
  }

  const delta = (currentMs - previousMs) / previousMs
  if (delta > 0.2) return 'up'
  if (delta < -0.2) return 'down'
  return 'same'
}

function applyRelaunchLogic(rows) {
  if (rows.length <= 1) return rows

  const hasSuccess = rows.some((r) => r.status === 'success')
  if (hasSuccess) {
    const successRows = rows
      .filter((r) => r.status === 'success')
      .sort((a, b) => new Date(b.nextRun).getTime() - new Date(a.nextRun).getTime())

    successRows[0].relaunched = true
    return [successRows[0]]
  }

  const allFailed = rows.every((r) => r.status === 'failed')
  if (allFailed) {
    const sorted = [...rows].sort((a, b) => new Date(b.nextRun).getTime() - new Date(a.nextRun).getTime())
    sorted[0].relaunched = true
    return [sorted[0]]
  }

  const byStatus = new Map()
  for (const r of rows) {
    if (!byStatus.has(r.status) || new Date(r.nextRun) > new Date(byStatus.get(r.status).nextRun)) {
      byStatus.set(r.status, r)
    }
  }

  const result = [...byStatus.values()]
  result.forEach((r) => {
    r.relaunched = true
  })

  return result
}

function applyManualOverride(row, overrides, ahora) {
  if (!overrides) return row
  const ov = overrides[row.jobName]
  if (!ov) return row
  if (!ov.timestamp) return row

  const commentDate = new Date(ov.timestamp)
  if (!Number.isNaN(commentDate.getTime())) {
    const expiration = new Date(commentDate)
    expiration.setHours(17, 59, 59, 999)
    if (commentDate.getHours() >= 18) {
      expiration.setDate(expiration.getDate() + 1)
    }
    if (ahora > expiration) return row
  }

  const manualStatus = normalizeManualStatus(ov.status)

  return {
    ...row,
    ...(manualStatus ? { status: manualStatus } : {}),
    ...(ov.comment ? { reason: String(ov.comment) } : {}),
  }
}

function processSessions(sessions, emails, ahora, overrides, criticalityByJob = {}) {
  const safeSessions = Array.isArray(sessions) ? sessions : []
  const safeEmails = Array.isArray(emails) ? emails : []

  const rawRows = safeSessions
    .filter((s) => s && (s.job_name || s.jobname))
    .map((s) => {
      const r = buildRow(s, safeEmails, ahora, criticalityByJob)
      const sqlTrend = s.durationTrend || s.durationtrend || s.DURATIONTREND

      if (r && sqlTrend && r.duration) {
        r.durationTrend = sqlTrend
        r.isSqlData = true
      } else if (r) {
        r.durationTrend = null
      }
      return r
    })
    .filter(Boolean)
    .map((r) => applyManualOverride(r, overrides, ahora))

  const groups = new Map()

  rawRows.forEach((r) => {
    if (!r || !r.jobName) return
    const base = String(r.jobName).trim().toLowerCase()
    if (!groups.has(base)) groups.set(base, [])
    groups.get(base).push(r)
  })

  const fullRows = []

  groups.forEach((g) => {
    if (!Array.isArray(g) || g.length === 0) return

    const sortedGroup = [...g].sort((a, b) => {
      const ta = a.nextRun ? new Date(a.nextRun).getTime() : 0
      const tb = b.nextRun ? new Date(b.nextRun).getTime() : 0
      return tb - ta
    })

    const selectedRows = applyRelaunchLogic(sortedGroup)

    for (const selected of selectedRows) {
      if (selected.isSqlData) {
        continue
      }
      const idx = sortedGroup.findIndex((r) => r.jobId === selected.jobId)
      let previousComparable = null

      for (let i = idx + 1; i < sortedGroup.length; i++) {
        const candidate = sortedGroup[i]
        if (candidate && candidate.durationMs != null && candidate.durationMs >= 0) {
          previousComparable = candidate
          break
        }
      }

      selected.durationTrend = calculateDurationTrend(
        selected.durationMs,
        previousComparable?.durationMs ?? null
      )
    }

    fullRows.push(...selectedRows)
  })

  fullRows.sort((a, b) => {
    const timeA = a.nextRun ? new Date(a.nextRun).getTime() : 0
    const timeB = b.nextRun ? new Date(b.nextRun).getTime() : 0
    return timeB - timeA
  })

  const filteredRows = fullRows.filter((r) => r && r.status !== 'success')
  return { fullRows, filteredRows }
}

function buildVdcEmailStatus(rule, email) {
  if (!email) return 'failed'

  const text = `${email.subject || ''}\n${email.bodyPreview || ''}`.toLowerCase()
  const hasError = rule.errorWord && includesCI(text, rule.errorWord)
  const hasSuccess = rule.successWord && includesCI(text, rule.successWord)

  if (hasError) return 'failed'
  if (hasSuccess) return 'success'
  return 'failed'
}

function evaluateEmailRule(rule, emails, inicio, fin, defaultPrefix) {
  const inWindow = (Array.isArray(emails) ? emails : [])
    .filter((m) => {
      const sender = m?.sender?.emailAddress?.address || ''
      const from = m?.from?.emailAddress?.address || ''

      const matchSender = rule.sender
        ? includesCI(sender, rule.sender) || includesCI(from, rule.sender)
        : true

      const matchSubject = rule.subjectContains
        ? includesCI(m.subject, rule.subjectContains)
        : true

      return matchSender && matchSubject
    })
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())

  const chosen = inWindow[0] || null

  let status = 'pending'
  let reason = 'Pendiente Recepción'

  if (chosen) {
    reason = 'Correo Recibido'

    const text = `${chosen.subject || ''}\n${chosen.bodyPreview || ''}`.toLowerCase()
    const hasError = rule.errorWord && includesCI(text, rule.errorWord)
    const hasSuccess = rule.successWord && includesCI(text, rule.successWord)

    if (hasError) {
      status = 'failed'
    } else if (hasSuccess) {
      status = 'success'
    } else {
      status = 'warning'
    }
  }

  const jobName = rule.title ? rule.title : `[${defaultPrefix}] ${rule.subjectContains || rule.sender || rule.id}`
  const finalDate = chosen?.receivedDateTime ? new Date(chosen.receivedDateTime) : null
  let fEnd = ''

  if (finalDate && !Number.isNaN(finalDate.getTime())) {
    fEnd = `${pad2(finalDate.getHours())}:${pad2(finalDate.getMinutes())}`
  }

  return {
    jobId: `${defaultPrefix.toLowerCase()}:${rule.id}`,
    jobName,
    nextRun: inicio.toISOString(),
    lastRun: chosen?.receivedDateTime ?? null,
    lastResult: null,
    startTime: null,
    endTime: chosen?.receivedDateTime ?? null,
    startTimeDisplay: '',
    endTimeDisplay: fEnd,
    duration: '',
    status,
    reason,
    durationMs: null,
    durationTrend: null,
    relaunched: false,
    email: chosen ? { subject: chosen.subject, date: chosen.receivedDateTime } : null,
    allEmails: inWindow.map((e) => ({
      subject: e.subject,
      date: e.receivedDateTime,
      status: buildVdcEmailStatus(rule, e),
    })),
    criticality: 'low',
    source: 'email',
    sender: rule.sender,
  }
}

function evaluateAs400Rule(rule, emails, inicio, fin) {
  const ruleText = `${rule?.title || ''} ${rule?.name || ''} ${rule?.pattern || ''} ${rule?.subjectContains || ''}`.toUpperCase();
  const isWorkdayRule = /\b(PR|RR)\b/.test(ruleText);

  const startDate = inicio instanceof Date ? inicio : new Date(inicio);
  const dayOfWeek = startDate.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  if (isWorkdayRule && isWeekend) {
    return null;
  }

  const pattern = String(rule?.subjectContains || rule?.pattern || '').trim();
  const startMs = startDate.getTime();
  const endMs = fin instanceof Date ? fin.getTime() : new Date(fin).getTime();
  
  const tolerance = 24 * 60 * 60 * 1000;

  const inWindow = (Array.isArray(emails) ? emails : [])
    .filter((m) => {
      const receivedMs = m?.receivedDateTime ? new Date(m.receivedDateTime).getTime() : NaN;
      if (Number.isNaN(receivedMs)) return false;

      if (receivedMs < (startMs - tolerance) || receivedMs > (endMs + tolerance)) return false;

      const sender = m?.sender?.emailAddress?.address || '';
      const from = m?.from?.emailAddress?.address || '';
      const text = `${m?.subject || ''}\n${m?.bodyPreview || ''}`;

      const matchSender = rule.sender
        ? includesCI(sender, rule.sender) || includesCI(from, rule.sender)
        : true;

      const matchPattern = pattern ? includesCI(text, pattern) : false;
      return matchSender && matchPattern;
    })
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime());

  const chosen = inWindow[0] || null;

  let as400LogContent = null;
  if (chosen && Array.isArray(chosen.attachments)) {
    const file = chosen.attachments.find((a) =>
      a.name && a.name.toLowerCase().includes('qpquprfil')
    );

    if (file && file.contentBytes) {
      as400LogContent = Buffer.from(file.contentBytes, 'base64').toString('utf8');
    }
  }

  const finalDate = chosen?.receivedDateTime ? new Date(chosen.receivedDateTime) : null;
  let fEnd = '';
  if (finalDate && !Number.isNaN(finalDate.getTime())) {
    fEnd = `${pad2(finalDate.getHours())}:${pad2(finalDate.getMinutes())}`;
  }

  return {
    jobId: `as400:${rule.id}`,
    jobName: rule.title || rule.name || `[AS400] ${pattern || rule.id}`,
    nextRun: startDate.toISOString(),
    lastRun: chosen?.receivedDateTime ?? null,
    lastResult: null,
    startTime: null,
    endTime: chosen?.receivedDateTime ?? null,
    startTimeDisplay: '',
    endTimeDisplay: fEnd,
    duration: '',
    status: chosen ? 'success' : 'pending',
    as400LogContent,
    reason: chosen ? 'Correo Recibido, revisar manualmente el log' : 'Pendiente Recepción',
    durationMs: null,
    durationTrend: null,
    relaunched: false,
    email: chosen ? { subject: chosen.subject, date: chosen.receivedDateTime } : null,
    allEmails: inWindow.map((e) => ({
      subject: e.subject,
      date: e.receivedDateTime,
      status: 'success',
    })),
    criticality: 'low',
    source: 'email',
    notes: rule.notes || '',
  };
}

function buildEmailRuleRows(rules, emails, inicio, fin, label) {
  return (Array.isArray(rules) ? rules : [])
    .filter((r) => r.enabled && (r.sender || r.subjectContains))
    .map((r) => evaluateEmailRule(r, emails, inicio, fin, label))
}

function buildVdcRows(rules, emails, inicio, fin, defaultSender = '') {
  return (Array.isArray(rules) ? rules : [])
    .filter((r) => r.enabled && (r.sender || defaultSender || r.subjectContains))
    .map((r) =>
      evaluateEmailRule(
        { ...r, sender: r.sender || defaultSender },
        emails,
        inicio,
        fin,
        'VDC'
      )
    )
}

function buildBarracudaRows(rules, emails, inicio, fin, defaultSender = '') {
  return (Array.isArray(rules) ? rules : [])
    .filter((r) => r.enabled && (r.sender || defaultSender || r.subjectContains))
    .map((r) =>
      evaluateEmailRule(
        { ...r, sender: r.sender || defaultSender },
        emails,
        inicio,
        fin,
        'BARRACUDA'
      )
    )
}

async function buildAs400Rows(rules, emails, inicio, fin, cfg) {
  const candidates = (Array.isArray(rules) ? rules : [])
    .filter((r) => {
      const pattern = String(r?.subjectContains || r?.pattern || '').trim()
      return !!r?.enabled && !!pattern
    })
    .map((r) => evaluateAs400Rule(r, emails, inicio, fin))
    .filter(Boolean)

  await Promise.all(candidates.map(async (row) => {
    if (row.as400LogContent) return 
    const chosenEmail = emails.find((m) => m.receivedDateTime === row.lastRun)
    if (!chosenEmail) return
    if (!chosenEmail.hasAttachments) return
    if (!chosenEmail.id) return
    const logContent = await fetchAs400Attachment(cfg, chosenEmail.id)
    if (logContent) row.as400LogContent = logContent
  }))

  return candidates
}

async function buildRefreshPayloadForWindow(cfg, inicio, fin, includeSql = true) {
  const ahora = new Date()
  const overrides = cfg?.manualOverrides || {}
  const criticalityByJob = cfg?.criticalityByJob || {}

  const tasks = [
    cfg?.graph?.tenantId ? getEmailsInRange(cfg, inicio, fin) : Promise.resolve([]),
    includeSql && cfg?.sql ? sqlGetSessionsInRange(cfg.sql, inicio, fin) : Promise.resolve([]),
  ]

  const [emails, sessions] = await Promise.all(tasks)

  const { fullRows: sqlFullRows } = processSessions(
    sessions || [],
    emails || [],
    ahora,
    overrides,
    criticalityByJob
  )

  const vdcRows = buildVdcRows(cfg?.veeamDataCloudRules || [], emails || [], inicio, fin)
  const barraRows = buildBarracudaRows(cfg?.barracudaRules || [], emails || [], inicio, fin)
  const as400Rows = await buildAs400Rows(cfg?.as400Rules || [], emails || [], inicio, fin, cfg)

  const fullRows = [...sqlFullRows, ...vdcRows, ...barraRows, ...as400Rows].sort(
    (a, b) => new Date(b.nextRun).getTime() - new Date(a.nextRun).getTime()
  )

  const filteredRows = fullRows.filter((r) => r.status !== 'success')

  return {
    ok: true,
    rows: filteredRows,
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

  // --- LOG DE DIAGNÓSTICO EN CASO DE CONFIGURACIÓN VACÍA ---
  if (!hasSql && !hasGraph) {
    try {
      fs.writeFileSync('C:\\Users\\Public\\LOG_MOTOR_ERROR.txt', `[${new Date().toLocaleTimeString()}] El motor arrancó pero no encontró configuración de SQL ni de Graph. Asegúrate de haber guardado la configuración en este entorno.\n`, 'utf8');
    } catch (e) {}
    return { ok: false, error: 'Falta configuración SQL o Graph.' }
  }

  try {
    const { inicio, fin } = getOperationalWindow(new Date())
    const payload = await buildRefreshPayloadForWindow(cfg, inicio, fin, hasSql)

    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('auto:update', payload)
    }

    // ----------------------------------------------------------------------
    // EXPORTACIÓN DIRECTA DEL JSON PARA LA APP MÓVIL (VERSION BLINDADA)
    // ----------------------------------------------------------------------
    try {
        const jsonPath = 'C:\\DashboardBackups\\backup_status.json';
        const folderPath = path.dirname(jsonPath);

        // A) Forzamos la creación de la carpeta si no existe en el disco C:
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
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
            source: r.source
        }));

        // B) Escribimos el JSON
        fs.writeFileSync(jsonPath, JSON.stringify(datosParaMovil, null, 4), 'utf8');
        
        // C) Creamos un chivato de éxito para saber que el bucle funciona 24/7
        fs.writeFileSync('C:\\DashboardBackups\\motor_status.txt', `Último refresco correcto: ${new Date().toLocaleString()}`, 'utf8');

    } catch (exportErr) {
        // Si Windows deniega el acceso o explota el mapeo, lo sabremos aquí
        try {
            fs.writeFileSync('C:\\Users\\Public\\LOG_MOTOR_ERROR.txt', `Error en exportación: ${exportErr?.message || String(exportErr)}\n`, 'utf8');
        } catch (_) {}
        logGraphError('JSON_EXPORT_ERROR', { message: exportErr?.message || String(exportErr) });
    }
    // ----------------------------------------------------------------------

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

function setupIpc() {
  console.log('DEBUG: Registrando ipcMain handlers...')

  const handle = (channel, fn) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, fn)
  }

  handle('config:get', async () => {
    return loadConfig() || {}
  })

  handle('config:save', async (_e, cfg) => {
    try {
      saveConfig(cfg || {})
      startRefreshTimer(cfg?.refreshMinutes)
      return true
    } catch (e) {
      throw new Error(e?.message || String(e))
    }
  })

  handle('test:sql', async (_e, sqlCfg) => {
    try {
      await withTempSqlPool(sqlCfg, async () => true)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  handle('test:graph', async (_e, graphCfg) => {
    try {
      const emails = await getEmails({ graph: graphCfg })
      return { ok: true, count: Array.isArray(emails) ? emails.length : 0 }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  handle('sql:listDatabases', async (_e, sqlCfg) => {
    try {
      const databases = await withTempSqlPool(sqlCfg, async (pool) => {
        const result = await pool.request().query('SELECT name FROM sys.databases ORDER BY name')
        return result.recordset.map((r) => r.name)
      })
      return { ok: true, databases }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  handle('sql:listTables', async (_e, sqlCfg) => {
    try {
      const info = await withTempSqlPool(sqlCfg, async (pool) => {
        const result = await pool.request().query(
          'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME'
        )
        return result.recordset
      })
      return { ok: true, info }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  handle('sql:listColumns', async (_e, sqlCfg, tableName) => {
    try {
      const columns = await withTempSqlPool(sqlCfg, async (pool) => {
        const req = pool.request()
        req.input('tableName', mssql.NVarChar, tableName)
        const result = await req.query(`
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @tableName
          ORDER BY ORDINAL_POSITION
        `)
        return result.recordset.map((r) => r.COLUMN_NAME)
      })
      return { ok: true, columns }
    } catch (e) {
      return { ok: false, error: e.message, columns: [] }
    }
  })

  handle('email:send', async (_e, payload) => {
    const cfg = loadConfig()
    try {
      await sendGraphEmail(cfg, payload)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  handle('refresh', async () => {
    return runRefresh()
  })

  handle('history:getDays', async () => {
    const cfg = loadConfig()
    if (!cfg?.sql) return { ok: false, error: 'Falta configuración SQL.', days: [] }

    try {
      const days = await sqlGetAvailableDays(cfg.sql)
      return { ok: true, days }
    } catch (e) {
      return { ok: false, error: e.message, days: [] }
    }
  })

  handle('history:getDay', async (_e, dateStr) => {
    const cfg = loadConfig()
    if (!cfg?.sql) return { ok: false, error: 'Falta configuración SQL.' }

    try {
      const [year, month, day] = String(dateStr || '').split('-').map(Number)
      const inicio = new Date(year, month - 1, day, 18, 0, 0, 0)
      const fin = new Date(inicio.getTime() + 86400000)

      const payload = await buildRefreshPayloadForWindow(cfg, inicio, fin, true)

      return {
        ok: true,
        rows: payload.rows,
        fullRows: payload.fullRows,
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
      }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  handle('schedule:get30days', async () => {
    const cfg = loadConfig()
    if (!cfg?.sql) {
      return { ok: false, error: 'Falta configuración SQL.', rows: [], debug: { hasSqlConfig: false } }
    }

    try {
      const rawJobs = await sqlGetScheduleJobs(cfg.sql)
      const jobs = (Array.isArray(rawJobs) ? rawJobs : []).filter(
        (j) => j && typeof j === 'object' && j.name
      )

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

      return {
        ok: true,
        rows: all.map((r) => ({ job: r.job, date: r.date.toISOString() })),
      }
    } catch (e) {
      return { ok: false, error: e.message, rows: [] }
    }
  })

  const handleGetExecutions = async (_e, jobName, limit = 100) => {
    const cfg = loadConfig()
    if (!cfg?.sql) return { ok: false, error: 'Falta configuración SQL.', executions: [] }

    try {
      const normalizedJobName = jobName ? String(jobName).trim() : null
      return await sqlGetJobExecutions(cfg.sql, normalizedJobName, limit)
    } catch (e) {
      return { ok: false, error: e.message, executions: [] }
    }
  }

  handle('jobs:list', async () => {
    const cfg = loadConfig()
    if (!cfg?.sql) return { ok: false, error: 'Falta configuración SQL.', jobs: [] }

    try {
      const jobs = await sqlListJobs(cfg.sql)
      return { ok: true, jobs }
    } catch (e) {
      return { ok: false, error: e.message, jobs: [] }
    }
  })

  handle('jobs:getExecutions', handleGetExecutions)
  handle('jobs:get-executions', handleGetExecutions)
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1300,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  })

  mainWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logGraphError('WINDOW_DID_FAIL_LOAD', {
      errorCode,
      errorDescription,
      validatedURL,
    })
  })

  mainWin.on('closed', () => {
    mainWin = null
  })

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

app.whenReady().then(() => {
  console.log('--- INICIANDO SETUP IPC ---')
  setupIpc()
  console.log('--- SETUP IPC COMPLETADO ---')

  createWindow()

  const cfg = loadConfig()
  startRefreshTimer(cfg?.refreshMinutes)
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', async () => {
  await closeCachedSqlPool()
})

app.on('window-all-closed', () => {
  app.quit()
})