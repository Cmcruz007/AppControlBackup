// electron/modules/graph.cjs
const { logGraphError } = require('./utils.cjs')

// ─── Token OAuth ────────────────────────────────────────────────────────────

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
    logGraphError('GRAPH_TOKEN_HTTP_ERROR', { status: resAuth.status, body: authJson })
    throw new Error(`Graph OAuth HTTP ${resAuth.status}: ${JSON.stringify(authJson)}`)
  }
  if (!authJson.access_token) {
    logGraphError('GRAPH_TOKEN_MISSING', { body: authJson })
    throw new Error(`No se pudo obtener token OAuth: ${JSON.stringify(authJson)}`)
  }
  return authJson.access_token
}

// ─── Listado de correos ─────────────────────────────────────────────────────

async function getEmailsInRange(cfg, inicio, fin) {
  if (!cfg?.graph?.tenantId) throw new Error('Falta configuracion de Microsoft Graph (tenantId).')
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
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
    })
    const mailData = await resMail.json()
    if (!resMail.ok) {
      logGraphError('GRAPH_LIST_MESSAGES_HTTP_ERROR', {
        status: resMail.status, mailbox: g.mailbox, body: mailData,
        inicio: inicio.toISOString(), fin: fin.toISOString(),
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

// ─── Cuerpo completo de un mensaje ──────────────────────────────────────────

async function getMessageBody(cfg, messageId) {
  if (!cfg?.graph?.tenantId || !messageId) return null
  try {
    const token = await getGraphToken(cfg.graph)
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.graph.mailbox)}/messages/${encodeURIComponent(messageId)}?$select=body,bodyPreview`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    })
    if (!res.ok) {
      logGraphError('GET_MESSAGE_BODY_ERROR', { status: res.status, messageId })
      return null
    }
    const data = await res.json()
    return data?.body?.content || data?.bodyPreview || null
  } catch (e) {
    logGraphError('GET_MESSAGE_BODY_EXCEPTION', { message: e?.message, messageId })
    return null
  }
}

// ─── Adjuntos AS400 ─────────────────────────────────────────────────────────

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
    const file = attachments.find((a) => a.contentType && a.contentType.includes('text'))
      || attachments.find((a) => a.contentBytes)
    if (file && file.contentBytes) {
      return Buffer.from(file.contentBytes, 'base64').toString('latin1')
    }
  } catch (e) {
    logGraphError('AS400_ATTACHMENT_EXCEPTION', { message: e?.message, messageId })
  }
  return null
}

// ─── Envío de correos ───────────────────────────────────────────────────────

async function sendGraphEmail(cfg, { to, cc, bcc, subject, bodyHtml }) {
  const g = cfg?.graph
  if (!g?.tenantId) throw new Error('Falta configuracion de Microsoft Graph.')
  const parseRecipients = (value) => {
    if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean)
    return String(value || '').split(';').map((x) => x.trim()).filter(Boolean)
  }
  const toList = parseRecipients(to), ccList = parseRecipients(cc), bccList = parseRecipients(bcc)
  if (!toList.length) throw new Error('No hay destinatarios validos en "Para".')
  const mapR = (list) => list.map((address) => ({ emailAddress: { address } }))
  const accessToken = await getGraphToken(g)
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(g.mailbox)}/sendMail`
  const res = await fetch(sendUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: bodyHtml },
        toRecipients: mapR(toList),
        ccRecipients: mapR(ccList),
        bccRecipients: mapR(bccList),
      },
    }),
  })
  if (!res.ok) {
    const errBody = await res.text()
    logGraphError('GRAPH_SENDMAIL_HTTP_ERROR', { status: res.status, mailbox: g.mailbox, body: errBody })
    throw new Error(`Graph sendMail HTTP ${res.status}: ${errBody}`)
  }
  return true
}

// ─── PARSERS por tipo de fuente ─────────────────────────────────────────────

function detectRuleSource(rule) {
  const id = String(rule?.id || '').toLowerCase()
  const title = String(rule?.title || '').toLowerCase()
  const sender = String(rule?.sender || '').toLowerCase()
  if (id.startsWith('as400') || sender.includes('qsysopr')) return 'as400'
  if (id.startsWith('barra') || sender.includes('barracuda')) return 'barracuda'
  if (id.startsWith('vdc') || sender.includes('veeam')) return 'vdc'
  if (title.includes('barracuda')) return 'barracuda'
  if (title.includes('veeam data cloud') || title.includes('vdc')) return 'vdc'
  return 'unknown'
}

/**
 * AS400 — parsea adjunto .txt:
 *   "Trabajo X arrancado el YY/MM/DD a las HH:MM:SS"
 *   "Trabajo X finalizado el YY/MM/DD a las HH:MM:SS; se utilizaron N,NNN segundos; código de finalización N"
 */
/**
 * AS400 — parsea adjunto .txt:
 *   "Trabajo X arrancado el YY/MM/DD a las HH:MM:SS"
 *   "Trabajo X finalizado el YY/MM/DD a las HH:MM:SS; ... código de finalización N"
 *
 * Duración: SIEMPRE end - start (tiempo de reloj real).
 * Ignoramos el campo "se utilizaron N segundos" (es tiempo de CPU, no real).
 */
function parseAs400Attachment(text) {
  if (!text) return null

  const startMatch = text.match(/arrancado\s+el\s+(\d{2})\/(\d{2})\/(\d{2})\s+a\s+las\s+(\d{2}):(\d{2}):(\d{2})/i)
  const endMatch = text.match(/finalizado\s+el\s+(\d{2})\/(\d{2})\/(\d{2})\s+a\s+las\s+(\d{2}):(\d{2}):(\d{2})[\s\S]*?c[oó]digo\s+de\s+finalizaci[oó]n\s+(\d+)/i)

  const parseDate = (yy, mm, dd, hh, mi, ss) => {
    const y = parseInt(yy, 10)
    const year = y < 90 ? 2000 + y : 1900 + y
    return new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mi, 10), parseInt(ss, 10))
  }

  let startTime = null, endTime = null, durationMs = null, status = null, code = null

  if (startMatch) {
    startTime = parseDate(startMatch[1], startMatch[2], startMatch[3], startMatch[4], startMatch[5], startMatch[6])
  }
  if (endMatch) {
    endTime = parseDate(endMatch[1], endMatch[2], endMatch[3], endMatch[4], endMatch[5], endMatch[6])
    code = parseInt(endMatch[7], 10)
    status = code === 0 ? 'success' : 'failed'
  }

  // Duración = tiempo entre arranque y finalización (reloj real).
  // Nunca se usa el campo "se utilizaron N segundos" del AS400.
  if (startTime && endTime) {
    durationMs = endTime.getTime() - startTime.getTime()
  }

  if (!startTime && !endTime && !status) return null

  return {
    startTime: startTime ? startTime.toISOString() : null,
    endTime: endTime ? endTime.toISOString() : null,
    durationMs,
    status,
    code,
  }
}

/**
 * Barracuda — parsea body HTML/texto:
 *   Start Date 2026-06-23 10:30:38 UTC
 *   End Date   2026-06-23 20:17:59 UTC
 *   Duration   09:47:20
 *   Result     Success
 */
function parseBarracudaBody(body) {
  if (!body) return null

  const clean = String(body)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const startMatch = clean.match(/Start\s+Date\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+UTC/i)
  const endMatch = clean.match(/End\s+Date\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+UTC/i)
  const durationMatch = clean.match(/Duration\s+(\d{2}):(\d{2}):(\d{2})/i)
  const errorMatch = clean.match(/Error\s+Count\s+(\d+)/i)
  const warningMatch = clean.match(/Warning\s+Count\s+(\d+)/i)
  const resultMatch = clean.match(/Result\s+(Success|Warning|Failed|Failure)/i)
  const sizeMatch = clean.match(/Size\s+([\d.]+)\s*(KiB|MiB|GiB|TiB)/i)
  const itemMatch = clean.match(/Item\s+Count\s+([\d,]+)/i)

  let startTime = null, endTime = null, durationMs = null, status = null

  if (startMatch) startTime = new Date(`${startMatch[1]}T${startMatch[2]}Z`)
  if (endMatch) endTime = new Date(`${endMatch[1]}T${endMatch[2]}Z`)

  if (durationMatch) {
    const h = parseInt(durationMatch[1], 10)
    const m = parseInt(durationMatch[2], 10)
    const s = parseInt(durationMatch[3], 10)
    durationMs = (h * 3600 + m * 60 + s) * 1000
  }

  if (!durationMs && startTime && endTime) {
    durationMs = endTime.getTime() - startTime.getTime()
  }

  if (resultMatch) {
    const r = resultMatch[1].toLowerCase()
    status = r === 'success' ? 'success' : (r === 'warning' ? 'warning' : 'failed')
  } else {
    const errors = errorMatch ? parseInt(errorMatch[1], 10) : 0
    const warnings = warningMatch ? parseInt(warningMatch[1], 10) : 0
    if (errors > 0) status = 'failed'
    else if (warnings > 0) status = 'warning'
    else status = 'success'
  }

  if (!startTime && !endTime && !status) return null

  return {
    startTime: startTime ? startTime.toISOString() : null,
    endTime: endTime ? endTime.toISOString() : null,
    durationMs,
    status,
    size: sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : null,
    items: itemMatch ? parseInt(itemMatch[1].replace(/,/g, ''), 10) : null,
  }
}

/**
 * VDC — sin acceso al portal:
 *   Solo podemos inferir el estado del subject/bodyPreview.
 *   Start/End/Duration: null (limitación documentada).
 */
function parseVdcBody(message) {
  const text = `${message?.subject || ''} ${message?.bodyPreview || ''}`.toLowerCase()
  let status = 'success'
  if (text.includes('failed') || text.includes('error')) status = 'failed'
  else if (text.includes('warning')) status = 'warning'
  else if (text.includes('successfully')) status = 'success'

  return {
    startTime: null,
    endTime: null,
    durationMs: null,
    status,
  }
}

// ─── Status fallback (cuando el parser no devuelve nada) ────────────────────

function normalizeText(value) {
  return String(value || '').toLowerCase()
}

function inferExecutionStatusFromRule(message, rule) {
  const haystack = `${message?.subject || ''} ${message?.bodyPreview || ''}`.toLowerCase()
  const successWord = normalizeText(rule?.successWord || rule?.successKeywords)
  const errorWord = normalizeText(rule?.errorWord || rule?.errorKeywords)

  if (errorWord && haystack.includes(errorWord)) {
    return { status: 'failed', reason: 'Correo recibido (error detectado)' }
  }
  if (successWord && haystack.includes(successWord)) {
    return { status: 'success', reason: 'Correo recibido (éxito detectado)' }
  }
  if (String(rule?.id || '').toLowerCase().startsWith('as400') || message?.hasAttachments) {
    return { status: 'success', reason: 'Correo recibido' }
  }
  return { status: 'pending', reason: 'Correo recibido' }
}

// ─── Histórico de ejecuciones desde correos ─────────────────────────────────

async function getJobExecutionsFromEmailHistory(cfg, rule, jobName, limit = 200, sinceDays = 60) {
  if (!cfg?.graph?.tenantId) {
    return { ok: false, error: 'Falta configuración de Microsoft Graph.', executions: [] }
  }

  const fin = new Date()
  const inicio = new Date(fin.getTime() - (Number(sinceDays) || 60) * 24 * 60 * 60 * 1000)

  const allEmails = await getEmailsInRange(cfg, inicio, fin)

  const senderRule = normalizeText(rule?.sender)
  const subjectRule = normalizeText(rule?.subjectContains || rule?.title || rule?.name || jobName)

  const filtered = (Array.isArray(allEmails) ? allEmails : [])
    .filter((m) => {
      const fromAddr = normalizeText(m?.from?.emailAddress?.address)
      const senderAddr = normalizeText(m?.sender?.emailAddress?.address)
      const sender = senderAddr || fromAddr
      const subject = normalizeText(m?.subject)

      const senderOk =
        !senderRule ||
        !sender ||
        sender.includes(senderRule) ||
        senderRule.includes(sender) ||
        fromAddr.includes(senderRule) ||
        senderRule.includes(fromAddr)

      const isBarracuda =
        sender.includes('barracuda') ||
        fromAddr.includes('barracuda')

      const subjectOk =
        !subjectRule ||
        subject.includes(subjectRule) ||
        (isBarracuda && subject.includes('backup report'))

      return senderOk && subjectOk
    })
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())
    .slice(0, Number(limit) || 200)

  const ruleSource = detectRuleSource(rule)

  // Procesar en paralelo controlado (8 a la vez para no saturar Graph)
  const executions = []
  const concurrency = 8
  for (let i = 0; i < filtered.length; i += concurrency) {
    const batch = filtered.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(async (m, idx) => {
      const baseIndex = i + idx
      let parsed = null

      try {
        if (ruleSource === 'as400') {
          const txt = await fetchAs400Attachment(cfg, m.id)
          parsed = parseAs400Attachment(txt)
        } else if (ruleSource === 'barracuda') {
          const body = await getMessageBody(cfg, m.id)
          parsed = parseBarracudaBody(body)
        } else if (ruleSource === 'vdc') {
          parsed = parseVdcBody(m)
        }
      } catch (err) {
        logGraphError('PARSER_EXCEPTION', {
          source: ruleSource,
          messageId: m.id,
          error: err?.message || String(err),
        })
      }

      const inferred = inferExecutionStatusFromRule(m, rule)
      const status = parsed?.status || inferred.status

      return {
        id: m.id || `mail-${baseIndex}`,
        start: parsed?.startTime || m.receivedDateTime || null,
        end: parsed?.endTime || m.receivedDateTime || null,
        duration: parsed?.durationMs ?? null,
        status,
        result: status,
        reason: parsed?.code === 0
          ? 'Backup correcto'
          : parsed?.code != null
            ? `Código finalización: ${parsed.code}`
            : inferred.reason,
        source: 'email',
        subject: m.subject || '',
        bodyPreview: m.bodyPreview || '',
        hasAttachments: !!m.hasAttachments,
        // Extras Barracuda
        size: parsed?.size || null,
        items: parsed?.items || null,
        // Meta
        parserSource: ruleSource,
        parsed: !!parsed,
      }
    }))
    executions.push(...batchResults)
  }

  return {
    ok: true,
    jobName: jobName || rule?.title || rule?.name || 'Job email',
    totalExecutions: executions.length,
    executions,
  }
}

module.exports = {
  getGraphToken,
  getEmailsInRange,
  getEmails,
  getMessageBody,
  fetchAs400Attachment,
  sendGraphEmail,
  getJobExecutionsFromEmailHistory,
  // Parsers exportados por si quieres testearlos
  parseAs400Attachment,
  parseBarracudaBody,
  parseVdcBody,
  detectRuleSource,
}