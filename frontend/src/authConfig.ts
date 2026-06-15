import { UserScope, type LogtoConfig } from "@logto/react";
import { APP_ENV } from "./env";

export const GLOBAL_OWNER_SCOPES = [
  "owner:read",
  "owner:manage",
  "organizations:read",
  "organizations:create",
  "organizations:manage",
] as const;

// Keep the SPA bootstrap focused on the Civitas product API resource. Logto applies
// configured custom scopes to every configured resource, so mixing the reserved
// organization resource here would request owner/global API scopes against
// organization tokens and can make Logto refuse the token exchange.
const resources = APP_ENV.api.resourceIndicator ? [APP_ENV.api.resourceIndicator] : [];

export const logtoConfig: LogtoConfig = {
  endpoint: APP_ENV.logto.endpoint,
  appId: APP_ENV.logto.appId,
  resources,
  scopes: [
    UserScope.Email,
    UserScope.Profile,
    ...GLOBAL_OWNER_SCOPES,
  ],
};

export const isLogtoConfigurationComplete = Boolean(APP_ENV.logto.endpoint && APP_ENV.logto.appId);
export const isLogtoAuthEnabled = APP_ENV.auth.logtoEnabled && isLogtoConfigurationComplete;
