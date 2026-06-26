import type { Configuration } from "@azure/msal-browser"

export const entraTenantId = "fc87712b-371a-4c4f-bb5d-0c9adbd85068"
export const entraClientId = "9d8078b9-b0c6-4e95-a51f-1cf1b08c7d96"

export const msalConfig: Configuration = {
  auth: {
    clientId: entraClientId,
    authority: `https://login.microsoftonline.com/${entraTenantId}`,
    redirectUri: "https://dashboard",
    postLogoutRedirectUri: "https://dashboard",
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
}

export const loginRequest = {
  scopes: ["openid", "profile", "email"],
}