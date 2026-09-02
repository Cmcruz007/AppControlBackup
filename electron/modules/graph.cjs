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

const VDC_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

// Construye un Date UTC a partir de las partes ya extraidas por regex.
// Devuelve null si el nombre del mes no se reconoce (defensivo).
function buildVdcUtcDate(monthName, day, year, hh, mi, ss) {
  const monthKey = String(monthName).slice(0, 3).toLowerCase()
  const month = VDC_MONTHS[monthKey]
  if (month === undefined) return null

  return new Date(Date.UTC(
    parseInt(year, 10),
    month,
    parseInt(day, 10),
    parseInt(hh, 10),
    parseInt(mi, 10),
    parseInt(ss, 10),
  ))
}

/**
 * Helper VDC: parsea la fecha/hora de finalizacion real que trae el correo
 * de Veeam Data Cloud. Veeam Data Cloud ha usado DOS formatos de cuerpo
 * distintos segun la fecha del correo (ambos confirmados por Carlos con
 * capturas/copias de correos reales):
 *
 * FORMATO NUEVO (correos recibidos desde el 19/08/2026), ej.:
 *   '... completed with warnings on August 28, 2026 at 00:57:03 UTC.'
 *   Patron: "on <Mes> <dia>, <año> at <HH:MM:SS> UTC"
 *   (con coma tras el dia, "at" antes de la hora, SIN dia de la semana).
 *
 * FORMATO ANTIGUO (correos recibidos hasta el 18/08/2026), ej.:
 *   '...that finished on Tue Aug 11 2026 23:45:01 UTC has completed with warning.'
 *   '...that finished on Sun Aug 16 2026 06:37:18 UTC has completed successfully.'
 *   Patron: "on <DiaSemana> <Mes> <dia> <año> <HH:MM:SS> UTC"
 *   (CON dia de la semana, SIN coma, SIN "at").
 *
 * Se prueba primero el formato nuevo (mas frecuente a dia de hoy) y, si no
 * hay match, se prueba el antiguo. Devuelve null si ninguno coincide
 * (comportamiento gracioso, no lanza error).
 */
function parseVdcTimestamp(clean) {
  const newFormatMatch = clean.match(
    /on\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{2}):(\d{2}):(\d{2})\s+UTC/i
  )
  if (newFormatMatch) {
    return buildVdcUtcDate(
      newFormatMatch[1], newFormatMatch[2], newFormatMatch[3],
      newFormatMatch[4], newFormatMatch[5], newFormatMatch[6],
    )
  }

  const oldFormatMatch = clean.match(
    /on\s+\w+\s+([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC/i
  )
  if (oldFormatMatch) {
    return buildVdcUtcDate(
      oldFormatMatch[1], oldFormatMatch[2], oldFormatMatch[3],
      oldFormatMatch[4], oldFormatMatch[5], oldFormatMatch[6],
    )
  }

  return null
}

/**
 * VDC — parsea el cuerpo del correo de notificación de Veeam Data Cloud.
 *
 * FIX 1 (llamada): esta función recibía antes SIEMPRE bodyContent vacío
 * porque en getJobExecutionsFromEmailHistory se llamaba como
 * parseVdcBody(m) en lugar de parseVdcBody(m, bodyContent). Ver llamada
 * corregida mas abajo, en getJobExecutionsFromEmailHistory.
 *
 * FIX 2 (fecha, dos formatos): ver parseVdcTimestamp mas arriba. El correo
 * de VDC NUNCA incluye una hora de INICIO real, solo la de finalizacion.
 * El INICIO se calcula aparte, en getJobExecutionsFromEmailHistory,
 * mediante computeVdcFixedStart(), ya que ese calculo necesita el nombre
 * del job y la ventana operacional (electron/modules/engine.cjs).
 *
 * FIX 3 (estado incorrecto -- detectado por Carlos con un correo real del
 * 12/08/2026): el cuerpo real dice "...has completed with warning." (SIN
 * la "s" final), pero el codigo anterior solo comprobaba el string exacto
 * "completed with warnings" (CON "s"), copiado del formato nuevo. Al no
 * coincidir, el codigo caia en un fallback generico que buscaba la palabra
 * suelta "error" en cualquier parte del texto -- y el propio disclaimer
 * que Veeam incluye en TODOS los correos ("Warning and error messages are
 * often informational...") contiene la palabra "error", disparando
 * incorrectamente el estado ERROR incluso en backups correctos con solo
 * un aviso. Se sustituye por regex con la "s" opcional
 * (warnings?/errors?) y se elimina el fallback de palabra suelta
 * "error"/"warning", que era la causa raiz del falso ERROR.
 *
 * FIX 4 (correo del 16/08/2026, confirmado por Carlos): un correo real con
 * el texto exacto "...that finished on Sun Aug 16 2026 06:37:18 UTC has
 * completed successfully." seguia mostrando Inicio=Fin en produccion, a
 * pesar de que el patron "formato antiguo" (ver parseVdcTimestamp) coincide
 * perfectamente con ese texto en pruebas aisladas. La causa mas probable
 * NO es el patron de fecha, sino que para ese correo concreto el cuerpo
 * completo (bodyContent, obtenido via una peticion HTTP adicional a Graph
 * en getMessageBody) llegara vacio o incompleto por un fallo puntual de
 * red/API, o por reescritura del mensaje por un gateway de seguridad
 * (el asunto de ese correo incluye el tag "[Iberlayer: Correo publicitario
 * detectado]"). Como fallback defensivo, si no se puede extraer la fecha
 * desde bodyContent, se reintenta contra bodyPreview (que Microsoft Graph
 * ya entrega en el listado inicial de correos, SIN peticion adicional, y
 * que en este caso contendria el mismo texto "finished on ... UTC" dentro
 * de sus primeros ~255 caracteres, ya que aparece muy pronto en el cuerpo).
 * Esto no sustituye investigar la causa raiz del fallo de bodyContent si
 * se repite con frecuencia, pero anade resiliencia sin tocar el patron de
 * fecha (que ya esta confirmado correcto).
 */
function parseVdcBody(message, bodyContent = '') {
  const clean = String(bodyContent || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const cleanPreview = String(message?.bodyPreview || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const lowerClean = clean.toLowerCase()
  const subjectPreview = `${message?.subject || ''} ${message?.bodyPreview || ''}`.toLowerCase()
  const fullText = `${subjectPreview} ${lowerClean}`

  // Orden de comprobacion: de mas especifico a menos especifico. En cuanto
  // una frase completa ("completed successfully/with warning(s)/with
  // error(s)") coincide, se fija el estado y no se sigue evaluando -- así
  // el disclaimer generico ("warning and error messages...") nunca llega
  // a ser el que decide el estado.
  let status = null

  if (/completed\s+successfully/i.test(fullText)) {
    status = 'success'
  } else if (/completed\s+with\s+warnings?\b/i.test(fullText)) {
    status = 'warning'
  } else if (/completed\s+with\s+errors?\b/i.test(fullText) || /\bfailed\b/i.test(fullText)) {
    status = 'failed'
  }
  // Si ninguna frase coincide, status queda en null y el llamador
  // (getJobExecutionsFromEmailHistory) cae al fallback generico basado en
  // successWord/errorWord de la regla (inferExecutionStatusFromRule).

  // FIX 4: primero se intenta con el cuerpo completo; si no hay match, se
  // reintenta con bodyPreview como red de seguridad (ver comentario arriba).
  let endTime = parseVdcTimestamp(clean)
  if (!endTime && cleanPreview) {
    endTime = parseVdcTimestamp(cleanPreview)
  }

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
  // dia -- ver filtrado "primer correo de la ventana" en
  // getJobExecutionsFromEmailHistory), no lo usamos para evitar
  // duraciones negativas o incoherentes.
  if (start.getTime() >= endTime.getTime()) return null

  return start
}

/**
 * Devuelve el inicio (18:00 local) de la VENTANA OPERACIONAL a la que
 * pertenece una fecha dada, como clave ISO string estable para agrupar.
 * Usamos la ventana operacional (18:00 -> 18:00 del dia siguiente) en vez
 * del "dia calendario natural" porque varios correos (VDC, Barracuda)
 * llegan pasada la medianoche y deben seguir contando como parte de la
 * ventana del dia anterior, no como un dia nuevo.
 */
function getWindowKey(date) {
  const { inicio } = getOperationalWindow(date)
  return inicio.toISOString()
}

/**
 * Para VDC, Barracuda y AS400, el proveedor (Veeam Data Cloud / Barracuda
 * / el propio AS400) puede enviar MAS DE UN correo dentro de la misma
 * ventana operacional de 24h (reintentos/relanzamientos internos, no
 * controlados por nosotros). SOLO la primera ejecucion de la ventana
 * (el correo recibido mas temprano) es la que consideramos la ejecucion
 * real a mostrar en el historico; el resto de correos de esa misma
 * ventana se descartan por completo.
 *
 * IMPORTANTE (caso Barracuda, confirmado por Carlos): Barracuda decide
 * por su cuenta cuando ejecutar el backup dentro del dia -- puede haber
 * 0, 1, 2 o mas correos en una misma ventana de 24h. Si hay 2 o mas, nos
 * quedamos solo con el primero (el mas temprano). Si no hay NINGUNO en
 * una ventana, esa ventana debe aparecer en el historico marcada con "-"
 * en Inicio/Fin/Duracion en vez de no aparecer (ver
 * fillMissingWindows mas abajo).
 *
 * Esta funcion agrupa los correos ya filtrados por job (mismo remitente +
 * asunto) por VENTANA OPERACIONAL (no por dia calendario natural, ver
 * getWindowKey), y para cada ventana se queda UNICAMENTE con el correo
 * recibido mas temprano, descartando el resto. Se aplica ANTES del
 * recorte por "limit" para no perder cobertura de dias antiguos si un dia
 * reciente concentra muchos correos de reintento.
 */
function keepFirstEmailPerWindow(emails) {
  const firstOfWindow = new Map()

  for (const m of emails) {
    const received = m?.receivedDateTime ? new Date(m.receivedDateTime) : null
    if (!received || Number.isNaN(received.getTime())) continue

    const key = getWindowKey(received)
    const current = firstOfWindow.get(key)

    if (!current || received.getTime() < new Date(current.receivedDateTime).getTime()) {
      firstOfWindow.set(key, m)
    }
  }

  return [...firstOfWindow.values()].sort(
    (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
  )
}

// Alias retrocompatible: el nombre anterior de esta funcion (usado en
// versiones previas de este fichero) agrupaba por dia calendario natural.
// Se mantiene el nombre exportado por si algun otro modulo lo referencia,
// pero ahora usa agrupacion por ventana operacional (mas correcta).
const keepFirstEmailPerDayVdc = keepFirstEmailPerWindow


/**
 * AS400: selecciona la mejor ejecucion de cada ventana DESPUES de analizar
 * todos los adjuntos candidatos. La ventana se obtiene del inicio real
 * extraido del log, no de receivedDateTime.
 *
 * Los correos cuyo adjunto no se puede parsear no ocupan una ventana y, por
 * tanto, no pueden desplazar un backup real ni impedir que fillMissingWindows
 * genere correctamente la fila SIN EJECUCION.
 */
/**
 * Deduplicado defensivo por ventana operacional DESPUES del parseo.
 *
 * VDC y Barracuda ya llegan normalmente con un unico correo por ventana
 * gracias a keepFirstEmailPerWindow(). Aun asi, esta segunda barrera evita
 * que una colision pueda reaparecer durante el parseo o por datos incompletos.
 *
 * IMPORTANTE: no se agrupa por dia calendario. Dos ventanas operacionales
 * distintas pueden contener marcas de tiempo del mismo dia natural y no deben
 * eliminarse entre si. Esta era una causa posible de filas reales sustituidas
 * por SIN EJECUCION en la primera carga del historico.
 */
function keepBestExecutionPerWindow(executions) {
  const bestOfWindow = new Map()

  const quality = (execution) => {
    let score = 0
    if (execution?.parsed) score += 100
    if (execution?.start) score += 20
    if (execution?.end) score += 20
    if (execution?.duration != null) score += 10
    if (execution?.hasLog) score += 5
    return score
  }

  for (const execution of executions) {
    const raw = execution?.start || execution?.end || execution?.date
    if (!raw) continue

    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) continue

    const key = getWindowKey(date)
    const current = bestOfWindow.get(key)

    if (!current || quality(execution) > quality(current)) {
      bestOfWindow.set(key, execution)
      continue
    }

    if (quality(execution) === quality(current)) {
      const currentTime = new Date(current?.start || current?.end || current?.date || 0).getTime()
      const executionTime = new Date(execution?.start || execution?.end || execution?.date || 0).getTime()
      if (executionTime < currentTime) bestOfWindow.set(key, execution)
    }
  }

  return [...bestOfWindow.values()].sort(
    (a, b) => new Date(b.start || b.end || b.date || 0).getTime() - new Date(a.start || a.end || a.date || 0).getTime()
  )
}

function keepBestAs400ExecutionPerWindow(executions) {
  const bestOfWindow = new Map()

  const quality = (execution) => {
    let score = 0
    if (execution?.parsed) score += 100
    if (execution?.start) score += 20
    if (execution?.end) score += 20
    if (execution?.duration != null) score += 10
    if (execution?.hasLog) score += 5
    return score
  }

  for (const execution of executions) {
    // Para AS400 solo aceptamos como ejecucion real un adjunto parseado.
    // `start` contiene entonces la fecha/hora real de arranque del trabajo.
    if (!execution?.parsed || !execution?.start) continue

    const start = new Date(execution.start)
    if (Number.isNaN(start.getTime())) continue

    const key = getWindowKey(start)
    const current = bestOfWindow.get(key)

    if (!current || quality(execution) > quality(current)) {
      bestOfWindow.set(key, execution)
      continue
    }

    if (quality(execution) === quality(current)) {
      const currentTime = new Date(current.start || current.end || 0).getTime()
      const executionTime = new Date(execution.start || execution.end || 0).getTime()
      if (executionTime > currentTime) bestOfWindow.set(key, execution)
    }
  }

  return [...bestOfWindow.values()].sort(
    (a, b) => new Date(b.start || b.end || 0).getTime() - new Date(a.start || a.end || 0).getTime()
  )
}

/**
 * VDC, Barracuda y AS400 pueden tener ventanas operacionales de 24h sin
 * NINGUN correo. Esta funcion construye filas "vacias"
 * (status: 'missing') para cada ventana operacional de las ultimas
 * `limit` ventanas en la que NO exista ya una ejecucion real.
 *
 * La clave interna siempre es el inicio de la ventana operacional.
 *
 * FECHA MOSTRADA:
 *   - AS400: se utiliza windowStart porque el backup pertenece al dia
 *     calendario en el que arranca, normalmente a las 22:40/22:50.
 *     Si una ventana de sabado no tiene ejecucion, debe mostrarse el
 *     sabado como SIN EJECUCION, no el domingo.
 *
 *   - VDC/Barracuda: se mantiene windowEnd para conservar el criterio
 *     actual, ya que sus ejecuciones pueden producirse de madrugada o
 *     dentro del dia calendario correspondiente al final de la ventana.
 *
 * Esto corrige en AS400:
 *   - La ausencia de los sabados 08/08, 15/08, 22/08 y 29/08.
 *   - Las fechas duplicadas con una ejecucion real y otra SIN EJECUCION.
 *   - El desplazamiento de las filas vacias al dia siguiente.
 */
function fillMissingWindows(executions, limit, ruleSource = 'unknown') {
  const maxWindows = Math.max(1, Math.min(500, Number(limit) || 30))

  const presentKeys = new Set(
    executions
      .map((e) => {
        const raw = e?.start || e?.end
        if (!raw) return null

        const d = new Date(raw)
        if (Number.isNaN(d.getTime())) return null

        return getWindowKey(d)
      })
      .filter(Boolean)
  )

  // Inicio exacto de la ventana operacional que contiene el instante
  // actual. Cada ventana anterior se obtiene restando bloques de 24 horas.
  const anchorStart = getOperationalWindow(new Date()).inicio
  const missingRows = []

  for (let i = 0; i < maxWindows; i++) {
    const windowStart = new Date(
      anchorStart.getTime() - i * 24 * 60 * 60 * 1000
    )

    const windowEnd = new Date(
      windowStart.getTime() + 24 * 60 * 60 * 1000
    )

    const key = windowStart.toISOString()

    if (presentKeys.has(key)) continue

    // AS400 pertenece al dia en el que comienza la ventana.
    // VDC y Barracuda mantienen el criterio existente basado en el final
    // de la ventana operacional.
    const displayDate = ruleSource === 'as400'
      ? windowStart
      : windowEnd

    missingRows.push({
      id: `missing-${key}`,

      start: null,
      end: null,
      duration: null,
      date: displayDate.toISOString(),

      status: 'missing',
      result: 'missing',
      reason: 'Sin ejecución en la ventana operacional (24h)',

      source: 'email',
      subject: '',
      bodyPreview: '',
      hasAttachments: false,

      as400LogContent: null,
      logContent: null,
      logText: null,
      emailLog: null,
      body: null,
      bodyContent: null,

      hasLog: false,
      logAvailable: false,
      hasEmailLog: false,
      emailLogAvailable: false,
      canOpenLog: false,
      logIcon: false,

      size: null,
      items: null,

      parserSource: ruleSource,
      parsed: false,
    })
  }

  const merged = [...executions, ...missingRows]

  merged.sort((a, b) => {
    const ta = new Date(
      a?.start || a?.end || a?.date || 0
    ).getTime()

    const tb = new Date(
      b?.start || b?.end || b?.date || 0
    ).getTime()

    return tb - ta
  })

  return merged.slice(0, maxWindows)
}// Alias retrocompatible (nombre anterior, cuando solo se aplicaba a
// Barracuda). Se mantiene por si algun otro modulo lo referencia.
const fillMissingBarracudaWindows = fillMissingWindows

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

// ─── Matching de asunto (subject) ───────────────────────────────────────────

// Escape para regex
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * FIX (cambio de formato de asunto en Veeam Data Cloud, detectado por Carlos
 * el 28/08/2026): hasta el 18/08/2026 los correos de VDC llegaban con el
 * asunto en formato:
 *
 *   Backup run of the policy "Exchange Online" finished with warning
 *
 * y desde el 19/08/2026 Veeam Data Cloud cambio el formato a:
 *
 *   [Cliente] "Exchange Online" policy run completed with warnings
 *
 * La regla guardada en Configuracion (p.ej. 'el asunto contiene: "Exchange
 * Online" policy') se comparaba ANTES como un unico string literal con
 * ORDEN fijo. Como el orden de las palabras se invirtio entre el formato
 * antiguo y el nuevo, la regla solo matcheaba el formato nuevo, y todo el
 * historial anterior al cambio (backups reales, no un problema de
 * retencion ni de limite de resultados) se descartaba en silencio en el
 * filtro.
 *
 * Con este fix, en vez de exigir el string COMPLETO en un orden concreto,
 * se parte el filtro en palabras sueltas (tokens) y se exige que TODAS
 * esas palabras aparezcan en el asunto, en cualquier orden y posicion.
 * Esto cubre ambos formatos (antiguo y nuevo) sin perder historial, y
 * sigue siendo "palabra exacta" (usa los mismos limites de palabra que
 * antes) para evitar falsos positivos tipo "Backup SD" matcheando dentro
 * de "Backup SDB/TGT".
 */
function buildSubjectTokenRegexes(subjectRule) {
  if (!subjectRule) return []

  return String(subjectRule)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}([^a-z0-9]|$)`, 'i'))
}

function subjectMatchesAllTokens(subject, tokenRegexes) {
  if (!tokenRegexes.length) return true
  return tokenRegexes.every((re) => re.test(subject))
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

  // Ver comentario detallado en buildSubjectTokenRegexes(): en vez de un
  // unico regex que exige el string completo en un orden fijo, usamos
  // varios regex (uno por palabra) y exigimos que TODOS matcheen, en
  // cualquier orden. Esto es lo que corrige el problema de VDC con el
  // cambio de formato de asunto de Veeam Data Cloud (19/08/2026).
  const subjectTokenRegexes = buildSubjectTokenRegexes(subjectRule)

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

      // Matching estricto por palabras sueltas (ver buildSubjectTokenRegexes):
      // SIEMPRE exige que todos los tokens del filtro esten presentes en el
      // asunto, en cualquier orden. Ya no hay fallback laxo tipo
      // (isBarracuda && /backup\s+report/i).
      const subjectOk = subjectMatchesAllTokens(subject, subjectTokenRegexes)

      return senderOk && subjectOk
    })
    .sort((a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())

  // Para VDC, Barracuda y AS400: nos quedamos solo con el primer correo de
  // cada VENTANA OPERACIONAL de 24h (la ejecucion real; el resto de
  // correos de esa misma ventana son reintentos/relanzamientos que se
  // descartan), antes de aplicar el limite, para no perder cobertura de
  // ventanas antiguas si una ventana reciente concentra varios reintentos.
  //
  // FIX (Barracuda, confirmado por Carlos): antes esta deduplicacion solo
  // se aplicaba a VDC y agrupaba por "dia calendario natural" en vez de
  // por ventana operacional. Para Barracuda, cuyo horario de ejecucion es
  // variable (decide "cuando lo considera oportuno"), agrupar por dia
  // calendario natural podia mezclar correos de ventanas distintas cuando
  // la ejecucion o el correo llegaban pasada la medianoche, provocando
  // duraciones incoherentes (p.ej. Inicio de un dia + Fin de la
  // madrugada del dia siguiente atribuido erroneamente al mismo dia).
  // VDC y Barracuda conservan el primer correo de cada ventana antes del
  // parseo. AS400 debe conservar TODOS los candidatos hasta analizar sus
  // adjuntos, porque el primer correo puede no contener el log parseable.
  const preLimitEmails = (ruleSource === 'vdc' || ruleSource === 'barracuda')
    ? keepFirstEmailPerWindow(matchedEmails)
    : matchedEmails

  // En AS400, `limit` es el numero final de ventanas del historial, no el
  // numero de correos candidatos. El recorte se aplica despues del parseo.
  const filtered = ruleSource === 'as400'
    ? preLimitEmails
    : preLimitEmails.slice(0, Number(limit) || 200)

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
          // FIX 4: parseVdcBody ahora tambien recibe el mensaje completo
          // para poder usar message.bodyPreview como fallback si
          // bodyContent no permite extraer la fecha.
          parsed = parseVdcBody(m, bodyContent)

          // El correo de VDC solo trae la hora de FIN. El INICIO es fijo
          // por tipo de backup (ver VDC_FIXED_SCHEDULE / computeVdcFixedStart
          // mas arriba), confirmado contra el portal de Veeam Data Cloud.
          // Gracias al filtrado "primer correo de la ventana"
          // (keepFirstEmailPerWindow) este endTime siempre corresponde a
          // la ejecucion original, por lo que el calculo del inicio fijo
          // debe ser coherente.
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
  // Para VDC/Barracuda/AS400 este paso ya no deberia encontrar colisiones (el
  // filtrado "primer correo de la ventana" ya dejo como maximo 1 ejecucion por
  // ventana), pero se mantiene sin cambios como red de seguridad generica.
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

  // VDC, Barracuda y AS400 se deduplican por VENTANA OPERACIONAL.
  // No usamos bestByDay para estas fuentes: el dia calendario puede mezclar
  // dos ventanas distintas y eliminar una ejecucion valida antes de rellenar
  // los huecos. Para fuentes desconocidas se conserva el comportamiento
  // historico por dia calendario.
  let dedupedExecutions
  if (ruleSource === 'as400') {
    dedupedExecutions = keepBestAs400ExecutionPerWindow(executions)
  } else if (ruleSource === 'vdc' || ruleSource === 'barracuda') {
    dedupedExecutions = keepBestExecutionPerWindow(executions)
  } else {
    dedupedExecutions = [...bestByDay.values()]
      .sort((a, b) => new Date(b.start || b.end || 0).getTime() - new Date(a.start || a.end || 0).getTime())
  }

  // FIX (confirmado por Carlos, objetivo: 30 ultimas ejecuciones para VDC,
  // Barracuda y AS400): VDC/Barracuda/AS400 pueden tener ventanas
  // operacionales de 24h sin ninguna ejecucion real. Rellenamos esas
  // ventanas vacias con filas "missing" (status: 'missing') para que el
  // historico muestre siempre hasta `limit` ventanas, marcando con "-" las
  // que no tuvieron ejecucion en vez de mostrar menos filas de las
  // pedidas. Ver fillMissingWindows para el detalle del fix de calculo de
  // ventanas (evita duplicados por desajuste de hora).
  if (ruleSource === 'vdc' || ruleSource === 'barracuda' || ruleSource === 'as400') {
    dedupedExecutions = fillMissingWindows(
      dedupedExecutions,
      limit,
      ruleSource
    )
  }

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
  keepFirstEmailPerWindow,
  keepFirstEmailPerDayVdc,
  keepBestExecutionPerWindow,
  keepBestAs400ExecutionPerWindow,
  fillMissingWindows,
  fillMissingBarracudaWindows,
  detectRuleSource,
  buildSubjectTokenRegexes,
  subjectMatchesAllTokens,

  // Limpieza logs
  cleanBarracudaFooter,
  cleanVdcFooter,
}
