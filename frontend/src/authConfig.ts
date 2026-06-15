import { UserScope, type LogtoConfig } from "@logto/react";
import { APP_ENV } from "./env";

export const GLOBAL_OWNER_SCOPES = [
  "owner:read",
  "owner:manage",
  "organizations:read",
  "organizations:create",
  "organizations:manage",
] as const;

// Global bootstrap must only target the Civitas API resource. Tenant-scoped
// organization roles such as Admin-org are resolved in organization bootstrap,
// not in the owner access token request.
const globalApiResources = APP_ENV.api.resourceIndicator ? [APP_ENV.api.resourceIndicator] : undefined;

export const logtoConfig: LogtoConfig = {
  endpoint: APP_ENV.logto.endpoint,
  appId: APP_ENV.logto.appId,
  resources: globalApiResources,
  scopes: [
    UserScope.Email,
    UserScope.Profile,
    ...GLOBAL_OWNER_SCOPES,
  ],
};

export const isLogtoConfigurationComplete = Boolean(APP_ENV.logto.endpoint && APP_ENV.logto.appId);
export const isLogtoAuthEnabled = APP_ENV.auth.logtoEnabled && isLogtoConfigurationComplete;
