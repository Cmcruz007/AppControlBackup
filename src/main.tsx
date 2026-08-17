import React from "react"
import ReactDOM from "react-dom/client"
import { MsalProvider, useMsal } from "@azure/msal-react"
import { msalInstance } from "./auth/msalConfig"
import EntraGate from "./components/EntraGate"
import App from "./App"
import "./styles.css"
import "./mobile.css"

// Flag para activar/desactivar Entra ID.
// - "0" = Token clasico (BM_AUTH_TOKEN) -- modo actual por defecto.
// - "1" = Entra ID (Microsoft 365 SSO) -- activar solo cuando Redirect URI
//         este en modo SPA en Entra ID.
const USE_ENTRA = import.meta.env.VITE_BM_USE_ENTRA === "1"

// Puente entre MSAL y <App/>: vive DENTRO de <MsalProvider/>, asi que puede
// llamar a useMsal() sin problema, y le pasa a <App/> el email de la cuenta
// activa junto con la funcion de logout como props opcionales. De este modo
// App.tsx no necesita conocer nada de MSAL: en modo Token clasico
// (USE_ENTRA=0) simplemente se renderiza <App/> sin estas props y el badge
// de usuario no se pinta.
function AppWithMsal() {
  const { instance, accounts } = useMsal()

  return (
    <App
      entraUsername={accounts[0]?.username ?? null}
      onEntraLogout={() => instance.logoutRedirect()}
    />
  )
}

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
            <AppWithMsal />
          </EntraGate>
        </MsalProvider>
      ) : (
        <App />
      )}
    </React.StrictMode>
  )
}

bootstrap()