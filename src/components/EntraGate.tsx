import { useMsal } from "@azure/msal-react"
import { loginRequest } from "../auth/msalConfig"

export default function EntraGate({ children }: { children: React.ReactNode }) {
  const { instance, accounts, inProgress } = useMsal()

  const isLoading = inProgress !== "none"
  const isLoggedIn = accounts.length > 0

  async function login() {
    await instance.loginRedirect(loginRequest)
  }

  async function logout() {
    await instance.logoutRedirect()
  }

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          color: "#e5e7eb",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Validando sesión corporativa...
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #020617 0%, #0f172a 55%, #1e293b 100%)",
          color: "#e5e7eb",
          fontFamily: "system-ui, sans-serif",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            background: "rgba(15,23,42,.92)",
            border: "1px solid rgba(96,165,250,.35)",
            borderRadius: 16,
            boxShadow: "0 20px 60px rgba(0,0,0,.35)",
            padding: 28,
          }}
        >
          <h1 style={{ margin: "0 0 8px 0", fontSize: 24 }}>
            Backup Monitor Pro
          </h1>

          <p style={{ margin: "0 0 20px 0", color: "#94a3b8", lineHeight: 1.5 }}>
            Accede con tu cuenta corporativa de Microsoft 365.
            Se aplicarán las políticas de seguridad corporativas, incluyendo MFA si corresponde.
          </p>

          <button
            type="button"
            onClick={login}
            style={{
              width: "100%",
              background: "#2563eb",
              color: "#ffffff",
              border: "1px solid #60a5fa",
              borderRadius: 10,
              padding: "11px 14px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Iniciar sesión con Microsoft
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        style={{
          position: "fixed",
          right: 14,
          bottom: 14,
          zIndex: 9998,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(15,23,42,.92)",
          border: "1px solid rgba(96,165,250,.35)",
          borderRadius: 999,
          padding: "6px 10px",
          color: "#cbd5e1",
          fontSize: 12,
        }}
      >
        <span>{accounts[0]?.username}</span>

        <button
          type="button"
          onClick={logout}
          style={{
            background: "rgba(239,68,68,.15)",
            border: "1px solid rgba(239,68,68,.35)",
            color: "#fecaca",
            borderRadius: 999,
            padding: "3px 8px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          Salir
        </button>
      </div>

      {children}
    </>
  )
}
