// electron/modules/rules.cjs
const { includesCI, pad2, lookupCriticality, formatDurationMs } = require('./utils.cjs')
const { fetchAs400Attachment, getMessageBody, cleanBarracudaFooter, parseBarracudaBody, cleanVdcFooter, parseVdcBody, parseAs400Attachment, extractVdcSummary } = require('./graph.cjs')

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
  // Bordes de palabra para evitar colisiones tipo "LOG Backup SD" matcheando
  // dentro de "LOG Backup SDB/TGT" (mismo criterio ya validado en el historico,
  // ver getJobExecutionsFromEmailHistory en graph.cjs).
  const escapeRegexAs400 = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patternRegex = pattern
    ? new RegExp(`(^|[^a-z0-9])${escapeRegexAs400(pattern)}([^a-z0-9]|$)`, 'i')
    : null
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
      return matchSender && (patternRegex ? patternRegex.test(text) : false)
    })
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())
  const chosen = inWindow[0] || null
  let as400LogContent = null
  if (chosen && Array.isArray(chosen.attachments)) {
    const file = chosen.attachments.find((a) => a.name && a.name.toLowerCase().includes('qpquprfil'))
    if (file && file.contentBytes) as400LogContent = Buffer.from(file.contentBytes, 'base64').toString('latin1')
  }
  const parsedAs400 = as400LogContent ? parseAs400Attachment(as400LogContent) : null
  const finalDate = chosen?.receivedDateTime ? new Date(chosen.receivedDateTime) : null
  const realStartDate = parsedAs400?.startTime ? new Date(parsedAs400.startTime) : null
  const realEndDate = parsedAs400?.endTime ? new Date(parsedAs400.endTime) : finalDate
  let fStart = ''
  if (realStartDate && !Number.isNaN(realStartDate.getTime())) fStart = `${pad2(realStartDate.getHours())}:${pad2(realStartDate.getMinutes())}`
  let fEnd = ''
  if (realEndDate && !Number.isNaN(realEndDate.getTime())) fEnd = `${pad2(realEndDate.getHours())}:${pad2(realEndDate.getMinutes())}`
  const realDurationMs = parsedAs400?.durationMs ?? null
  return {
    jobId: `as400:${rule.id}`, jobName: rule.title || rule.name || `[AS400] ${pattern || rule.id}`,
    nextRun: startDate.toISOString(), lastRun: chosen?.receivedDateTime ?? null,
    lastResult: null,
    startTime: parsedAs400?.startTime ?? null,
    endTime: parsedAs400?.endTime ?? chosen?.receivedDateTime ?? null,
    startTimeDisplay: fStart, endTimeDisplay: fEnd,
    duration: realDurationMs ? formatDurationMs(realDurationMs) : '',
    status: chosen ? 'success' : 'pending',
    // ✅ Contenido real del log para el modal del histórico. `logContent`
    // es el nombre generico que ahora tambien usan VDC y Barracuda; se
    // mantiene `as400LogContent` por compatibilidad con el frontend actual.
    as400LogContent,
    logContent: as400LogContent,
    reason: chosen ? 'Correo Recibido, revisar manualmente el log' : 'Pendiente Recepcion',
    durationMs: realDurationMs, durationTrend: null, relaunched: false,
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
    .sort((a, b) => new Date(a.receivedDateTime).getTime() - new Date(b.receivedDateTime).getTime())
  const chosen = inWindow[0] || null
  let status = 'pending', reason = 'Pendiente Recepcion'
  let parsed = null
  // Cuerpo real del correo, usado solo internamente para extraer la frase
  // util (ver extractVdcSummary); nunca se expone completo en el modal.
  let bodyContent = null
  if (chosen) {
    reason = 'Correo Recibido'
    try {
      bodyContent = await getMessageBody(cfg, chosen.id)
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
  // ✅ Para el modal de log solo interesa la frase util del correo (ver
  // extractVdcSummary en graph.cjs), nunca el cuerpo completo con enlaces
  // de tracking, disclaimer legal, boton "View logs" y pie de firma. Si
  // ningun patron conocido coincide, se conserva el cuerpo limpio como
  // red de seguridad para no dejar el modal vacio.
  const logContent = extractVdcSummary(bodyContent, chosen) || bodyContent || null
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
    // ✅ Frase util del correo (o cuerpo limpio si no se reconoce el patron)
    // para el modal de log del histórico.
    logContent,
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
  // Cuerpo real del correo, conservado para el modal de log del histórico
  // (Barracuda ya trae un log corto y util: Start/End/Duration/Result, sin
  // el disclaimer largo de VDC, por lo que aqui se muestra completo).
  let bodyContent = null
  if (chosen) {
    reason = 'Correo Recibido'
    try {
      bodyContent = await getMessageBody(cfg, chosen.id)
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
    // ✅ Contenido real del correo (ya limpio de pie de firma) para el modal
    // de log del histórico.
    logContent: bodyContent || null,
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
    if (logContent) {
      row.as400LogContent = logContent
      // ✅ Mantener sincronizado el campo generico `logContent` usado por
      // el modal del histórico, igual que en VDC y Barracuda.
      row.logContent = logContent
    }
  }))
  // Reparsear tiempos reales (arrancado/finalizado) ahora que el log ya esta disponible.
  // Antes, evaluateAs400Rule solo tenia acceso a los adjuntos ya embebidos en la lista de
  // correos (normalmente sin contentBytes), por lo que startTime/endTime/durationMs quedaban
  // en null salvo que el adjunto ya viniera cargado.
  candidates.forEach((row) => {
    if (!row.as400LogContent) return
    const parsedAs400 = parseAs400Attachment(row.as400LogContent)
    if (!parsedAs400) return
    const realStartDate = parsedAs400.startTime ? new Date(parsedAs400.startTime) : null
    const realEndDate = parsedAs400.endTime ? new Date(parsedAs400.endTime) : null
    if (realStartDate && !Number.isNaN(realStartDate.getTime())) {
      row.startTime = parsedAs400.startTime
      row.startTimeDisplay = `${pad2(realStartDate.getHours())}:${pad2(realStartDate.getMinutes())}`
    }
    if (realEndDate && !Number.isNaN(realEndDate.getTime())) {
      row.endTime = parsedAs400.endTime
      row.endTimeDisplay = `${pad2(realEndDate.getHours())}:${pad2(realEndDate.getMinutes())}`
    }
    if (parsedAs400.durationMs != null) {
      row.durationMs = parsedAs400.durationMs
      row.duration = formatDurationMs(parsedAs400.durationMs)
    }
  })
  return candidates
}

function buildEmailRuleRows(rules, emails, inicio, fin, label) {
  return (Array.isArray(rules) ? rules : [])
    .filter((r) => r.enabled && (r.sender || r.subjectContains))
    .map((r) => evaluateEmailRule(r, emails, inicio, fin, label))
}

module.exports = { buildVdcEmailStatus, evaluateEmailRule, evaluateAs400Rule, buildVdcRows, buildBarracudaRows, buildAs400Rows, buildEmailRuleRows }
