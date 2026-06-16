import { api } from "./utils/api"
import { useState, useMemo, useEffect, useCallback } from 'react'
import type { AppConfig, Criticality } from './types'

type Api = {
  getConfig: () => Promise<AppConfig | null>
  saveConfig: (cfg: AppConfig) => Promise<boolean>
}

const api = () => (window as any).api as Api

const LEVELS: { key: Criticality; label: string; bg: string; color: string; dot: string }[] = [
  { key: 'low',    label: 'BAJA',  bg: '#1e5c3a', color: '#86efac', dot: '#22c55e' },
  { key: 'medium', label: 'MEDIA', bg: '#5c3a10', color: '#fcd34d', dot: '#f59e0b' },
  { key: 'high',   label: 'ALTA',  bg: '#5c1e1e', color: '#fca5a5', dot: '#ef4444' },
]

function normalizeCriticalityByJob(raw: any): Record<string, Criticality> {
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, Criticality> = {}
  for (const [job, val] of Object.entries(raw)) {
    if (val === 'high' || val === 'medium' || val === 'low') {
      result[job] = val
    }
  }
  return result
}

export default function CriticalityPanel({
  config,
  onSaved,
  jobNames,
}: {
  config: AppConfig | null
  onSaved: (cfg: AppConfig) => void
  jobNames: string[]
}) {
  const [draft, setDraft] = useState<Record<string, Criticality>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const [filter, setFilter] = useState('')

  // Construye el draft a partir del config + jobNames conocidos
  const buildDraft = useCallback(
    (cfg: AppConfig | null, names: string[]): Record<string, Criticality> => {
      const persisted = normalizeCriticalityByJob(cfg?.criticalityByJob)
      const result: Record<string, Criticality> = {}
      // Jobs conocidos por el backend
      names.forEach((j) => {
        result[j] = persisted[j] ?? 'low'
      })
      // Jobs que estaban guardados pero ya no están en la lista actual
      // (los preservamos para no perder datos de jobs que no aparecen hoy)
      Object.keys(persisted).forEach((j) => {
        if (!(j in result)) result[j] = persisted[j]
      })
      return result
    },
    []
  )

  // Sincronizar cuando cambia config o la lista de jobs
  // Usamos jobNames.join como dependencia estable en lugar de JSON.stringify
  const jobNamesKey = jobNames.join('|')
  useEffect(() => {
    setDraft(buildDraft(config, jobNames))
    setDirty(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, jobNamesKey, buildDraft])

  // Ocultar mensaje de éxito tras 2 s
  useEffect(() => {
    if (!savedMsg) return
    const id = window.setTimeout(() => setSavedMsg(false), 2000)
    return () => window.clearTimeout(id)
  }, [savedMsg])

  const sortedJobs = useMemo(() => {
    const all = Array.from(
      new Set([...jobNames, ...Object.keys(draft)])
    )
    return all.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  }, [jobNames, draft])

  const filtered = useMemo(() => {
    if (!filter.trim()) return sortedJobs
    const q = filter.toLowerCase()
    return sortedJobs.filter((j) => j.toLowerCase().includes(q))
  }, [sortedJobs, filter])

  const stats = useMemo(() => {
    const vals = Object.values(draft)
    return {
      high:   vals.filter((v) => v === 'high').length,
      medium: vals.filter((v) => v === 'medium').length,
      low:    vals.filter((v) => v === 'low').length,
    }
  }, [draft])

  function setLevel(job: string, level: Criticality) {
    setDraft((prev) => ({ ...prev, [job]: level }))
    setDirty(true)
  }

  // PASO 1 + 2: saveAll es async y llama a api().saveConfig() antes de onSaved
  async function saveAll() {
    setSaving(true)
    try {
      // Leemos la config más reciente del disco para no pisar otros ajustes
      const currentCfg = (await api().getConfig()) ?? config ?? {} as AppConfig

      const updatedConfig: AppConfig = {
        ...(currentCfg as AppConfig),
        // Enviamos el draft COMPLETO — main.cjs lo reemplaza, no lo fusiona
        criticalityByJob: { ...draft },
      }

      const ok = await api().saveConfig(updatedConfig)

      if (!ok) {
        alert('No se pudo guardar las criticidades.')
        return
      }

      // Re-leemos desde disco para obtener la versión canónica
      const fresh = (await api().getConfig()) ?? updatedConfig

      // Sincronizamos el draft local con lo que quedó en disco
      setDraft(normalizeCriticalityByJob(fresh.criticalityByJob))
      setDirty(false)
      setSavedMsg(true)

      // Notificamos al padre con la config fresca → App hace refresh()
      // lo que actualiza los dots del dashboard y del histórico
      onSaved(fresh)
    } catch (e: any) {
      alert(`Error guardando criticidades: ${e?.message ?? String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ color: 'var(--text)', maxWidth: 860, margin: '0 auto' }}>
      {/* Cabecera */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Gestión de Criticidades</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            El cuadradillo de color junto al nombre del job refleja esta prioridad en el dashboard y en el histórico.
          </div>
        </div>
        <button
          onClick={saveAll}
          disabled={saving || !dirty}
          style={{
            padding: '8px 18px',
            borderRadius: 6,
            border: 'none',
            background: dirty ? 'var(--primary, #2563eb)' : '#334155',
            color: '#fff',
            fontWeight: 600,
            cursor: saving || !dirty ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
            fontSize: 13,
          }}
        >
          {saving ? 'Guardando...' : '💾 Guardar cambios'}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {LEVELS.map((lvl) => (
          <div
            key={lvl.key}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: lvl.dot,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            {lvl.label}: <strong>{stats[lvl.key]}</strong>
          </div>
        ))}

        {dirty && (
          <div
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              background: 'rgba(245,158,11,.12)',
              border: '1px solid rgba(245,158,11,.28)',
              color: '#fbbf24',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Cambios sin guardar
          </div>
        )}
      </div>

      {/* Mensaje de éxito */}
      {savedMsg && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'rgba(34,197,94,.15)',
            color: '#86efac',
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          ✓ Criticidades guardadas correctamente
        </div>
      )}

      {/* Buscador */}
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filtrar jobs..."
        style={{
          width: '100%',
          boxSizing: 'border-box',
          marginBottom: 10,
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--panel-2)',
          color: 'var(--text)',
          fontSize: 13,
        }}
      />

      {/* Grid de jobs */}
      <div
        style={{
          maxHeight: '60vh',
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 8,
	  maxWidth: 860,
          margin: '0 auto',
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: '28px 16px',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 13,
            }}
          >
            {sortedJobs.length === 0
              ? 'No hay jobs disponibles. Realiza un refresco primero.'
              : 'Ningún job coincide con el filtro.'}
          </div>
        ) : (
          filtered.map((job) => {
            const current = draft[job] ?? 'low'
            const dot = LEVELS.find((l) => l.key === current)?.dot ?? '#22c55e'
            return (
              <div
                key={job}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '16px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '8px 16px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {/* Dot de criticidad actual */}
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: dot,
                    display: 'inline-block',
                    flexShrink: 0,
                    boxShadow: '0 0 0 1px rgba(255,255,255,.08) inset',
                  }}
                />

                {/* Nombre del job */}
                <div
                  title={job}
                  style={{
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {job}
                </div>

                {/* Botones de nivel */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {LEVELS.map((lvl) => {
                    const active = current === lvl.key
                    return (
                      <button
                        key={lvl.key}
                        type="button"
                        onClick={() => setLevel(job, lvl.key)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 6,
                          border: active
                            ? `2px solid ${lvl.color}`
                            : '1px solid var(--border)',
                          background: active ? lvl.bg : 'var(--panel-2)',
                          color: active ? lvl.color : 'var(--muted)',
                          fontSize: 11,
                          fontWeight: active ? 700 : 500,
                          cursor: 'pointer',
                          transition: 'all .12s ease',
                        }}
                      >
                        {lvl.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Hint */}
      <div
        style={{
          marginTop: 12,
          fontSize: 12,
          color: 'var(--muted)',
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '12px 14px',
          lineHeight: 1.5,
        }}
      >
        <strong>Consejo:</strong> Rojo = Alta · Naranja = Media · Verde = Baja.
        Los cambios se aplican en el dashboard e histórico al pulsar <em>Guardar cambios</em>.
      </div>
    </div>
  )
}
