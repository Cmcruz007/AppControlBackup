const jwt = require('jsonwebtoken')
const jwksRsa = require('jwks-rsa')

const DEFAULT_TENANT_ID = 'fc87712b-371a-4c4f-bb5d-0c9adbd85068'
const DEFAULT_CLIENT_ID = '9d8078b9-b0c6-4e95-a51f-1cf1b08c7d96'

function getEntraConfig() {
  const tenantId = process.env.BM_ENTRA_TENANT_ID || DEFAULT_TENANT_ID
  const clientId = process.env.BM_ENTRA_CLIENT_ID || DEFAULT_CLIENT_ID

  return {
    tenantId,
    clientId,
    issuers: [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ],
    audiences: [
      `api://${clientId}`,
      clientId,
    ],
    jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  }
}

function extractBearerToken(req) {
  const header = (req && req.headers && req.headers.authorization) || ''
  if (!header.startsWith('Bearer ')) return ''
  return header.slice(7).trim()
}

// ─── Cliente JWKS con soporte proxy corporativo ────────────────────────────
let cachedJwksClient = null

function buildJwksRequestAgent() {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.BM_PROXY_URL ||
    null

  if (!proxyUrl) return null

  try {
    const { HttpsProxyAgent } = require('https-proxy-agent')
    return new HttpsProxyAgent(proxyUrl)
  } catch (err) {
    console.error('[AUTH] https-proxy-agent no disponible:', err?.message || err)
    return null
  }
}

function getJwksClient(cfg) {
  if (cachedJwksClient) return cachedJwksClient

  const agent = buildJwksRequestAgent()

  cachedJwksClient = jwksRsa({
    jwksUri: cfg.jwksUri,
    cache: true,
    cacheMaxEntries: 10,
    cacheMaxAge: 10 * 60 * 1000, // 10 minutos
    rateLimit: true,
    jwksRequestsPerMinute: 10,
    timeout: 15000,
    requestAgent: agent || undefined,
  })

  return cachedJwksClient
}

async function verifyEntraToken(token) {
  const cfg = getEntraConfig()

  if (!token) {
    throw new Error('Token Entra ausente')
  }

  const client = getJwksClient(cfg)

  function getKey(header, callback) {
    if (!header || !header.kid) {
      return callback(new Error('Token sin kid'))
    }

    client.getSigningKey(header.kid, (err, key) => {
      if (err) {
        console.error('[AUTH] JWKS getSigningKey error:', err?.code || '', err?.message || err)
        return callback(err)
      }

      try {
        const signingKey = key.getPublicKey()
        callback(null, signingKey)
      } catch (e) {
        console.error('[AUTH] JWKS getPublicKey error:', e?.message || e)
        callback(e)
      }
    })
  }

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ['RS256'],
        issuer: cfg.issuers,
        audience: cfg.audiences,
      },
      (err, decoded) => {
        if (err) return reject(err)

        if (!decoded || typeof decoded !== 'object') {
          return reject(new Error('Token Entra inválido'))
        }

        if (decoded.tid && decoded.tid !== cfg.tenantId) {
          return reject(new Error('Token Entra con tenant no autorizado'))
        }

        resolve(decoded)
      }
    )
  })
}

module.exports = {
  getEntraConfig,
  extractBearerToken,
  verifyEntraToken,
}