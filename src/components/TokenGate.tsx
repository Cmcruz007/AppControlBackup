import { useEffect, useState } from "react"
import { setAuthToken, clearAuthToken } from "../utils/api"

type Props = {
  open: boolean
  onClose: () => void
}

export default function TokenGate({ open, onClose }: Props) {
  const [token, setToken] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setError(null)
      setToken("")
    }
  }, [open])

  if (!open) return null

  async function handleSave() {
    if (!token.trim()) {
      setError("Introduce un token válido.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      setAuthToken(token.trim())

      // Verificar contra /api/health antes de cerrar
      const res = await fetch("/api/health", {
        headers: { Authorization: `Bearer ${token.trim()}` },
      })

      if (res.status === 200) {
        onClose()
        // Forzar recarga para que toda la app vuelva a pedir datos con token nuevo
        window.location.reload()
      } else if (res.status === 401) {
        setError("Token incorrecto.")
        clearAuthToken()
      } else {
        setError(`Error al validar token (HTTP ${res.status}).`)
        clearAuthToken()
      }
    } catch (e: any) {
      setError(e?.message || "Error de red.")
      clearAuthToken()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,15,30,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "#0f172a",
          border: "1px solid #1e3a5f",
          borderRadius: 12,
          padding: 24,
          width: 420,
          maxWidth: "92vw",
          color: "#f1f5f9",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, color: "#60a5fa" }}>
          🔐 Acceso a BackupMonitor
        </h2>
        <p style={{ marginTop: 8, marginBottom: 16, fontSize: 13, color: "#94a3b8" }}>
          Introduce el token de acceso para usar el dashboard.
        </p>

        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token..."
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid #334155",
            background: "#0a0f1e",
            color: "#f1f5f9",
            fontSize: 14,
            outline: "none",
          }}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave()
          }}
        />

        {error && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 6,
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.4)",
              color: "#fecaca",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button
            disabled={saving}
            onClick={handleSave}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid #2563eb",
              background: "#1e40af",
              color: "#fff",
              fontSize: 13,
              cursor: saving ? "wait" : "pointer",
            }}
          >
            {saving ? "Validando..." : "Acceder"}
          </button>
        </div>
      </div>
    </div>
  )
}