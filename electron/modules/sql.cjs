// electron/modules/sql.cjs
const mssql = require('mssql')
const { isExcludedJobName, pad2, isValidDate, toDateOrNull, formatDisplayTime, formatDurationMs } = require('./utils.cjs')

let sqlPoolPromise = null
let sqlPoolKey = null
let cachedSessionsTable = null

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
      ? { type: 'ntlm', options: { domain, userName, password: sqlCfg.password } }
      : undefined,
    options: { encrypt: false, trustServerCertificate: true, useUTC: false },
    connectionTimeout: 15000,
    requestTimeout: 30000,
  }
}

function getSqlPoolCacheKey(sqlCfg) {
  return JSON.stringify({
    host: sqlCfg?.host || '', port: Number(sqlCfg?.port) || 1433,
    database: sqlCfg?.database || 'VeeamBackup', user: sqlCfg?.user || '', password: sqlCfg?.password || '',
  })
}

async function closeCachedSqlPool() {
  const currentPromise = sqlPoolPromise
  sqlPoolPromise = null
  sqlPoolKey = null
  cachedSessionsTable = null
  if (!currentPromise) return
 try {
    const pool = await currentPromise
    if (pool?._healthCheck) clearInterval(pool._healthCheck)
    if (pool && (pool.connected || pool.connecting)) await pool.close()
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
            try { const p = await sqlPoolPromise; if (p === pool) { sqlPoolPromise = null; sqlPoolKey = null; cachedSessionsTable = null } }
            catch (_) { sqlPoolPromise = null; sqlPoolKey = null; cachedSessionsTable = null }
          }
        })

        // Ping periódico: verifica que la conexión sigue viva cada 5 minutos
        pool._healthCheck = setInterval(async () => {
          try {
            await pool.request().query('SELECT 1')
          } catch (_) {
            clearInterval(pool._healthCheck)
            sqlPoolPromise = null
            sqlPoolKey = null
            cachedSessionsTable = null
            try { await pool.close() } catch (__) {}
          }
        }, 5 * 60 * 1000)

        return pool
      })
      .catch((err) => { sqlPoolPromise = null; sqlPoolKey = null; throw err })
  }
  const pool = await sqlPoolPromise
  if (!pool.connected) { sqlPoolPromise = null; sqlPoolKey = null; throw new Error('Conexion SQL perdida.') }
  return pool
}

async function withTempSqlPool(sqlCfg, fn) {
  const pool = new mssql.ConnectionPool(buildMssqlConfig(sqlCfg))
  await pool.connect()
  try { return await fn(pool) } finally { try { await pool.close() } catch (_) {} }
}

async function sqlFindCompatibleSessionsTable(pool) {
  if (cachedSessionsTable) return cachedSessionsTable
  const candidates = ['Backup.Model.BackupJobSessions', 'Backup.Model.JobSessions', 'BackupJobSessions', 'BSessions']
  const inList = candidates.map((x) => `'${x.replace(/'/g, "''")}'`).join(', ')

  const tablesRes = await pool.request().query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN (${inList})`
  )
  const available = tablesRes.recordset.map((r) => r.TABLE_NAME)
  if (!available.length) throw new Error('No se encontro ninguna tabla candidata de sesiones.')

  const colsRes = await pool.request().query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME IN (${inList})`
  )
  const colsByTable = new Map()
  for (const row of colsRes.recordset) {
    if (!colsByTable.has(row.TABLE_NAME)) colsByTable.set(row.TABLE_NAME, new Set())
    colsByTable.get(row.TABLE_NAME).add(String(row.COLUMN_NAME).toLowerCase())
  }

  const required = ['job_id', 'creation_time', 'end_time', 'result']
  for (const tName of candidates) {
    if (!available.includes(tName)) continue
    const cols = colsByTable.get(tName) || new Set()
    if (required.every((c) => cols.has(c))) { cachedSessionsTable = tName; return tName }
  }

  const detail = candidates.filter((t) => available.includes(t))
    .map((t) => `${t}: ${[...(colsByTable.get(t) || new Set())].join(', ')}`).join(' | ')
  throw new Error('No se encontro tabla sesiones compatible. ' + detail)
}

async function sqlGetSessionsInRange(sqlCfg, inicio, fin) {
  const pool = await getSqlPool(sqlCfg)
  const tName = await sqlFindCompatibleSessionsTable(pool)
  const req = pool.request()
  req.input('inicio', mssql.DateTime, inicio)
  req.input('fin', mssql.DateTime, fin)

  const result = await req.query(`
    SELECT s.job_id, s.creation_time, s.end_time, s.result, j.name AS job_name,
      CASE
        WHEN prev.prev_duration_sec IS NULL OR prev.prev_duration_sec = 0 OR curr.curr_duration_sec IS NULL THEN 'same'
        WHEN (curr.curr_duration_sec - prev.prev_duration_sec) * 1.0 / prev.prev_duration_sec > 0.2 THEN 'up'
        WHEN (curr.curr_duration_sec - prev.prev_duration_sec) * 1.0 / prev.prev_duration_sec < -0.2 THEN 'down'
        ELSE 'same'
      END AS durationTrend
    FROM [dbo].[${tName}] s WITH (NOLOCK)
    INNER JOIN [dbo].[BJobs] j WITH (NOLOCK) ON j.id = s.job_id
    OUTER APPLY (
      SELECT CASE WHEN s.end_time IS NOT NULL AND YEAR(s.end_time) > 2000 AND s.end_time > s.creation_time
        THEN DATEDIFF(SECOND, s.creation_time, s.end_time) ELSE NULL END AS curr_duration_sec
    ) curr
    OUTER APPLY (
      SELECT TOP 1 DATEDIFF(SECOND, s2.creation_time, s2.end_time) AS prev_duration_sec
      FROM [dbo].[${tName}] s2 WITH (NOLOCK)
      WHERE s2.job_id = s.job_id AND s2.creation_time < s.creation_time
        AND s2.end_time IS NOT NULL AND YEAR(s2.end_time) > 2000 AND s2.end_time > s2.creation_time
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
  if (jobName) { req.input('jobName', mssql.NVarChar, jobName); whereClause = 'WHERE j.name = @jobName' }

  const result = await req.query(`
    SELECT TOP (${safeLimit}) s.job_id, s.creation_time AS creationtime, s.end_time AS endtime,
      s.result, j.name AS jobname
    FROM [dbo].[${tName}] AS s WITH (NOLOCK)
    INNER JOIN [dbo].[BJobs] AS j WITH (NOLOCK) ON j.id = s.job_id
    ${whereClause} ORDER BY s.creation_time DESC
  `)

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
      start: start ? start.toISOString() : null, end: end ? end.toISOString() : null,
      startDisplay: formatDisplayTime(start), endDisplay: formatDisplayTime(end),
      duration: formatDurationMs(durationMs), status, result: r.result ?? null,
    }
  })
  return { ok: true, jobName: jobName || 'Todos los Jobs', totalExecutions: executions.length, executions }
}

async function sqlGetAvailableDays(sqlCfg) {
  const pool = await getSqlPool(sqlCfg)
  const tName = await sqlFindCompatibleSessionsTable(pool)
  const result = await pool.request().query(`
    SELECT DISTINCT CONVERT(date, DATEADD(hour, -18, creation_time)) AS ventana_date
    FROM [dbo].[${tName}] WITH (NOLOCK) ORDER BY ventana_date DESC
  `)
  return result.recordset.map((r) => {
    const d = new Date(r.ventana_date)
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  })
}

async function sqlGetScheduleJobs(sqlCfg) {
  const pool = await getSqlPool(sqlCfg)
  const result = await pool.request().query(`
    SELECT name, type, target_type, job_source_type,
      CAST(options AS NVARCHAR(MAX)) AS options_xml,
      CAST(schedule AS NVARCHAR(MAX)) AS schedule_xml
    FROM [dbo].[BJobs] WITH (NOLOCK)
    WHERE is_deleted = 0 AND schedule_enabled = 1 AND schedule IS NOT NULL ORDER BY name
  `)
  return (result.recordset || []).filter((r) => !isExcludedJobName(r.name))
}

async function sqlListJobs(sqlCfg) {
  const pool = await getSqlPool(sqlCfg)
  const result = await pool.request()
    .query(`SELECT name FROM [dbo].[BJobs] WITH (NOLOCK) WHERE ISNULL(is_deleted, 0) = 0 ORDER BY name`)
  return (result.recordset || []).map((r) => r.name).filter(Boolean).filter((n) => !isExcludedJobName(n))
}

module.exports = {
  closeCachedSqlPool, getSqlPool, withTempSqlPool,
  sqlFindCompatibleSessionsTable, sqlGetSessionsInRange,
  sqlGetJobExecutions, sqlGetAvailableDays, sqlGetScheduleJobs, sqlListJobs,
}