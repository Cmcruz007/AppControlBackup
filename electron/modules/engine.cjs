// electron/modules/engine.cjs
const { pad2, normalizeCriticality, normalizeManualStatus, isValidDate, lookupCriticality } = require('./utils.cjs')

function getOperationalWindow(baseDate = new Date()) {
  const inicio = new Date(baseDate)
  inicio.setHours(18, 0, 0, 0)
  if (baseDate.getHours() < 18) inicio.setDate(inicio.getDate() - 1)
  const fin = new Date(inicio.getTime() + 86400000)
  return { inicio, fin }
}

function buildRow(s, emails, ahora, criticalityByJob) {
  const rawStart = s.creation_time || s.creationtime || s.nextRun
  const start = rawStart ? new Date(rawStart) : null
  if (!start || Number.isNaN(start.getTime())) return null

  const safeEmails = Array.isArray(emails) ? emails : []
  const jobName = (s.job_name || s.jobname || '').trim()

  const relevantEmails = safeEmails.filter((e) => {
    if (!e || !e.subject || !jobName || !e.receivedDateTime) return false
    return String(e.subject).toLowerCase().includes(jobName.toLowerCase()) && new Date(e.receivedDateTime) >= start
  })

  const email = relevantEmails[0]
  const source = email ? 'both' : 'sql'

  let status = 'running', reason = 'En ejecucion'
  if (s.result === 0) { status = 'success'; reason = 'Backup correcto' }
  else if (s.result === 1) { status = 'warning'; reason = email ? 'Aviso Email' : 'Aviso SQL' }
  else if (s.result === 2) { status = 'failed'; reason = email ? 'Error Email' : 'Error SQL' }
  else if (s.result === -1) { status = 'success'; reason = 'Backup continuo (Correcto)' }

  const rawEnd = email?.receivedDateTime || s.end_time || s.endtime || s.lastRun
  let puntoFinal = rawEnd ? new Date(rawEnd) : null
  if (puntoFinal && puntoFinal.getFullYear() < 2000) puntoFinal = null
  if (puntoFinal && status === 'running') {
    status = 'warning'; reason = `Finalizado sin codigo (cod: ${s.result ?? 'desc'})`
  }

  let durationMs = null
  if (puntoFinal && !Number.isNaN(puntoFinal.getTime())) durationMs = puntoFinal.getTime() - start.getTime()
  else if (status === 'running') durationMs = ahora.getTime() - start.getTime()

  let fStart = null, fEnd = null, fDur = null
  if (start && !Number.isNaN(start.getTime())) fStart = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`
  if (puntoFinal && !Number.isNaN(puntoFinal.getTime())) fEnd = `${pad2(puntoFinal.getHours())}:${pad2(puntoFinal.getMinutes())}`
  if (durationMs !== null && durationMs >= 0) {
    const ts = Math.floor(durationMs / 1000), h = Math.floor(ts / 3600), m = Math.floor((ts % 3600) / 60), sec = ts % 60
    fDur = h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`
  }

  const criticality = lookupCriticality(jobName, criticalityByJob)

  return {
    jobId: String(s.job_id || s.id || 'unknown') + '-' + start.getTime(),
    jobName, nextRun: s.creation_time || s.creationtime || null,
    lastRun: s.end_time || s.endtime || null, lastResult: s.result ?? null,
    status, reason, source,
    durationMs: durationMs !== null && durationMs >= 0 ? durationMs : null,
    durationTrend: null, startTimeDisplay: fStart, endTimeDisplay: fEnd, duration: fDur,
    relaunched: false,
    email: email ? { subject: email.subject ?? '', date: email.receivedDateTime ?? null } : null,
    allEmails: relevantEmails.map((e) => ({
      subject: e?.subject ?? '', date: e?.receivedDateTime ?? null,
      status: String(e?.bodyPreview || '').toLowerCase().includes('success') ? 'success' : 'failed',
    })),
    criticality,
  }
}

function calculateDurationTrend(currentMs, previousMs) {
  if (currentMs == null || previousMs == null || !Number.isFinite(currentMs)
    || !Number.isFinite(previousMs) || currentMs < 0 || previousMs <= 0) return null
  const delta = (currentMs - previousMs) / previousMs
  if (delta > 0.2) return 'up'
  if (delta < -0.2) return 'down'
  return 'same'
}

function applyRelaunchLogic(rows) {
  if (rows.length <= 1) return rows
  const hasSuccess = rows.some((r) => r.status === 'success')
  if (hasSuccess) {
    const successRows = rows.filter((r) => r.status === 'success')
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
    if (!byStatus.has(r.status) || new Date(r.nextRun) > new Date(byStatus.get(r.status).nextRun))
      byStatus.set(r.status, r)
  }
  const result = [...byStatus.values()]
  result.forEach((r) => { r.relaunched = true })
  return result
}

function applyManualOverride(row, overrides, ahora) {
  if (!overrides) return row
  const ov = overrides[row.jobName]
  if (!ov || !ov.timestamp) return row
  const commentDate = new Date(ov.timestamp)
  if (!Number.isNaN(commentDate.getTime())) {
    const expiration = new Date(commentDate)
    expiration.setHours(17, 59, 59, 999)
    if (commentDate.getHours() >= 18) expiration.setDate(expiration.getDate() + 1)
    if (ahora > expiration) return row
  }
  const manualStatus = normalizeManualStatus(ov.status)
  return { ...row, ...(manualStatus ? { status: manualStatus } : {}), ...(ov.comment ? { reason: String(ov.comment) } : {}) }
}

function processSessions(sessions, emails, ahora, overrides, criticalityByJob = {}) {
  const safeSessions = Array.isArray(sessions) ? sessions : []
  const safeEmails = Array.isArray(emails) ? emails : []

  const rawRows = safeSessions
    .filter((s) => s && (s.job_name || s.jobname))
    .map((s) => {
      const r = buildRow(s, safeEmails, ahora, criticalityByJob)
      const sqlTrend = s.durationTrend || s.durationtrend || s.DURATIONTREND
      if (r && sqlTrend && r.duration) { r.durationTrend = sqlTrend; r.isSqlData = true }
      else if (r) { r.durationTrend = null }
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
      if (selected.isSqlData) continue
      const idx = sortedGroup.findIndex((r) => r.jobId === selected.jobId)
      let previousComparable = null
      for (let i = idx + 1; i < sortedGroup.length; i++) {
        const c = sortedGroup[i]
        if (c && c.durationMs != null && c.durationMs >= 0) { previousComparable = c; break }
      }
      selected.durationTrend = calculateDurationTrend(selected.durationMs, previousComparable?.durationMs ?? null)
    }
    fullRows.push(...selectedRows)
  })

  fullRows.sort((a, b) => {
    const tA = a.nextRun ? new Date(a.nextRun).getTime() : 0
    const tB = b.nextRun ? new Date(b.nextRun).getTime() : 0
    return tB - tA
  })

  return { fullRows, filteredRows: fullRows.filter((r) => r && r.status !== 'success') }
}

module.exports = { getOperationalWindow, buildRow, calculateDurationTrend, applyRelaunchLogic, applyManualOverride, processSessions }