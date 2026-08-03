import { api } from "./utils/api"
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { AppConfig } from './types'

// ─── Tipos locales (S-5: Envío de correo configurable) ─────────────────────
// days: 0=Domingo ... 6=Sábado, igual que Date.getDay(), para que coincida
// exactamente con la lógica ya usada en el backend (isWeekendOperationalWindow).
interface DailyReportConfig {
  recipients: string[]
  cc: string[]
  bcc: string[]
  days: number[]
  times: string[]
}

const DAYS_UI: { value: number; label: string; title: string }[] = [
  { value: 1, label: 'L', title: 'Lunes' },
  { value: 2, label: 'M', title: 'Martes' },
  { value: 3, label: 'X', title: 'Miércoles' },
  { value: 4, label: 'J', title: 'Jueves' },
  { value: 5, label: 'V', title: 'Viernes' },
  { value: 6, label: 'S', title: 'Sábado' },
  { value: 0, label: 'D', title: 'Domingo' },
]

const DEFAULT_DAILY_REPORT: DailyReportConfig = {
  recipients: [],
  cc: [],
  bcc: [],
  days: [0, 1, 2, 3, 4, 5, 6],
  times: ['17:00'],
}

function normalizeEmailList(value: any): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[;,]/).map((x) => x.trim()).filter(Boolean)
  return []
}

function normalizeDays(value: any): number[] {
  if (!Array.isArray(value) || !value.length) return [...DEFAULT_DAILY_REPORT.days]
  const clean = value.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  return clean.length ? Array.from(new Set(clean)).sort((a, b) => a - b) : [...DEFAULT_DAILY_REPORT.days]
}

function normalizeTimes(value: any): string[] {
  if (!Array.isArray(value) || !value.length) return [...DEFAULT_DAILY_REPORT.times]
  const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/
  const clean = value.map((t) => String(t || '').trim()).filter((t) => timeRe.test(t))
  return clean.length ? Array.from(new Set(clean)).sort() : [...DEFAULT_DAILY_REPORT.times]
}

function normalizeDailyReport(raw: any): DailyReportConfig {
  return {
    recipients: normalizeEmailList(raw?.recipients),
    cc: normalizeEmailList(raw?.cc),
    bcc: normalizeEmailList(raw?.bcc),
    days: normalizeDays(raw?.days),
    times: normalizeTimes(raw?.times),
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function inputStyle(): CSSProperties {
  return {
    flex: 1,
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--panel)',
    color: 'var(--text)',
    fontSize: 13,
    boxSizing: 'border-box',
  }
}

function EmailListEditor({
  title,
  hint,
  list,
  onChange,
}: {
  title: string
  hint?: string
  list: string[]
  onChange: (next: string[]) => void
}) {
  const [draftValue, setDraftValue] = useState('')

  function addEmail() {
    const value = draftValue.trim()
    if (!value) return
    if (!EMAIL_RE.test(value)) {
      alert(`"${value}" no parece un correo válido.`)
      return
    }
    if (list.some((x) => x.toLowerCase() === value.toLowerCase())) {
      setDraftValue('')
      return
    }
    onChange([...list, value])
    setDraftValue('')
  }

  function removeEmail(email: string) {
    onChange(list.filter((x) => x !== email))
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {hint && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{hint}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addEmail()
            }
          }}
          placeholder="correo@uci.com"
          style={inputStyle()}
        />
        <button
          type="button"
          onClick={addEmail}
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--primary, #2563eb)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Añadir
        </button>
      </div>

      {list.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
          Sin destinatarios configurados.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {list.map((email) => (
            <span
              key={email}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                borderRadius: 999,
                background: 'var(--panel-2)',
                border: '1px solid var(--border)',
                fontSize: 12,
              }}
            >
              {email}
              <button
                type="button"
                onClick={() => removeEmail(email)}
                title="Eliminar"
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#fca5a5',
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function EmailReportPanel({
  config,
  onSaved,
}: {
  config: AppConfig | null
  onSaved: (cfg: AppConfig) => void
}) {
  const initialDraft = useMemo(
    () => normalizeDailyReport((config as any)?.dailyReport ?? DEFAULT_DAILY_REPORT),
    [config],
  )

  const [draft, setDraft] = useState<DailyReportConfig>(initialDraft)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const [newTime, setNewTime] = useState('17:00')

  useEffect(() => {
    setDraft(normalizeDailyReport((config as any)?.dailyReport ?? DEFAULT_DAILY_REPORT))
    setDirty(false)
  }, [config])

  useEffect(() => {
    if (!savedMsg) return
    const id = window.setTimeout(() => setSavedMsg(false), 2500)
    return () => window.clearTimeout(id)
  }, [savedMsg])

  function update<K extends keyof DailyReportConfig>(key: K, value: DailyReportConfig[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  function toggleDay(day: number) {
    const next = draft.days.includes(day)
      ? draft.days.filter((d) => d !== day)
      : [...draft.days, day].sort((a, b) => a - b)
    update('days', next)
  }

  function addTime() {
    const value = newTime.trim()
    const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/
    if (!timeRe.test(value)) {
      alert('Introduce una hora válida (HH:MM).')
      return
    }
    if (draft.times.includes(value)) return
    update('times', [...draft.times, value].sort())
  }

  function removeTime(time: string) {
    update('times', draft.times.filter((t) => t !== time))
  }

  async function saveAll() {
    setSaving(true)
    try {
      const currentCfg = (await api().getConfig()) ?? config ?? ({} as AppConfig)
      const updatedConfig: AppConfig = {
        ...(currentCfg as AppConfig),
        ...({ dailyReport: { ...draft } } as any),
      }

      const ok = await api().saveConfig(updatedConfig)
      if (!ok) {
        alert('No se pudo guardar la configuración de envío de correo.')
        return
      }

      const fresh = (await api().getConfig()) ?? updatedConfig
      setDraft(normalizeDailyReport((fresh as any)?.dailyReport))
      setDirty(false)
      setSavedMsg(true)
      onSaved(fresh)
    } catch (e: any) {
      alert(`Error guardando la configuración: ${e?.message ?? String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  async function sendTestReport() {
    setSendingTest(true)
    try {
      const token = window.localStorage.getItem('bm.authToken') || ''
      const res = await fetch('/api/email/daily-report/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      const data = await res.json().catch(() => null)
      alert(data?.message || (data?.ok ? 'Informe enviado correctamente.' : 'No se pudo enviar el informe. Revisa los logs del servidor.'))
    } catch (e: any) {
      alert(`Error al enviar la prueba: ${e?.message ?? String(e)}`)
    } finally {
      setSendingTest(false)
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
          <div style={{ fontSize: 18, fontWeight: 700 }}>Envío de correo</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Configura destinatarios, días y horario del informe automático de backups.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={sendTestReport}
            disabled={sendingTest}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--panel-2)',
              color: 'var(--text)',
              fontWeight: 600,
              cursor: sendingTest ? 'not-allowed' : 'pointer',
              opacity: sendingTest ? 0.7 : 1,
              fontSize: 13,
            }}
          >
            {sendingTest ? 'Enviando...' : '✉ Enviar prueba'}
          </button>

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
      </div>

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
            marginBottom: 14,
          }}
        >
          Cambios sin guardar
        </div>
      )}

      {savedMsg && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'rgba(34,197,94,.15)',
            color: '#86efac',
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          ✓ Configuración de envío guardada correctamente
        </div>
      )}

      {/* Destinatarios */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          background: 'var(--panel-2)',
        }}
      >
        <EmailListEditor
          title="Para"
          hint="Destinatarios principales del informe diario."
          list={draft.recipients}
          onChange={(next) => update('recipients', next)}
        />

        <EmailListEditor
          title="CC"
          hint="Se enviará copia visible a estos destinatarios."
          list={draft.cc}
          onChange={(next) => update('cc', next)}
        />

        <EmailListEditor
          title="CCO"
          hint="Copia oculta (no visible para el resto de destinatarios)."
          list={draft.bcc}
          onChange={(next) => update('bcc', next)}
        />
      </div>

      {/* Días de envío */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          background: 'var(--panel-2)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Días de envío</div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {DAYS_UI.map((d) => {
            const active = draft.days.includes(d.value)
            return (
              <button
                key={d.value}
                type="button"
                title={d.title}
                onClick={() => toggleDay(d.value)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  border: active ? '2px solid #60a5fa' : '1px solid var(--border)',
                  background: active ? 'rgba(96,165,250,.18)' : 'var(--panel)',
                  color: active ? '#93c5fd' : 'var(--muted)',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Horarios de envío */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          background: 'var(--panel-2)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Horarios de envío</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          Puedes configurar una o varias horas al día (por ejemplo 09:00 y 17:00).
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            style={{ ...inputStyle(), flex: 'none', width: 140 }}
          />
          <button
            type="button"
            onClick={addTime}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--primary, #2563eb)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Añadir hora
          </button>
        </div>

        {draft.times.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
            Sin horarios configurados (no se enviará ningún informe).
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {draft.times.map((time) => (
              <span
                key={time}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 999,
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  fontSize: 12,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {time}
                <button
                  type="button"
                  onClick={() => removeTime(time)}
                  title="Eliminar"
                  style={{
                    border: 'none',
                    background: 'none',
                    color: '#fca5a5',
                    cursor: 'pointer',
                    fontSize: 13,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Hint */}
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
        <strong>Consejo:</strong> si no marcas ningún día, se enviará todos los días de la semana.
        Si no añades ninguna hora, no se enviará ningún informe automático hasta que configures al menos una.
        Usa <em>Enviar prueba</em> para comprobar el resultado sin esperar al horario programado.
      </div>
    </div>
  )
}
