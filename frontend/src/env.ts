const getBooleanEnv = (value: string | undefined, fallback = false) => {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === "true";
};

export const APP_ENV = {
  auth: {
    logtoEnabled: getBooleanEnv(import.meta.env.VITE_ENABLE_LOGTO),
  },
  logto: {
    endpoint: import.meta.env.VITE_LOGTO_ENDPOINT ?? "",
    appId: import.meta.env.VITE_LOGTO_APP_ID ?? "",
  },
  api: {
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000",
    resourceIndicator: import.meta.env.VITE_API_RESOURCE_INDICATOR ?? "",
  },
  app: {
    redirectUri: import.meta.env.VITE_APP_REDIRECT_URI ?? "http://localhost:5173/callback",
    signOutRedirectUri: import.meta.env.VITE_APP_SIGN_OUT_REDIRECT_URI ?? "http://localhost:5173/",
  },
} as const;
