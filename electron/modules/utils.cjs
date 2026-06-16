// electron/modules/utils.cjs
const { app } = require('electron')
const path = require('path')
const fs = require('fs')

function safeLower(value) {
  if (value == null) return ''
  return String(value).toLowerCase()
}

function normalizeCriticality(value) {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low'
}

function normalizeManualStatus(value) {
  return ['success', 'warning', 'failed', 'running', 'pending'].includes(value) ? value : undefined
}

function logGraphError(message, extra = {}) {
  try {
    const dir = app.getPath('userData')
    const file = path.join(dir, 'graph-debug.log')
    const line = `[${new Date().toISOString()}] ${message} ${JSON.stringify(extra)}\n`
    fs.appendFileSync(file, line, 'utf8')
  } catch (err) {
    try {
      const fallback = path.join(process.cwd(), 'graph-debug.log')
      const line = `[${new Date().toISOString()}] LOG_WRITE_FAIL ${message} ${JSON.stringify({
        extra,
        writeError: err?.message || String(err),
      })}\n`
      fs.appendFileSync(fallback, line, 'utf8')
    } catch (_) {}
  }
}

function normalizeVdcRule(rule, index = 0, prefix = 'vdc') {
  return {
    id: String(rule?.id || `${prefix}-rule-${index + 1}`),
    title: String(rule?.title || '').trim(),
    sender: String(rule?.sender || '').trim(),
    subjectContains: String(rule?.subjectContains || '').trim(),
    errorWord: String(rule?.errorWord || '').trim(),
    successWord: String(rule?.successWord || '').trim(),
    enabled: rule?.enabled !== false,
  }
}

function normalizeAs400Rule(rule, index = 0) {
  return {
    id: String(rule?.id || `as400-rule-${index + 1}`),
    title: String(rule?.title || rule?.name || '').trim(),
    name: String(rule?.name || rule?.title || '').trim(),
    sender: String(rule?.sender || '').trim(),
    subjectContains: String(rule?.subjectContains || '').trim(),
    pattern: String(rule?.pattern || rule?.subjectContains || '').trim(),
    errorWord: String(rule?.errorWord || '').trim(),
    successWord: String(rule?.successWord || '').trim(),
    enabled: rule?.enabled !== false,
    notes: String(rule?.notes || '').trim(),
  }
}

function includesCI(text, search) {
  if (!text || !search) return false
  const t = String(text).toLowerCase()
  const s = String(search).trim().toLowerCase()
  if (s.startsWith('regex:')) {
    try {
      const pattern = s.substring(6).trim()
      return new RegExp(pattern, 'i').test(t)
    } catch (e) { return false }
  }
  return t.includes(s)
}

function normalizeVdcRules(rules) {
  const list = Array.isArray(rules) ? rules : []
  return list.slice(0, 100).map((rule, index) => normalizeVdcRule(rule, index))
}

function isValidDate(value) {
  if (!(value instanceof Date)) return false
  return !Number.isNaN(value.getTime()) && value.getFullYear() > 1970
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toDateOrNull(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return isValidDate(d) ? d : null
}

function formatDisplayTime(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (!isValidDate(d)) return ''
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function formatDurationMs(ms) {
  if (ms == null || typeof ms !== 'number' || Number.isNaN(ms) || !Number.isFinite(ms) || ms < 0) return ''
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  return `${pad2(minutes)}:${pad2(seconds)}`
}

function isExcludedJobName(name) {
  if (!name || typeof name !== 'string') {
    if (name == null) return true
    name = String(name)
  }
  const n = name.trim().toLowerCase()
  const blocked = [
    'host discovery', 'shell run', 'checkpoint removal',
    'infrastructure rescan', 'malware detection', 'security & compliance analyzer',
  ]
  return blocked.some((x) => n === x || n.includes(x))
}

function jobBasename(name) {
  if (!name) return ''
  const safeName = String(name)
  const parts = safeName.split('\\')
  return parts[0] ? parts[0].trim().toLowerCase() : ''
}

function normalizePlannerText(value) {
  if (!value || typeof value !== 'string') return ''
  try {
    return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
  } catch (e) { return '' }
}

function lookupCriticality(jobName, criticalityByJob) {
  const map = criticalityByJob || {}
  const name = String(jobName || '').trim().toLowerCase()
  const foundKey = Object.keys(map).find((k) => k.trim().toLowerCase() === name)
  return normalizeCriticality(foundKey ? map[foundKey] : 'low')
}

module.exports = {
  safeLower, normalizeCriticality, normalizeManualStatus, logGraphError,
  normalizeVdcRule, normalizeAs400Rule, includesCI, normalizeVdcRules,
  isValidDate, pad2, toDateOrNull, formatDisplayTime, formatDurationMs,
  isExcludedJobName, jobBasename, normalizePlannerText, lookupCriticality
}