import type { LogtoConfig } from "@logto/react";
import { APP_ENV } from "./env";

export const logtoConfig: LogtoConfig = {
  endpoint: APP_ENV.logto.endpoint,
  appId: APP_ENV.logto.appId,
  resources: APP_ENV.api.resourceIndicator ? [APP_ENV.api.resourceIndicator] : [],
  scopes: [
    "openid",
    "profile",
    "offline_access",
    "owner:read",
    "owner:manage",
    "organizations:read",
    "organizations:create",
    "organizations:manage",
  ],
};

export const isLogtoConfigurationComplete = Boolean(APP_ENV.logto.endpoint && APP_ENV.logto.appId);
export const isLogtoAuthEnabled = APP_ENV.auth.logtoEnabled && isLogtoConfigurationComplete;
