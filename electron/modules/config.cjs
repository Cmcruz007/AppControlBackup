// electron/modules/config.cjs
const { app, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')

const PRIVATE_CONFIG_FILE = () => path.join(app.getPath('userData'), 'config-private.enc')
const SHARED_CONFIG_FILE = () =>
  process.env.SHARED_CONFIG_PATH || path.join(app.getPath('userData'), 'config-shared.json')

const PRIVATE_KEYS = ['sql', 'graph', 'refreshMinutes', 'toleranceMinutes', 'pin', 'manualOverrides']
const SHARED_KEYS  = ['criticalityByJob', 'veeamDataCloudRules', 'barracudaRules', 'as400Rules']

function validateConfigInput(cfg) {
  if (!cfg || typeof cfg !== 'object') return {}

  const clean = {}

  // SQL
  if (cfg.sql && typeof cfg.sql === 'object') {
    clean.sql = {
      host: String(cfg.sql.host || '').trim().slice(0, 255),
      port: Math.max(1, Math.min(65535, Number(cfg.sql.port) || 1433)),
      database: String(cfg.sql.database || '').trim().slice(0, 128),
      user: String(cfg.sql.user || '').trim().slice(0, 128),
      password: String(cfg.sql.password || ''),
    }
  }

  // Graph
  if (cfg.graph && typeof cfg.graph === 'object') {
    clean.graph = {
      tenantId: String(cfg.graph.tenantId || '').trim().slice(0, 128),
      clientId: String(cfg.graph.clientId || '').trim().slice(0, 128),
      clientSecret: String(cfg.graph.clientSecret || ''),
      mailbox: String(cfg.graph.mailbox || '').trim().slice(0, 255),
      sinceHours: Math.max(1, Math.min(168, Number(cfg.graph.sinceHours) || 24)),
    }
  }

  // Escalares
  if (cfg.refreshMinutes !== undefined) clean.refreshMinutes = Math.max(1, Math.min(1440, Number(cfg.refreshMinutes) || 5))
  if (cfg.toleranceMinutes !== undefined) clean.toleranceMinutes = Math.max(0, Math.min(1440, Number(cfg.toleranceMinutes) || 0))
  if (cfg.pin !== undefined) clean.pin = String(cfg.pin || '').slice(0, 10)

  // Objetos pass-through (ya validados en sus paneles)
  if (cfg.manualOverrides && typeof cfg.manualOverrides === 'object') clean.manualOverrides = cfg.manualOverrides
  if (cfg.criticalityByJob && typeof cfg.criticalityByJob === 'object') clean.criticalityByJob = cfg.criticalityByJob
  if (Array.isArray(cfg.veeamDataCloudRules)) clean.veeamDataCloudRules = cfg.veeamDataCloudRules.slice(0, 100)
  if (Array.isArray(cfg.barracudaRules)) clean.barracudaRules = cfg.barracudaRules.slice(0, 100)
  if (Array.isArray(cfg.as400Rules)) clean.as400Rules = cfg.as400Rules.slice(0, 100)

  return clean
}


function loadConfig() {
  let priv = {}
  try {
    if (fs.existsSync(PRIVATE_CONFIG_FILE())) {
      const encrypted = fs.readFileSync(PRIVATE_CONFIG_FILE())
      priv = JSON.parse(safeStorage.decryptString(encrypted))
    } else if (fs.existsSync(path.join(app.getPath('userData'), 'config.enc'))) {
      const encrypted = fs.readFileSync(path.join(app.getPath('userData'), 'config.enc'))
      const old = JSON.parse(safeStorage.decryptString(encrypted))
      priv = {}
      PRIVATE_KEYS.forEach(k => { if (old[k] !== undefined) priv[k] = old[k] })
      console.log('Migracion: config.enc -> config-private.enc')
    }
  } catch (e) { console.error('Error cargando config privada:', e) }

  let shared = {}
  try {
    const sharedFile = SHARED_CONFIG_FILE()
    if (fs.existsSync(sharedFile)) {
      shared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'))
    } else if (fs.existsSync(path.join(app.getPath('userData'), 'config.enc'))) {
      const encrypted = fs.readFileSync(path.join(app.getPath('userData'), 'config.enc'))
      const old = JSON.parse(safeStorage.decryptString(encrypted))
      SHARED_KEYS.forEach(k => { if (old[k] !== undefined) shared[k] = old[k] })
      console.log('Migracion: config.enc -> config-shared.json')
    }
  } catch (e) { console.error('Error cargando config compartida:', e) }

  return { ...priv, ...shared }
}

function saveConfig(cfg) {
  cfg = validateConfigInput(cfg)
  let oldPriv = {}
  let oldShared = {}

  try {
    if (fs.existsSync(PRIVATE_CONFIG_FILE())) {
      const encrypted = fs.readFileSync(PRIVATE_CONFIG_FILE())
      oldPriv = JSON.parse(safeStorage.decryptString(encrypted))
    }
  } catch (e) { console.error('Error leyendo config privada anterior:', e) }

  try {
    const sharedFile = SHARED_CONFIG_FILE()
    if (fs.existsSync(sharedFile)) {
      oldShared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'))
    }
  } catch (e) { console.error('Error leyendo config compartida anterior:', e) }

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
    const encrypted = safeStorage.encryptString(JSON.stringify(newPriv))
    fs.writeFileSync(PRIVATE_CONFIG_FILE(), encrypted)
  } catch (e) { console.error('Error escribiendo config privada:', e); return false }

  try {
    const sharedFile = SHARED_CONFIG_FILE()
    const sharedDir = path.dirname(sharedFile)
    if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true })
    fs.writeFileSync(sharedFile, JSON.stringify(newShared, null, 2), 'utf8')
    console.log('GUARDADO EXITOSO. criticalityByJob:', JSON.stringify(newShared.criticalityByJob))
  } catch (e) { console.error('Error escribiendo config compartida:', e); return false }

  return true
}

module.exports = { PRIVATE_CONFIG_FILE, SHARED_CONFIG_FILE, PRIVATE_KEYS, SHARED_KEYS, loadConfig, saveConfig, validateConfigInput }