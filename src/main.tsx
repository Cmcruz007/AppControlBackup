import React from "react"
import ReactDOM from "react-dom/client"
import { MsalProvider } from "@azure/msal-react"
import { msalInstance } from "./auth/msalConfig"
import EntraGate from "./components/EntraGate"
import App from "./App"
import "./styles.css"

// Flag para activar/desactivar Entra ID.
// - "0" = Token clásico (BM_AUTH_TOKEN) — modo actual por defecto.
// - "1" = Entra ID (Microsoft 365 SSO) — activar solo cuando Redirect URI
//         esté en modo SPA en Entra ID.
const USE_ENTRA = ((import.meta as any).env?.VITE_BM_USE_ENTRA ?? "0") === "1"

async function bootstrap() {
  if (USE_ENTRA) {
    try {
      await msalInstance.initialize()
      console.log("[MSAL] initialize OK")
    } catch (err) {
      console.error("[MSAL] initialize error:", err)
    }

    try {
      const redirectResult = await msalInstance.handleRedirectPromise()
      if (redirectResult) {
        console.log("[MSAL] handleRedirectPromise account:", redirectResult.account?.username)
      } else {
        console.log("[MSAL] handleRedirectPromise: sin redirect pendiente")
      }
    } catch (err) {
      console.error("[MSAL] handleRedirectPromise error:", err)
    }
  }

  const root = ReactDOM.createRoot(document.getElementById("root")!)

  root.render(
    <React.StrictMode>
      {USE_ENTRA ? (
        <MsalProvider instance={msalInstance}>
          <EntraGate>
            <App />
          </EntraGate>
        </MsalProvider>
      ) : (
        <App />
      )}
    </React.StrictMode>
  )
}

bootstrap()