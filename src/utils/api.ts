// src/utils/api.ts — Dual: Electron IPC ↔ Express fetch
import type { Api } from "../types/ui"
import { getEntraAccessToken } from "../auth/msalConfig"

// Detectar si estamos en Electron (window.api existe via preload.cjs)
const isElectron = !!(window as any).api

// ─── Gestión de token de autenticación ────────────────────────────────────
// Prioridad:
// 1. Token de Entra (idToken/accessToken obtenido por MSAL) si USE_ENTRA=1.
// 2. localStorage 'bm.authToken' (TokenGate / legacy / fallback).
// 3. Variable de build VITE_BM_AUTH_TOKEN (legacy).
const LS_KEY = 'bm.authToken'

// Flag para activar/desactivar Entra ID.
// - "0" (default) = Token clásico.
// - "1" = Entra ID (usa MSAL access token).
const USE_ENTRA = ((import.meta as any).env?.VITE_BM_USE_ENTRA ?? "0") === "1"

function getLocalToken(): string {
  try {
    const fromLs = window.localStorage.getItem(LS_KEY)
    if (fromLs && fromLs.trim()) return fromLs.trim()
  } catch {
    // ignorar acceso a localStorage en SSR / privacidad
  }

  const fromEnv = (import.meta as any).env?.VITE_BM_AUTH_TOKEN || ''
  return fromEnv ? String(fromEnv).trim() : ''
}

export function setAuthToken(token: string) {
  try {
    if (token && token.trim()) {
      window.localStorage.setItem(LS_KEY, token.trim())
    } else {
      window.localStorage.removeItem(LS_KEY)
    }
  } catch {
    // ignorar
  }
}

export function clearAuthToken() {
  setAuthToken('')
}

// Evento global para que la UI muestre el TokenGate/EntraGate ante 401
function notifyUnauthorized() {
  try {
    window.dispatchEvent(new CustomEvent('bm:unauthorized'))
  } catch {
    // ignorar en entornos sin window
  }
}

// ─── Helpers para modo Express ────────────────────────────────────────────
async function getBearerToken(): Promise<string> {
  // 1) Si USE_ENTRA está activo, intentar token MSAL.
  if (USE_ENTRA) {
    try {
      const entraToken = await getEntraAccessToken()
      if (entraToken && entraToken.trim()) return entraToken.trim()
    } catch {
      // continuar al fallback (por ejemplo, si MSAL aún no inicializado)
    }

    // 2) Si Entra está activo pero no hay token todavía, NO caemos al token
    //    clásico automáticamente. Evita usar un bm.authToken viejo cuando
    //    lo que se espera es login con Entra.
    return ""
  }

  // 3) Modo legacy: token clásico (localStorage o env).
  return getLocalToken()
}

async function headers(): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = await getBearerToken()
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

async function handleResponse(res: Response) {
  if (res.status === 401) {
    notifyUnauthorized()
    return { ok: false, error: 'No autorizado' }
  }

  try {
    return await res.json()
  } catch {
    return { ok: false, error: `HTTP ${res.status}` }
  }
}

async function get(url: string) {
  const res = await fetch(url, { headers: await headers() })
  return handleResponse(res)
}

async function post(url: string, body?: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: await headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return handleResponse(res)
}

// ─── API para modo Express (fetch) ────────────────────────────────────────
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
  testSql: (sqlCfg) => post('/api/test/sql', sqlCfg),
  testGraph: (graphCfg) => post('/api/test/graph', graphCfg),
  listDatabases: (sqlCfg) => post('/api/sql/databases', sqlCfg),
  listTables: (sqlCfg) => post('/api/sql/tables', sqlCfg),
  listColumns: (sqlCfg, tableName) => post('/api/sql/columns', { sqlCfg, tableName }),
  onAutoUpdate: undefined,
}

// ─── API para modo Electron (IPC via preload) ─────────────────────────────
const electronApi: Api = (window as any).api

// ─── Exportar la API correcta según el entorno ────────────────────────────
export const api = (): Api => isElectron ? electronApi : expressApi

console.log(`[API] Modo: ${isElectron ? 'Electron IPC' : 'Express fetch'}`)