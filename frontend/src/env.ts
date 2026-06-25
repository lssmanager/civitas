const PRODUCTION_API_BASE_URL = "https://civitas.socialstudies.cloud/api";
const PRODUCTION_LOGTO_ENDPOINT = "https://auth.learnsocialstudies.com/";
const PRODUCTION_LOGTO_APP_ID = "avc4zf5kjm5rgc5xgsegh";
const PRODUCTION_APP_REDIRECT_URI = "https://civitas.socialstudies.cloud/callback";
const PRODUCTION_APP_SIGN_OUT_REDIRECT_URI = "https://civitas.socialstudies.cloud";

const LOCAL_API_BASE_URL = "http://localhost:3000";
const LOCAL_APP_REDIRECT_URI = "http://localhost:5173/callback";
const LOCAL_APP_SIGN_OUT_REDIRECT_URI = "http://localhost:5173/";

const getViteEnv = (value: string | undefined, fallback: string) => value?.trim() || fallback;
const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, "");
const getUrlEnv = (value: string | undefined, fallback: string) => trimTrailingSlashes(getViteEnv(value, fallback));

const getApiBaseUrlFallback = () => (import.meta.env.PROD ? PRODUCTION_API_BASE_URL : LOCAL_API_BASE_URL);
const getResourceIndicatorFallback = () => (import.meta.env.PROD ? PRODUCTION_API_BASE_URL : "");
const getLogtoEndpointFallback = () => (import.meta.env.PROD ? PRODUCTION_LOGTO_ENDPOINT : "");
const getLogtoAppIdFallback = () => (import.meta.env.PROD ? PRODUCTION_LOGTO_APP_ID : "");
const getRedirectUriFallback = () => (import.meta.env.PROD ? PRODUCTION_APP_REDIRECT_URI : LOCAL_APP_REDIRECT_URI);
const getSignOutRedirectUriFallback = () =>
  import.meta.env.PROD ? PRODUCTION_APP_SIGN_OUT_REDIRECT_URI : LOCAL_APP_SIGN_OUT_REDIRECT_URI;

const getPositiveIntegerEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getBooleanEnv = (value: string | undefined, fallback = false) => {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  return value.toLowerCase() === "true";
};

export const APP_ENV = {
  auth: {
    logtoEnabled: getBooleanEnv(import.meta.env.VITE_ENABLE_LOGTO, import.meta.env.PROD),
  },
  logto: {
    endpoint: getViteEnv(import.meta.env.VITE_LOGTO_ENDPOINT, getLogtoEndpointFallback()),
    appId: getViteEnv(import.meta.env.VITE_LOGTO_APP_ID, getLogtoAppIdFallback()),
  },
  api: {
    baseUrl: getUrlEnv(import.meta.env.VITE_API_BASE_URL, getApiBaseUrlFallback()),
    resourceIndicator: getUrlEnv(import.meta.env.VITE_API_RESOURCE_INDICATOR, getResourceIndicatorFallback()),
    requestTimeoutMs: getPositiveIntegerEnv(import.meta.env.VITE_API_REQUEST_TIMEOUT_MS, 45000),
  },
  app: {
    redirectUri: getViteEnv(import.meta.env.VITE_APP_REDIRECT_URI, getRedirectUriFallback()),
    signOutRedirectUri: getViteEnv(import.meta.env.VITE_APP_SIGN_OUT_REDIRECT_URI, getSignOutRedirectUriFallback()),
  },
} as const;
