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
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    audiences: [
      `api://${clientId}`,
      clientId,
    ],
    jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  }
}

function extractBearerToken(req) {
  const header = req.headers.authorization || ''

  if (!header.startsWith('Bearer ')) return ''

  return header.slice(7).trim()
}

async function verifyEntraToken(token) {
  const cfg = getEntraConfig()

  if (!token) {
    throw new Error('Token Entra ausente')
  }

  const client = jwksRsa({
    jwksUri: cfg.jwksUri,
    cache: true,
    cacheMaxEntries: 10,
    cacheMaxAge: 10 * 60 * 1000,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  })

  function getKey(header, callback) {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err)

      const signingKey = key.getPublicKey()
      callback(null, signingKey)
    })
  }

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ['RS256'],
        issuer: cfg.issuer,
        audience: cfg.audiences,
      },
      (err, decoded) => {
        if (err) return reject(err)

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