// electron/modules/graph.cjs
const { logGraphError, pad2 } = require('./utils.cjs')
const { getOperationalWindow } = require('./engine.cjs')

// ─── Limpieza de logs email ─────────────────────────────────────────────────

function cleanBarracudaFooter(content) {
  if (!content) return content

  return String(content)
    .replace(/You can contact Barracuda Networks[\s\S]*$/i, '')
    .trim()
}

function cleanVdcFooter(content) {
  if (!content) return content

  return String(content)
    .replace(/Please view your backup logs for further details:\s*(<br\s*\/?>|\r?\n|\s)*View logs\s*(<br\s*\/?>|\r?\n|\s)*N?\s*$/i, '')
    .replace(/Please view your backup logs for further details:[\s\S]*$/i, '')
    .trim()
}

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

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

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

  const toList = parseRecipients(to)
  const ccList = parseRecipients(cc)
  const bccList = parseRecipients(bcc)

  if (!toList.length) throw new Error('No hay destinatarios validos en "Para".')

  const mapR = (list) => list.map((address) => ({ emailAddress: { address } }))

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
        toRecipients: mapR(toList),
        ccRecipients: mapR(ccList),
        bccRecipients: mapR(bccList),
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

    return new Date(
      year,
      parseInt(mm, 10) - 1,
      parseInt(dd, 10),
      parseInt(hh, 10),
      parseInt(mi, 10),
      parseInt(ss, 10),
    )
  }

  let startTime = null
  let endTime = null
  let durationMs = null
  let status = null
  let code = null

  if (startMatch) {
    startTime = parseDate(
      startMatch[1],
      startMatch[2],
      startMatch[3],
      startMatch[4],
      startMatch[5],
      startMatch[6],
    )
  }

  if (endMatch) {
    endTime = parseDate(
      endMatch[1],
      endMatch[2],
      endMatch[3],
      endMatch[4],
      endMatch[5],
      endMatch[6],
    )
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

  let startTime = null
  let endTime = null
  let durationMs = null
  let status = null

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
 * Helper VDC: parsea la fecha/hora de finalizacion real que trae el correo
 * de Veeam Data Cloud.
 *
 * FORMATO REAL (confirmado por Carlos con captura de pantalla de un correo
 * real de la EJECUCION AUTOMATICA/PROGRAMADA -- la unica que controlamos):
 *
 *   Asunto: 'Backup run of the policy "Exchange Online" finished with warning'
 *   Cuerpo: 'The backup "Exchange Online" for Union de Creditos Inmobiliarios
 *            EFC S.A that finished on Mon Aug 10 2026 23:51:03 UTC has
 *            completed with warning.'
 *
 * Patron: "finished on <dia semana> <mes abrev> <dia> <año> <HH:MM:SS> UTC"
 * (con dia de la semana, SIN coma, SIN "at"). Este es el patron PRINCIPAL.
 *
 * Se mantiene como variante de respaldo (por si Veeam usa otra plantilla en
 * correos de relanzamiento, que no controlamos pero tampoco queremos que
 * rompan el parseo si llegaran a procesarse):
 *   "... completed with warnings on August 28, 2026 at 00:57:03 UTC."
 * Patron: "on <mes completo>, <dia> <año> at <HH:MM:SS> UTC" (sin dia de
 * semana, con coma, con "at").
 */
function parseVdcTimestamp(clean) {
  // Patron PRINCIPAL: formato real de la ejecucion automatica/programada.
  let match = clean.match(
    /finished\s+on\s+[A-Za-z]+\s+([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC/i
  )

  // Fallback: variante alternativa (posible plantilla de relanzamiento).
  if (!match) {
    match = clean.match(
      /on\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{2}):(\d{2}):(\d{2})\s+UTC/i
    )
  }

  if (!match) return null

  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
  const monthKey = match[1].slice(0, 3).toLowerCase()
  const month = months[monthKey]
  if (month === undefined) return null

  const day = parseInt(match[2], 10)
  const year = parseInt(match[3], 10)
  const hh = parseInt(match[4], 10)
  const mi = parseInt(match[5], 10)
  const ss = parseInt(match[6], 10)

  return new Date(Date.UTC(year, month, day, hh, mi, ss))
}

/**
 * VDC — parsea el cuerpo del correo de notificación de Veeam Data Cloud.
 *
 * FIX 1 (llamada): esta función recibía antes SIEMPRE bodyContent vacío
 * porque en getJobExecutionsFromEmailHistory se llamaba como
 * parseVdcBody(m) en lugar de parseVdcBody(m, bodyContent). Ver llamada
 * corregida mas abajo, en getJobExecutionsFromEmailHistory.
 *
 * FIX 2 (patron de fecha): corregido para reconocer el formato REAL de la
 * ejecucion automatica/programada de VDC (ver comentario en
 * parseVdcTimestamp mas arriba). El patron anterior no reconocia el
 * formato con dia de la semana, por lo que endTime salia null para las
 * ejecuciones automaticas reales.
 *
 * NOTA: el correo de VDC NUNCA incluye una hora de INICIO real, solo la
 * hora de finalizacion. El INICIO se calcula aparte, en
 * getJobExecutionsFromEmailHistory, mediante computeVdcFixedStart() (ver
 * mas abajo), ya que ese calculo necesita el nombre del job y la ventana
 * operacional (electron/modules/engine.cjs), datos que esta funcion no
 * tiene disponibles.
 */
function parseVdcBody(message, bodyContent = '') {
  const clean = String(bodyContent || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const lowerClean = clean.toLowerCase()
  const subjectPreview = `${message?.subject || ''} ${message?.bodyPreview || ''}`.toLowerCase()
  const fullText = `${subjectPreview} ${lowerClean}`

  let status = 'success'

  if (fullText.includes('completed successfully')) status = 'success'
  else if (fullText.includes('completed with errors') || fullText.includes('failed')) status = 'failed'
  else if (fullText.includes('error')) status = 'failed'
  else if (fullText.includes('warning')) status = 'warning'

  const endTime = parseVdcTimestamp(clean)

  return {
    // Se rellena en getJobExecutionsFromEmailHistory via computeVdcFixedStart.
    startTime: null,
    endTime: endTime ? endTime.toISOString() : null,
    durationMs: null,
    status,
  }
}

/**
 * Horario FIJO de inicio por tipo de backup VDC, expresado como offset en
 * minutos desde el inicio de la ventana operacional (18:00 local, ver
 * getOperationalWindow en electron/modules/engine.cjs).
 *
 * Valores confirmados por Carlos a partir del registro de actividad real
 * del portal Veeam Data Cloud ("Backup Policy Started") y re-verificados
 * contra el listado real de ejecuciones del portal (start/end reales):
 *   - Sharepoint + Teams -> 22:00 (18:00 + 4h00)  [mismo dia de la ventana]
 *   - Exchange Online    -> 01:30 (18:00 + 7h30)  [dia siguiente]
 *   - OneDrive           -> 02:30 (18:00 + 8h30)  [dia siguiente]
 *
 * Si en el futuro cambia el horario de alguna politica VDC en el portal,
 * este es el UNICO sitio a actualizar.
 */
const VDC_FIXED_SCHEDULE = [
  { match: /sharepoint|teams/i, offsetMinutes: 4 * 60 },      // 22:00
  { match: /exchange/i, offsetMinutes: 7 * 60 + 30 },         // 01:30
  { match: /onedrive/i, offsetMinutes: 8 * 60 + 30 },         // 02:30
]

/**
 * Calcula el inicio fijo de un job VDC a partir de su nombre y de la hora
 * de finalizacion real (extraida del correo). Devuelve null si el nombre
 * del job no coincide con ningun tipo VDC conocido, o si el resultado no
 * es coherente (inicio posterior al fin).
 */
function computeVdcFixedStart(jobName, endTime) {
  if (!endTime || Number.isNaN(endTime.getTime())) return null

  const rule = VDC_FIXED_SCHEDULE.find((r) => r.match.test(jobName || ''))
  if (!rule) return null

  const { inicio } = getOperationalWindow(endTime)
  const start = new Date(inicio.getTime() + rule.offsetMinutes * 60000)

  // Salvaguarda: si el inicio calculado quedara despues del fin real (no
  // deberia pasar con estos offsets salvo que el "end" usado no sea el de
  // la ejecucion original, p.ej. por un correo de relanzamiento del mismo
  // dia -- ver filtrado "primer correo del dia" en
  // getJobExecutionsFromEmailHistory), no lo usamos para evitar
  // duraciones negativas o incoherentes.
  if (start.getTime() >= endTime.getTime()) return null

  return start
}

/**
 * Para VDC, Veeam puede enviar MAS DE UN correo de finalizacion el mismo
 * dia para el mismo job (relanzamientos/reintentos internos del propio
 * servicio VDC, no controlados por nosotros). Segun confirma Carlos, SOLO
 * la ejecucion automatica/programada (la PRIMERA del dia) es la que
 * controlamos, y tiene el horario de inicio FIJO conocido
 * (VDC_FIXED_SCHEDULE); los correos posteriores del mismo dia (relanzamientos)
 * deben omitirse por completo, no se procesan como ejecuciones independientes.
 *
 * Esta funcion agrupa los correos ya filtrados por job (mismo remitente +
 * asunto) por dia calendario de recepcion, y para cada dia se queda
 * UNICAMENTE con el correo recibido mas temprano (el primero), descartando
 * el resto. Se aplica ANTES del recorte por "limit" para no perder
 * cobertura de dias antiguos si un dia reciente concentra muchos correos
 * de relanzamiento.
 */
function keepFirstEmailPerDayVdc(emails) {
  const firstOfDay = new Map()

  for (const m of emails) {
    const received = m?.receivedDateTime ? new Date(m.receivedDateTime) : null
    if (!received || Number.isNaN(received.getTime())) continue

    const dayKey = `${received.getFullYear()}-${pad2(received.getMonth() + 1)}-${pad2(received.getDate())}`
    const current = firstOfDay.get(dayKey)

    if (!current || received.getTime() < new Date(current.receivedDateTime).getTime()) {
      firstOfDay.set(dayKey, m)
    }
  }

  return [...firstOfDay.values()].sort(
    (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
  )
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

  // Detectamos la fuente ANTES de construir subjectRule para poder usarla.
  const ruleSource = detectRuleSource(rule)

  // Para Barracuda, si no hay subjectContains explícito, deducimos el servicio
  // (SharePoint / OneDrive / Exchange / Teams) desde el nombre del job.
  const extractBarracudaService = (name) => {
    const n = String(name || '').toLowerCase()
    if (/sharepoint/.test(n)) return 'SharePoint'
    if (/onedrive/.test(n))   return 'OneDrive'
    if (/exchange/.test(n))   return 'Exchange'
    if (/teams/.test(n))      return 'Teams'
    return null
  }

  const barracudaService = (ruleSource === 'barracuda')
    ? extractBarracudaService(jobName)
    : null

  const subjectRule = normalizeText(
    rule?.subjectContains ||
    barracudaService ||
    rule?.title ||
    rule?.name ||
    jobName
  )

  // Escape para regex
  const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Para subjectRule construimos una regex que matchea como "palabra exacta"
  // para evitar que "Backup SD" matche "Backup SDB/TGT"
  const subjectRegex = subjectRule
    ? new RegExp(`(^|[^a-z0-9])${escapeRegex(subjectRule)}([^a-z0-9]|$)`, 'i')
    : null

  const matchedEmails = (Array.isArray(allEmails) ? allEmails : [])
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

      // Matching estricto: SIEMPRE exige el token del servicio.
      // Ya no hay fallback laxo tipo (isBarracuda && /backup\s+report/i).
      const subjectOk = !subjectRegex || subjectRegex.test(subject)

      return senderOk && subjectOk
    })
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())

  // Para VDC: nos quedamos solo con el primer correo de cada dia (la
  // ejecucion automatica/programada, la unica que controlamos), antes de
  // aplicar el limite, para no perder dias antiguos si un dia reciente
  // concentra varios relanzamientos.
  const preLimitEmails = ruleSource === 'vdc'
    ? keepFirstEmailPerDayVdc(matchedEmails)
    : matchedEmails

  const filtered = preLimitEmails.slice(0, Number(limit) || 200)

  // Procesar en paralelo controlado
  const executions = []
  const concurrency = 8

  for (let i = 0; i < filtered.length; i += concurrency) {
    const batch = filtered.slice(i, i + concurrency)

    const batchResults = await Promise.all(batch.map(async (m, idx) => {
      const baseIndex = i + idx

      let parsed = null
      let as400LogContent = null
      let logContent = null
      let bodyContent = null

      try {
        if (ruleSource === 'as400') {
          as400LogContent = await fetchAs400Attachment(cfg, m.id)
          logContent = as400LogContent
          parsed = parseAs400Attachment(as400LogContent)
        } else if (ruleSource === 'barracuda') {
          bodyContent = await getMessageBody(cfg, m.id)
          bodyContent = cleanBarracudaFooter(bodyContent)

          logContent = bodyContent
          parsed = parseBarracudaBody(bodyContent)
        } else if (ruleSource === 'vdc') {
          bodyContent = await getMessageBody(cfg, m.id)
          bodyContent = cleanVdcFooter(bodyContent)

          logContent = bodyContent
          // FIX: antes se llamaba parseVdcBody(m) sin bodyContent, por lo
          // que endTime siempre salia null (ver comentario en parseVdcBody).
          parsed = parseVdcBody(m, bodyContent)

          // El correo de VDC solo trae la hora de FIN. El INICIO es fijo
          // por tipo de backup (ver VDC_FIXED_SCHEDULE / computeVdcFixedStart
          // mas arriba), confirmado contra el portal de Veeam Data Cloud.
          // Gracias al filtrado "primer correo del dia" (keepFirstEmailPerDayVdc)
          // este endTime siempre corresponde a la ejecucion automatica
          // original, por lo que el calculo del inicio fijo debe ser coherente.
          if (parsed?.endTime) {
            const endDate = new Date(parsed.endTime)
            const fixedStart = computeVdcFixedStart(jobName, endDate)
            if (fixedStart) {
              parsed.startTime = fixedStart.toISOString()
              parsed.durationMs = endDate.getTime() - fixedStart.getTime()
            }
          }
        } else if (m?.hasAttachments) {
          // Fallback: si tiene adjunto pero la regla no se detecta como AS400,
          // intentamos cargarlo igualmente para que el modal pueda mostrarlo.
          as400LogContent = await fetchAs400Attachment(cfg, m.id)
          logContent = as400LogContent
          parsed = parseAs400Attachment(as400LogContent)
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

      const hasLogContent = Boolean(logContent || as400LogContent || bodyContent)

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

        // ✅ Contenido real para modal de log
        as400LogContent: as400LogContent || null,
        logContent: logContent || null,
        logText: logContent || null,
        emailLog: logContent || null,
        body: bodyContent || null,
        bodyContent: bodyContent || null,

        // ✅ Flags para frontend
        hasLog: hasLogContent,
        logAvailable: hasLogContent,
        hasEmailLog: hasLogContent,
        emailLogAvailable: hasLogContent,
        canOpenLog: hasLogContent,
        logIcon: hasLogContent,

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

  // Deduplicado por dia de ejecucion real (AS400 en concreto puede recibir mas
  // de un correo con el mismo asunto/remitente para la misma ejecucion, p.ej. un
  // segundo correo 'Log Backup RR' cuyo adjunto no trae el patron esperado y no
  // se puede parsear). Si dos o mas ejecuciones caen en el mismo dia calendario
  // (segun start, con fallback a end/receivedDateTime), nos quedamos solo con la
  // que tiene datos realmente parseados (parsed === true); si ninguna se pudo
  // parsear, nos quedamos con la mas reciente de ese dia para no perder el rastro.
  // Para VDC este paso ya no deberia encontrar colisiones (el filtrado
  // "primer correo del dia" ya dejo como maximo 1 ejecucion por dia), pero se
  // mantiene sin cambios como red de seguridad generica para todas las fuentes.
  const getDayKey = (execution) => {
    const raw = execution?.start || execution?.end || execution?.receivedDateTime
    if (!raw) return null
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const bestByDay = new Map()

  for (const execution of executions) {
    const dayKey = getDayKey(execution)

    if (!dayKey) {
      // Sin fecha valida: lo dejamos pasar tal cual, con clave unica por id.
      bestByDay.set(`no-date:${execution.id}`, execution)
      continue
    }

    const current = bestByDay.get(dayKey)

    if (!current) {
      bestByDay.set(dayKey, execution)
      continue
    }

    const currentParsed = !!current.parsed
    const executionParsed = !!execution.parsed

    if (executionParsed && !currentParsed) {
      bestByDay.set(dayKey, execution)
    } else if (executionParsed === currentParsed) {
      const currentTime = new Date(current?.start || current?.end || 0).getTime()
      const executionTime = new Date(execution?.start || execution?.end || 0).getTime()
      if (executionTime > currentTime) bestByDay.set(dayKey, execution)
    }
    // Si current ya esta parseado y execution no, se ignora execution (se descarta el fantasma).
  }

  const dedupedExecutions = [...bestByDay.values()]
    .sort((a, b) => new Date(b.start || b.end || 0).getTime() - new Date(a.start || a.end || 0).getTime())

  return {
    ok: true,
    jobName: jobName || rule?.title || rule?.name || 'Job email',
    totalExecutions: dedupedExecutions.length,
    executions: dedupedExecutions,
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
  parseVdcTimestamp,
  computeVdcFixedStart,
  keepFirstEmailPerDayVdc,
  detectRuleSource,

  // Limpieza logs
  cleanBarracudaFooter,
  cleanVdcFooter,
}
