// src/utils/api.ts — Dual: Electron IPC ↔ Express fetch
import type { Api } from "../types/ui"

// Detectar si estamos en Electron (window.api existe via preload.cjs)
const isElectron = !!(window as any).api

// Token para modo Express (se puede inyectar via variable de entorno en build)
const AUTH_TOKEN = (import.meta as any).env?.VITE_BM_AUTH_TOKEN || ''

// ─── Helpers para modo Express ──────────────────────────────────────────────
function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (AUTH_TOKEN) h['Authorization'] = `Bearer ${AUTH_TOKEN}`
  return h
}

async function get(url: string) {
  const res = await fetch(url, { headers: headers() })
  return res.json()
}

async function post(url: string, body?: any) {
  const res = await fetch(url, { method: 'POST', headers: headers(), body: body !== undefined ? JSON.stringify(body) : undefined })
  return res.json()
}

// ─── API para modo Express (fetch) ─────────────────────────────────────────
const expressApi: Api = {
  getConfig: () => get('/api/config'),
  saveConfig: (cfg) => post('/api/config', cfg).then(r => r.ok ?? false),
  refresh: () => post('/api/refresh'),
  getHistoryDays: () => get('/api/history/days'),
  getHistoryDay: (dateStr) => get(`/api/history/day/${encodeURIComponent(dateStr)}`),
  getSchedule30: () => get('/api/schedule/30days'),
  sendEmail: (payload) => post('/api/email/send', payload),
  getJobExecutions: (jobName, limit = 200) => {
    const encodedName = encodeURIComponent(jobName || '')
    const url = jobName
      ? `/api/jobs/executions/${encodedName}?limit=${limit}`
      : `/api/jobs/executions?limit=${limit}`
    return get(url)
  },
  listJobs: () => get('/api/jobs/list'),
  // En modo Express no hay auto-update push; el frontend puede hacer polling
  onAutoUpdate: undefined,
}

// ─── API para modo Electron (IPC via preload) ──────────────────────────────
const electronApi: Api = (window as any).api

// ─── Exportar la API correcta según el entorno ─────────────────────────────
export const api = (): Api => isElectron ? electronApi : expressApi

// Para debug
console.log(`[API] Modo: ${isElectron ? 'Electron IPC' : 'Express fetch'}`)