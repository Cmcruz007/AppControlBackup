import { api } from "./utils/api"
import { useEffect, useMemo, useState } from 'react'
import type { AppConfig, As400Rule } from './types'

type Api = {
  saveConfig: (cfg: AppConfig) => Promise<boolean>
}


function createEmptyRule(): As400Rule {
  return {
    id: `as400_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    sender: '',
    subjectContains: '',
    errorWord: '',
    successWord: '',
    enabled: true,
    notes: '',
  }
}

function normalizeRules(value: any): As400Rule[] {
  if (!Array.isArray(value)) return []

  return value.map((item: any, index: number) => ({
    id: String(item?.id ?? `as400_${index}_${Math.random().toString(36).slice(2, 8)}`),
    title: String(item?.title ?? item?.name ?? ''),
    sender: String(item?.sender ?? ''),
    subjectContains: String(item?.subjectContains ?? item?.pattern ?? ''),
    errorWord: String(item?.errorWord ?? ''),
    successWord: String(item?.successWord ?? ''),
    enabled: item?.enabled !== false,
    notes: String(item?.notes ?? ''),
  }))
}

export default function As400Panel({
  config,
  onSaved,
}: {
  config: AppConfig | null
  onSaved: (cfg: AppConfig) => void
}) {
  const [rules, setRules] = useState<As400Rule[]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setRules(normalizeRules(config?.as400Rules))
    setDirty(false)
  }, [config])

  const stats = useMemo(() => {
    const total = rules.length
    const enabled = rules.filter((r) => r.enabled).length
    const valid = rules.filter((r) => r.title?.trim() || r.sender.trim() || r.subjectContains.trim()).length
    return { total, enabled, valid }
  }, [rules])

  function updateRule(id: string, patch: Partial<As400Rule>) {
    setRules((prev) => prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
    setDirty(true)
  }

  function addRule() {
    setRules((prev) => [...prev, createEmptyRule()])
    setDirty(true)
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((rule) => rule.id !== id))
    setDirty(true)
  }

  async function save() {
    const cleaned: As400Rule[] = rules.map((rule) => ({
      id: rule.id,
      title: (rule.title || '').trim(),
      sender: rule.sender.trim(),
      subjectContains: rule.subjectContains.trim(),
      errorWord: rule.errorWord.trim(),
      successWord: rule.successWord.trim(),
      enabled: !!rule.enabled,
      ...(rule.notes?.trim() ? { notes: rule.notes.trim() } : {}),
    }))

    const nextCfg: AppConfig = {
      ...(config ?? {}),
      as400Rules: cleaned,
    }

    setSaving(true)

    try {
      const ok = await api().saveConfig(nextCfg)

      if (!ok) {
        alert('No se pudo guardar la configuración AS400.')
        return
      }

      onSaved(nextCfg)
      setDirty(false)
    } catch (e: any) {
      alert(`Error guardando AS400: ${e?.message ?? String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>AS400</h3>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--muted)' }}>
            Configura reglas AS400 con la misma lógica que Veeam Data Cloud.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="secondary" onClick={addRule}>
            + Añadir regla
          </button>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              background: '#2563eb',
              color: 'white',
              borderRadius: 6,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: 13,
          }}
        >
          Total: <strong>{stats.total}</strong>
        </div>

        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: 13,
          }}
        >
          Activas: <strong>{stats.enabled}</strong>
        </div>

        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: 13,
          }}
        >
          Válidas: <strong>{stats.valid}</strong>
        </div>

        {dirty && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.28)',
              color: '#fbbf24',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Cambios sin guardar
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rules.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '28px 16px',
              color: 'var(--muted)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              background: 'var(--panel)',
            }}
          >
            No hay reglas AS400 configuradas.
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                background: 'var(--panel)',
                padding: 14,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}
              >
                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 12 }}>
                    Título
                  </label>
                  <input
                    value={rule.title || ''}
                    onChange={(e) => updateRule(rule.id, { title: e.target.value })}
                    placeholder="Ej. AS400 diario"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 12 }}>
                    Remitente (Sender)
                  </label>
                  <input
                    value={rule.sender}
                    onChange={(e) => updateRule(rule.id, { sender: e.target.value })}
                    placeholder="as400@empresa.com"
                    style={inputStyle}
                  />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 12 }}>
                    El asunto contiene
                  </label>
                  <input
                    value={rule.subjectContains}
                    onChange={(e) => updateRule(rule.id, { subjectContains: e.target.value })}
                    placeholder="Texto esperado en el asunto"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 12 }}>
                    Palabra de Éxito
                  </label>
                  <input
                    value={rule.successWord}
                    onChange={(e) => updateRule(rule.id, { successWord: e.target.value })}
                    placeholder="success / completed / ok"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 12 }}>
                    Palabra de Error
                  </label>
                  <input
                    value={rule.errorWord}
                    onChange={(e) => updateRule(rule.id, { errorWord: e.target.value })}
                    placeholder="error / failed / abend"
                    style={inputStyle}
                  />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 12 }}>
                    Notas
                  </label>
                  <input
                    value={rule.notes ?? ''}
                    onChange={(e) => updateRule(rule.id, { notes: e.target.value })}
                    placeholder="Comentario opcional"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                  />
                  Regla activa
                </label>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => removeRule(rule.id)}
                  style={{
                    background: 'rgba(239,68,68,.12)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239,68,68,.25)',
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          fontSize: 12,
          color: 'var(--muted)',
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '12px 14px',
          lineHeight: 1.5,
        }}
      >
        <strong>Consejo:</strong> usa la misma lógica que VDC/Barracuda: si llega correo y coincide con
        remitente/asunto, puedes cerrarlo por éxito o error según palabras clave.
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '8px 10px',
  borderRadius: 6,
}