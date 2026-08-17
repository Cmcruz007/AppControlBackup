import { InteractionRequiredAuthError } from "@azure/msal-browser"
import { msalInstance } from "./msalInstance"
import { entraClientId } from "./authConfig"

export { msalInstance } from "./msalInstance"

export const entraApiScope = `api://${entraClientId}/access_as_user`

export const loginRequest = {
  scopes: [entraApiScope],
}

// Evita disparar varios acquireTokenRedirect concurrentes: EntraGate llama
// a getEntraAccessToken() hasta 4 veces seguidas si no obtiene token. Sin
// este guard, si el primer redirect aun no ha navegado la pagina, una
// segunda llamada lanza BrowserAuthError: interaction_in_progress, que al
// no estar capturado rompia el bucle de EntraGate y dejaba "Validando
// sesion corporativa..." colgado para siempre (o, en otros casos, un
// estado de login inconsistente que acababa en KPIs a cero / 401).
let redirectInFlight = false

export async function getEntraAccessToken(): Promise<string | null> {
  const accounts = msalInstance.getAllAccounts()

  if (!accounts.length) return null

  const account = accounts[0]

  try {
    const result = await msalInstance.acquireTokenSilent({
      ...loginRequest,
      account,
    })

    return result.accessToken || null
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      if (!redirectInFlight) {
        redirectInFlight = true

        try {
          await msalInstance.acquireTokenRedirect(loginRequest)
        } catch (redirectErr) {
          console.error("[MSAL] acquireTokenRedirect error:", redirectErr)
          redirectInFlight = false
        }
      }

      return null
    }

    console.error("[MSAL] acquireTokenSilent error:", e)
    return null
  }
}
