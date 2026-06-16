// electron/modules/config.cjs
// Funciona con Electron (safeStorage/DPAPI) y sin Electron (AES-256-GCM)
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { getDataDir } = require('./utils.cjs')

// ─── Detectar Electron ──────────────────────────────────────────────────────
let electronApp = null
let electronSafeStorage = null
try {
  const electron = require('electron')
  if (electron.app && electron.app.getPath) {
    electronApp = electron.app
    electronSafeStorage = electron.safeStorage
  }
} catch (_) {}

const isElectron = !!electronApp

// ─── Rutas ──────────────────────────────────────────────────────────────────
function getPrivateConfigPath() {
  return path.join(getDataDir(), 'config-private.enc')
}

function getSharedConfigPath() {
  return process.env.SHARED_CONFIG_PATH || path.join(getDataDir(), 'config-shared.json')
}

function getLegacyConfigPath() {
  return path.join(getDataDir(), 'config.enc')
}

const PRIVATE_KEYS = ['sql', 'graph', 'refreshMinutes', 'toleranceMinutes', 'pin', 'manualOverrides']
const SHARED_KEYS  = ['criticalityByJob', 'veeamDataCloudRules', 'barracudaRules', 'as400Rules']

// ─── Cifrado AES-256-GCM (modo servidor sin Electron) ──────────────────────
function getAesKey() {
  const keyHex = process.env.BM_ENCRYPTION_KEY
  if (!keyHex || keyHex.length < 32) {
    throw new Error(
      'Variable de entorno BM_ENCRYPTION_KEY no definida o demasiado corta. ' +
      'Debe ser un string de al menos 32 caracteres.'
    )
  }
  // Derivar clave de 32 bytes (256 bits) a partir del string
  return crypto.createHash('sha256').update(keyHex).digest()
}

function aesEncrypt(plaintext) {
  const key = getAesKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Formato: iv (12) + authTag (16) + ciphertext
  return Buffer.concat([iv, authTag, encrypted])
}

function aesDecrypt(buffer) {
  const key = getAesKey()
  const iv = buffer.subarray(0, 12)
  const authTag = buffer.subarray(12, 28)
  const ciphertext = buffer.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8')
}

// ─── Encrypt / Decrypt (auto-selecciona Electron o AES) ────────────────────
function encryptString(plaintext) {
  if (isElectron && electronSafeStorage) {
    return electronSafeStorage.encryptString(plaintext)
  }
  return aesEncrypt(plaintext)
}

function decryptString(buffer) {
  if (isElectron && electronSafeStorage) {
    return electronSafeStorage.decryptString(buffer)
  }
  return aesDecrypt(buffer)
}

// ─── Load Config ────────────────────────────────────────────────────────────
function loadConfig() {
  // Config PRIVADA (cifrada)
  let priv = {}
  try {
    const privPath = getPrivateConfigPath()
    const legacyPath = getLegacyConfigPath()

    if (fs.existsSync(privPath)) {
      const encrypted = fs.readFileSync(privPath)
      priv = JSON.parse(decryptString(encrypted))
    } else if (fs.existsSync(legacyPath)) {
      // Migración desde config.enc antiguo (solo funciona en Electron)
      if (isElectron && electronSafeStorage) {
        const encrypted = fs.readFileSync(legacyPath)
        const old = JSON.parse(electronSafeStorage.decryptString(encrypted))
        priv = {}
        PRIVATE_KEYS.forEach(k => { if (old[k] !== undefined) priv[k] = old[k] })
        console.log('Migracion: config.enc -> config-private.enc')
      }
    }
  } catch (e) { console.error('Error cargando config privada:', e.message || e) }

  // Config COMPARTIDA (JSON plano)
  let shared = {}
  try {
    const sharedFile = getSharedConfigPath()
    if (fs.existsSync(sharedFile)) {
      shared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'))
    } else if (isElectron && fs.existsSync(getLegacyConfigPath())) {
      const encrypted = fs.readFileSync(getLegacyConfigPath())
      const old = JSON.parse(electronSafeStorage.decryptString(encrypted))
      SHARED_KEYS.forEach(k => { if (old[k] !== undefined) shared[k] = old[k] })
      console.log('Migracion: config.enc -> config-shared.json')
    }
  } catch (e) { console.error('Error cargando config compartida:', e.message || e) }

  return { ...priv, ...shared }
}

// ─── Validate ───────────────────────────────────────────────────────────────
function validateConfigInput(cfg) {
  if (!cfg || typeof cfg !== 'object') return {}
  const clean = {}

  if (cfg.sql && typeof cfg.sql === 'object') {
    clean.sql = {
      host: String(cfg.sql.host || '').trim().slice(0, 255),
      port: Math.max(1, Math.min(65535, Number(cfg.sql.port) || 1433)),
      database: String(cfg.sql.database || '').trim().slice(0, 128),
      user: String(cfg.sql.user || '').trim().slice(0, 128),
      password: String(cfg.sql.password || ''),
    }
  }

  if (cfg.graph && typeof cfg.graph === 'object') {
    clean.graph = {
      tenantId: String(cfg.graph.tenantId || '').trim().slice(0, 128),
      clientId: String(cfg.graph.clientId || '').trim().slice(0, 128),
      clientSecret: String(cfg.graph.clientSecret || ''),
      mailbox: String(cfg.graph.mailbox || '').trim().slice(0, 255),
      sinceHours: Math.max(1, Math.min(168, Number(cfg.graph.sinceHours) || 24)),
    }
  }

  if (cfg.refreshMinutes !== undefined) clean.refreshMinutes = Math.max(1, Math.min(1440, Number(cfg.refreshMinutes) || 5))
  if (cfg.toleranceMinutes !== undefined) clean.toleranceMinutes = Math.max(0, Math.min(1440, Number(cfg.toleranceMinutes) || 0))
  if (cfg.pin !== undefined) clean.pin = String(cfg.pin || '').slice(0, 10)

  if (cfg.manualOverrides && typeof cfg.manualOverrides === 'object') clean.manualOverrides = cfg.manualOverrides
  if (cfg.criticalityByJob && typeof cfg.criticalityByJob === 'object') clean.criticalityByJob = cfg.criticalityByJob
  if (Array.isArray(cfg.veeamDataCloudRules)) clean.veeamDataCloudRules = cfg.veeamDataCloudRules.slice(0, 100)
  if (Array.isArray(cfg.barracudaRules)) clean.barracudaRules = cfg.barracudaRules.slice(0, 100)
  if (Array.isArray(cfg.as400Rules)) clean.as400Rules = cfg.as400Rules.slice(0, 100)

  return clean
}

// ─── Save Config ────────────────────────────────────────────────────────────
function saveConfig(cfg) {
  cfg = validateConfigInput(cfg)
  let oldPriv = {}
  let oldShared = {}

  try {
    const privPath = getPrivateConfigPath()
    if (fs.existsSync(privPath)) {
      const encrypted = fs.readFileSync(privPath)
      oldPriv = JSON.parse(decryptString(encrypted))
    }
  } catch (e) { console.error('Error leyendo config privada anterior:', e.message || e) }

  try {
    const sharedFile = getSharedConfigPath()
    if (fs.existsSync(sharedFile)) {
      oldShared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'))
    }
  } catch (e) { console.error('Error leyendo config compartida anterior:', e.message || e) }

  const newPriv = { ...oldPriv }
  PRIVATE_KEYS.forEach(k => { if (cfg[k] !== undefined) newPriv[k] = cfg[k] })
  newPriv.manualOverrides = { ...(oldPriv.manualOverrides || {}), ...(cfg.manualOverrides || {}) }

  const hasCrit = cfg && typeof cfg.criticalityByJob === 'object' && cfg.criticalityByJob !== null
  const newShared = {
    ...oldShared,
    criticalityByJob: hasCrit ? { ...cfg.criticalityByJob } : (oldShared.criticalityByJob || {}),
    veeamDataCloudRules: cfg.veeamDataCloudRules !== undefined ? cfg.veeamDataCloudRules : (oldShared.veeamDataCloudRules || []),
    barracudaRules: cfg.barracudaRules !== undefined ? cfg.barracudaRules : (oldShared.barracudaRules || []),
    as400Rules: cfg.as400Rules !== undefined ? cfg.as400Rules : (oldShared.as400Rules || []),
  }

  try {
    const dataDir = getDataDir()
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
    const encrypted = encryptString(JSON.stringify(newPriv))
    fs.writeFileSync(getPrivateConfigPath(), encrypted)
  } catch (e) { console.error('Error escribiendo config privada:', e.message || e); return false }

  try {
    const sharedFile = getSharedConfigPath()
    const sharedDir = path.dirname(sharedFile)
    if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true })
    fs.writeFileSync(sharedFile, JSON.stringify(newShared, null, 2), 'utf8')
    console.log('GUARDADO EXITOSO. criticalityByJob:', JSON.stringify(newShared.criticalityByJob))
  } catch (e) { console.error('Error escribiendo config compartida:', e.message || e); return false }

  return true
}

module.exports = {
  getPrivateConfigPath, getSharedConfigPath, PRIVATE_KEYS, SHARED_KEYS,
  loadConfig, saveConfig, validateConfigInput, isElectron,
}