// electron/modules/graph.cjs
const { logGraphError } = require('./utils.cjs')

async function getGraphToken(graphCfg) {
  const authUrl = `https://login.microsoftonline.com/${graphCfg.tenantId}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: graphCfg.clientId, client_secret: graphCfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
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

async function getEmailsInRange(cfg, inicio, fin) {
  if (!cfg?.graph?.tenantId) throw new Error('Falta configuracion de Microsoft Graph (tenantId).')
  const g = cfg.graph
  const token = await getGraphToken(g)
  const filter = `receivedDateTime ge ${inicio.toISOString()} and receivedDateTime lt ${fin.toISOString()}`
  const params = new URLSearchParams({
    $filter: filter,
    $select: 'id,subject,receivedDateTime,bodyPreview,sender,from,hasAttachments',
    $top: '200', $orderby: 'receivedDateTime desc',
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

async function fetchAs400Attachment(cfg, messageId) {
  if (!cfg?.graph?.tenantId || !messageId) return null
  try {
    const token = await getGraphToken(cfg.graph)
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.graph.mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { logGraphError('AS400_ATTACHMENT_ERROR', { status: res.status, messageId }); return null }
    const data = await res.json()
    const attachments = data.value || []
    const file = attachments.find((a) => a.contentType && a.contentType.includes('text'))
      || attachments.find((a) => a.contentBytes)
    if (file && file.contentBytes) return Buffer.from(file.contentBytes, 'base64').toString('latin1')
  } catch (e) { logGraphError('AS400_ATTACHMENT_EXCEPTION', { message: e?.message, messageId }) }
  return null
}

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
        subject, body: { contentType: 'HTML', content: bodyHtml },
        toRecipients: mapR(toList), ccRecipients: mapR(ccList), bccRecipients: mapR(bccList),
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

module.exports = { getGraphToken, getEmailsInRange, getEmails, fetchAs400Attachment, sendGraphEmail }