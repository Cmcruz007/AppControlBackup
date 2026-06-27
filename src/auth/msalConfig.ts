import { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser"

export const entraTenantId = "fc87712b-371a-4c4f-bb5d-0c9adbd85068"
export const entraClientId = "9d8078b9-b0c6-4e95-a51f-1cf1b08c7d96"
export const entraAuthority = `https://login.microsoftonline.com/${entraTenantId}`

export const entraApiScope = `api://${entraClientId}/access_as_user`

export const msalInstance = new PublicClientApplication({
  auth: {
    clientId: entraClientId,
    authority: entraAuthority,
    redirectUri: "https://dashboard",
    postLogoutRedirectUri: "https://dashboard",
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
})

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