import { useEffect, useMemo, useState } from 'react'
import type { AppConfig, VeeamDataCloudRule } from './types'

function makeId() {
  return `barra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeRule(rule: any, index: number): VeeamDataCloudRule {
  return {
    id: String(rule?.id || `barra-rule-${index + 1}` || makeId()),
    title: String(rule?.title || '').trim(),
    sender: String(rule?.sender || '').trim(),
    subjectContains: String(rule?.subjectContains || '').trim(),
    successWord: String(rule?.successWord || rule?.successKeywords || '').trim(),
    errorWord: String(rule?.errorWord || rule?.errorKeywords || '').trim(),
    enabled: rule?.enabled !== false,
  }
}

function normalizeRules(rules: any[]): VeeamDataCloudRule[] {
  return (Array.isArray(rules) ? rules : []).map((rule, index) => normalizeRule(rule, index))
}

export default function BarracudaPanel({
  config,
  onSaved,
}: {
  config: AppConfig | null
  onSaved: (cfg: AppConfig) => void
}) {
  const initialRules = useMemo(
    () => normalizeRules((config as any)?.barracudaRules ?? []),
    [config],
  )

  const [rules, setRules] = useState<VeeamDataCloudRule[]>(initialRules)

  useEffect(() => {
    setRules(normalizeRules((config as any)?.barracudaRules ?? []))
  }, [config])

  function addRule() {
    setRules((prev) => [
      ...prev,
      {
        id: makeId(),
        title: '',
        sender: '',
        subjectContains: '',
        successWord: '',
        errorWord: '',
        enabled: true,
      },
    ])
  }

  function updateRule(id: string, updates: Partial<VeeamDataCloudRule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)))
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  async function saveAll() {
    if (!config) return
    const nextCfg = { ...config, barracudaRules: rules }
    const ok = await (window as any).api.saveConfig(nextCfg)
    if (ok) {
      onSaved(nextCfg)
      alert('Barracuda guardado correctamente.')
    } else {
      alert('Error al guardar la configuración.')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: 'var(--text)' }}>Reglas de Barracuda</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={addRule}
            style={{
              background: '#2563eb',
              color: 'white',
              padding: '6px 12px',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            + Añadir Regla
          </button>
          <button
            onClick={saveAll}
            style={{
              background: '#059669',
              color: 'white',
              padding: '6px 12px',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Guardar
          </button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
          No hay reglas configuradas para Barracuda.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              style={{
                background: 'var(--panel-2)',
                border: '1px solid var(--border)',
                padding: 16,
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>
                    Título
                  </label>
                  <input
                    type='text'
                    value={rule.title}
                    onChange={(e) => updateRule(rule.id, { title: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>
                    Remitente (Sender)
                  </label>
                  <input
                    type='text'
                    value={rule.sender}
                    onChange={(e) => updateRule(rule.id, { sender: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>
                    El asunto contiene
                  </label>
                  <input
                    type='text'
                    value={rule.subjectContains}
                    onChange={(e) => updateRule(rule.id, { subjectContains: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>
                    Palabra de Éxito
                  </label>
                  <input
                    type='text'
                    value={rule.successWord}
                    onChange={(e) => updateRule(rule.id, { successWord: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>
                    Palabra de Error
                  </label>
                  <input
                    type='text'
                    value={rule.errorWord}
                    onChange={(e) => updateRule(rule.id, { errorWord: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type='checkbox'
                    checked={rule.enabled}
                    onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                  />
                  Regla activa
                </label>

                <button
                  onClick={() => removeRule(rule.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'rgba(239,68,68,.15)',
                    color: '#fca5a5',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}