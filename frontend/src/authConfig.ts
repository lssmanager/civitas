import { UserScope, type LogtoConfig } from "@logto/react";
import { APP_ENV } from "./env";

const GLOBAL_API_SCOPES = [
  "owner:read",
  "owner:manage",
  "organizations:read",
  "organizations:create",
  "organizations:manage",
] as const;

export const logtoConfig: LogtoConfig = {
  endpoint: APP_ENV.logto.endpoint,
  appId: APP_ENV.logto.appId,
  resources: APP_ENV.api.resourceIndicator ? [APP_ENV.api.resourceIndicator] : undefined,
  scopes: [
    UserScope.Email,
    UserScope.Profile,
    UserScope.Organizations,
    ...GLOBAL_API_SCOPES,
  ],
};

export const isLogtoConfigurationComplete = Boolean(APP_ENV.logto.endpoint && APP_ENV.logto.appId);
export const isLogtoAuthEnabled = APP_ENV.auth.logtoEnabled && isLogtoConfigurationComplete;
