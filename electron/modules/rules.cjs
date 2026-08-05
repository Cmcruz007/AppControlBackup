// electron/modules/rules.cjs
const { includesCI, pad2, lookupCriticality, formatDurationMs } = require('./utils.cjs')
const { fetchAs400Attachment, getMessageBody, cleanBarracudaFooter, parseBarracudaBody, cleanVdcFooter, parseVdcBody } = require('./graph.cjs')

function buildVdcEmailStatus(rule, email) {
  if (!email) return 'failed'
  const text = `${email.subject || ''}\n${email.bodyPreview || ''}`.toLowerCase()
  if (rule.errorWord && includesCI(text, rule.errorWord)) return 'failed'
  if (rule.successWord && includesCI(text, rule.successWord)) return 'success'
  return 'failed'
}

function evaluateEmailRule(rule, emails, inicio, fin, defaultPrefix, criticalityByJob, sourceName = 'email') {
  const inWindow = (Array.isArray(emails) ? emails : [])
    .filter((m) => {
      const sender = m?.sender?.emailAddress?.address || ''
      const from = m?.from?.emailAddress?.address || ''
      const matchSender = rule.sender ? includesCI(sender, rule.sender) || includesCI(from, rule.sender) : true
      const matchSubject = rule.subjectContains ? includesCI(m.subject, rule.subjectContains) : true
      return matchSender && matchSubject
    })
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())

  const chosen = inWindow[0] || null
  let status = 'pending', reason = 'Pendiente Recepcion'

  if (chosen) {
    reason = 'Correo Recibido'
    const text = `${chosen.subject || ''}\n${chosen.bodyPreview || ''}`.toLowerCase()
    const hasError = rule.errorWord && includesCI(text, rule.errorWord)
    const hasSuccess = rule.successWord && includesCI(text, rule.successWord)
    if (hasError) status = 'failed'
    else if (hasSuccess) status = 'success'
    else status = 'warning'
  }

  const jobName = rule.title ? rule.title : `[${defaultPrefix}] ${rule.subjectContains || rule.sender || rule.id}`
  const finalDate = chosen?.receivedDateTime ? new Date(chosen.receivedDateTime) : null
  let fEnd = ''
  if (finalDate && !Number.isNaN(finalDate.getTime())) fEnd = `${pad2(finalDate.getHours())}:${pad2(finalDate.getMinutes())}`

  return {
    jobId: `${defaultPrefix.toLowerCase()}:${rule.id}`, jobName,
    nextRun: inicio.toISOString(), lastRun: chosen?.receivedDateTime ?? null,
    lastResult: null, startTime: null, endTime: chosen?.receivedDateTime ?? null,
    startTimeDisplay: '', endTimeDisplay: fEnd, duration: '',
    status, reason, durationMs: null, durationTrend: null, relaunched: false,
    email: chosen ? { subject: chosen.subject, date: chosen.receivedDateTime } : null,
    allEmails: inWindow.map((e) => ({ subject: e.subject, date: e.receivedDateTime, status: buildVdcEmailStatus(rule, e) })),
    criticality: lookupCriticality(jobName, criticalityByJob), source: sourceName, category: sourceName, sender: rule.sender,
  }
}

function evaluateAs400Rule(rule, emails, inicio, fin, criticalityByJob) {
  const ruleText = `${rule?.title || ''} ${rule?.name || ''} ${rule?.pattern || ''} ${rule?.subjectContains || ''}`.toUpperCase()
  const isWorkdayRule = /\b(PR|RR)\b/.test(ruleText)
  const startDate = inicio instanceof Date ? inicio : new Date(inicio)
  const dayOfWeek = startDate.getDay()
  if (isWorkdayRule && (dayOfWeek === 0 || dayOfWeek === 6)) return null

  const pattern = String(rule?.subjectContains || rule?.pattern || '').trim()
  const startMs = startDate.getTime()
  const endMs = fin instanceof Date ? fin.getTime() : new Date(fin).getTime()
  const tolerance = 24 * 60 * 60 * 1000

  const inWindow = (Array.isArray(emails) ? emails : [])
    .filter((m) => {
      const receivedMs = m?.receivedDateTime ? new Date(m.receivedDateTime).getTime() : NaN
      if (Number.isNaN(receivedMs)) return false
      if (receivedMs < (startMs - tolerance) || receivedMs > (endMs + tolerance)) return false
      const sender = m?.sender?.emailAddress?.address || ''
      const from = m?.from?.emailAddress?.address || ''
      const text = `${m?.subject || ''}\n${m?.bodyPreview || ''}`
      const matchSender = rule.sender ? includesCI(sender, rule.sender) || includesCI(from, rule.sender) : true
      return matchSender && (pattern ? includesCI(text, pattern) : false)
    })
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())

  const chosen = inWindow[0] || null
  let as400LogContent = null
  if (chosen && Array.isArray(chosen.attachments)) {
    const file = chosen.attachments.find((a) => a.name && a.name.toLowerCase().includes('qpquprfil'))
    if (file && file.contentBytes) as400LogContent = Buffer.from(file.contentBytes, 'base64').toString('latin1')
  }

  const finalDate = chosen?.receivedDateTime ? new Date(chosen.receivedDateTime) : null
  let fEnd = ''
  if (finalDate && !Number.isNaN(finalDate.getTime())) fEnd = `${pad2(finalDate.getHours())}:${pad2(finalDate.getMinutes())}`

  return {
    jobId: `as400:${rule.id}`, jobName: rule.title || rule.name || `[AS400] ${pattern || rule.id}`,
    nextRun: startDate.toISOString(), lastRun: chosen?.receivedDateTime ?? null,
    lastResult: null, startTime: null, endTime: chosen?.receivedDateTime ?? null,
    startTimeDisplay: '', endTimeDisplay: fEnd, duration: '',
    status: chosen ? 'success' : 'pending', as400LogContent,
    reason: chosen ? 'Correo Recibido, revisar manualmente el log' : 'Pendiente Recepcion',
    durationMs: null, durationTrend: null, relaunched: false,
    email: chosen ? { subject: chosen.subject, date: chosen.receivedDateTime } : null,
    allEmails: inWindow.map((e) => ({ subject: e.subject, date: e.receivedDateTime, status: 'success' })),
    criticality: lookupCriticality(rule.title || rule.name, criticalityByJob), source: 'as400', category: 'as400', notes: rule.notes || '',
  }
}

const VDC_FIXED_SCHEDULE = {
  'VDC EXCHANGE': { hh: 1, mm: 30 },
  'VDC ONEDRIVE': { hh: 2, mm: 30 },
  'VDC SHAREPOINT Y TEAMS': { hh: 22, mm: 0 },
}

function computeVdcFixedStart(inicio, rule) {
  const key = String(rule?.title || '').trim().toUpperCase()
  const sched = VDC_FIXED_SCHEDULE[key]
  if (!sched) return null

  const start = inicio instanceof Date ? inicio : new Date(inicio)
  const candidate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), sched.hh, sched.mm, 0, 0)
  if (candidate < start) candidate.setDate(candidate.getDate() + 1)
  return candidate
}

async function evaluateVdcRule(rule, emails, inicio, fin, cfg, criticalityByJob) {
  const inWindow = (Array.isArray(emails) ? emails : [])
    .filter((m) => {
      const sender = m?.sender?.emailAddress?.address || ''
      const from = m?.from?.emailAddress?.address || ''
      const matchSender = rule.sender ? includesCI(sender, rule.sender) || includesCI(from, rule.sender) : true
      const matchSubject = rule.subjectContains ? includesCI(m.subject, rule.subjectContains) : true
      return matchSender && matchSubject
    })
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())

  const chosen = inWindow[0] || null
  let status = 'pending', reason = 'Pendiente Recepcion'
  let parsed = null

  if (chosen) {
    reason = 'Correo Recibido'
    try {
      let bodyContent = await getMessageBody(cfg, chosen.id)
      bodyContent = cleanVdcFooter(bodyContent)
      parsed = parseVdcBody(chosen, bodyContent)
    } catch (err) {
      parsed = null
    }

    if (parsed?.status) {
      status = parsed.status
    } else {
      const text = `${chosen.subject || ''}
${chosen.bodyPreview || ''}`.toLowerCase()
      const hasError = rule.errorWord && includesCI(text, rule.errorWord)
      const hasSuccess = rule.successWord && includesCI(text, rule.successWord)
      if (hasError) status = 'failed'
      else if (hasSuccess) status = 'success'
      else status = 'warning'
    }
  }

  const jobName = rule.title ? rule.title : `[VDC] ${rule.subjectContains || rule.sender || rule.id}`
  const fixedStart = computeVdcFixedStart(inicio, rule)
  const endDate = parsed?.endTime ? new Date(parsed.endTime) : (chosen?.receivedDateTime ? new Date(chosen.receivedDateTime) : null)

  let fStart = ''
  if (fixedStart && !Number.isNaN(fixedStart.getTime())) fStart = `${pad2(fixedStart.getHours())}:${pad2(fixedStart.getMinutes())}`
  let fEnd = ''
  if (endDate && !Number.isNaN(endDate.getTime())) fEnd = `${pad2(endDate.getHours())}:${pad2(endDate.getMinutes())}`

  let durationMs = null
  if (fixedStart && endDate && !Number.isNaN(fixedStart.getTime()) && !Number.isNaN(endDate.getTime())) {
    const diff = endDate.getTime() - fixedStart.getTime()
    durationMs = diff >= 0 ? diff : null
  }

  return {
    jobId: `vdc:${rule.id}`, jobName,
    nextRun: inicio.toISOString(), lastRun: chosen?.receivedDateTime ?? null,
    lastResult: null,
    startTime: fixedStart ? fixedStart.toISOString() : null,
    endTime: parsed?.endTime ?? chosen?.receivedDateTime ?? null,
    startTimeDisplay: fStart, endTimeDisplay: fEnd,
    duration: durationMs ? formatDurationMs(durationMs) : '',
    status, reason,
    durationMs,
    durationTrend: null, relaunched: false,
    email: chosen ? { subject: chosen.subject, date: chosen.receivedDateTime } : null,
    allEmails: inWindow.map((e) => ({ subject: e.subject, date: e.receivedDateTime, status: buildVdcEmailStatus(rule, e) })),
    criticality: lookupCriticality(jobName, criticalityByJob), source: 'vdc', category: 'vdc', sender: rule.sender,
  }
}

async function buildVdcRows(rules, emails, inicio, fin, cfg, defaultSender = '', criticalityByJob = {}) {
  const candidates = (Array.isArray(rules) ? rules : [])
    .filter((r) => r.enabled && (r.sender || defaultSender || r.subjectContains))
  return Promise.all(
    candidates.map((r) => evaluateVdcRule({ ...r, sender: r.sender || defaultSender }, emails, inicio, fin, cfg, criticalityByJob))
  )
}

async function evaluateBarracudaRule(rule, emails, inicio, fin, cfg, criticalityByJob) {
  const inWindow = (Array.isArray(emails) ? emails : [])
    .filter((m) => {
      const sender = m?.sender?.emailAddress?.address || ''
      const from = m?.from?.emailAddress?.address || ''
      const matchSender = rule.sender ? includesCI(sender, rule.sender) || includesCI(from, rule.sender) : true
      const matchSubject = rule.subjectContains ? includesCI(m.subject, rule.subjectContains) : true
      return matchSender && matchSubject
    })
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())

  const chosen = inWindow[0] || null
  let status = 'pending', reason = 'Pendiente Recepcion'
  let parsed = null

  if (chosen) {
    reason = 'Correo Recibido'
    try {
      let bodyContent = await getMessageBody(cfg, chosen.id)
      bodyContent = cleanBarracudaFooter(bodyContent)
      parsed = parseBarracudaBody(bodyContent)
    } catch (err) {
      parsed = null
    }

    if (parsed?.status) {
      status = parsed.status
    } else {
      const text = `${chosen.subject || ''}\n${chosen.bodyPreview || ''}`.toLowerCase()
      const hasError = rule.errorWord && includesCI(text, rule.errorWord)
      const hasSuccess = rule.successWord && includesCI(text, rule.successWord)
      if (hasError) status = 'failed'
      else if (hasSuccess) status = 'success'
      else status = 'warning'
    }
  }

  const jobName = rule.title ? rule.title : `[BARRACUDA] ${rule.subjectContains || rule.sender || rule.id}`

  const startDate = parsed?.startTime ? new Date(parsed.startTime) : null
  const endDate = parsed?.endTime ? new Date(parsed.endTime) : (chosen?.receivedDateTime ? new Date(chosen.receivedDateTime) : null)

  let fStart = ''
  if (startDate && !Number.isNaN(startDate.getTime())) fStart = `${pad2(startDate.getHours())}:${pad2(startDate.getMinutes())}`
  let fEnd = ''
  if (endDate && !Number.isNaN(endDate.getTime())) fEnd = `${pad2(endDate.getHours())}:${pad2(endDate.getMinutes())}`

  return {
    jobId: `barracuda:${rule.id}`, jobName,
    nextRun: inicio.toISOString(), lastRun: chosen?.receivedDateTime ?? null,
    lastResult: null,
    startTime: parsed?.startTime ?? null,
    endTime: parsed?.endTime ?? chosen?.receivedDateTime ?? null,
    startTimeDisplay: fStart, endTimeDisplay: fEnd,
    duration: parsed?.durationMs ? formatDurationMs(parsed.durationMs) : '',
    status, reason,
    durationMs: parsed?.durationMs ?? null,
    durationTrend: null, relaunched: false,
    email: chosen ? { subject: chosen.subject, date: chosen.receivedDateTime } : null,
    allEmails: inWindow.map((e) => ({ subject: e.subject, date: e.receivedDateTime, status: buildVdcEmailStatus(rule, e) })),
    criticality: lookupCriticality(jobName, criticalityByJob), source: 'barracuda', category: 'barracuda', sender: rule.sender,
  }
}

async function buildBarracudaRows(rules, emails, inicio, fin, cfg, defaultSender = '', criticalityByJob = {}) {
  const candidates = (Array.isArray(rules) ? rules : [])
    .filter((r) => r.enabled && (r.sender || defaultSender || r.subjectContains))
  return Promise.all(
    candidates.map((r) => evaluateBarracudaRule({ ...r, sender: r.sender || defaultSender }, emails, inicio, fin, cfg, criticalityByJob))
  )
}

async function buildAs400Rows(rules, emails, inicio, fin, cfg, criticalityByJob = {}) {
  const candidates = (Array.isArray(rules) ? rules : [])
    .filter((r) => { const p = String(r?.subjectContains || r?.pattern || '').trim(); return !!r?.enabled && !!p })
    .map((r) => evaluateAs400Rule(r, emails, inicio, fin, criticalityByJob))
    .filter(Boolean)

  await Promise.all(candidates.map(async (row) => {
    if (row.as400LogContent) return
    const chosenEmail = emails.find((m) => m.receivedDateTime === row.lastRun)
    if (!chosenEmail || !chosenEmail.hasAttachments || !chosenEmail.id) return
    const logContent = await fetchAs400Attachment(cfg, chosenEmail.id)
    if (logContent) row.as400LogContent = logContent
  }))
  return candidates
}

function buildEmailRuleRows(rules, emails, inicio, fin, label) {
  return (Array.isArray(rules) ? rules : [])
    .filter((r) => r.enabled && (r.sender || r.subjectContains))
    .map((r) => evaluateEmailRule(r, emails, inicio, fin, label))
}

module.exports = { buildVdcEmailStatus, evaluateEmailRule, evaluateAs400Rule, buildVdcRows, buildBarracudaRows, buildAs400Rows, buildEmailRuleRows }
