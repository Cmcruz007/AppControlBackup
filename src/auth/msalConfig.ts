import { InteractionRequiredAuthError } from "@azure/msal-browser"
import { msalInstance } from "./msalInstance"
import { entraClientId } from "./authConfig"

export { msalInstance } from "./msalInstance"

export const entraApiScope = `api://${entraClientId}/access_as_user`

export const loginRequest = {
  scopes: [entraApiScope],
}

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
      await msalInstance.acquireTokenRedirect(loginRequest)
      return null
    }

    return null
  }
}
