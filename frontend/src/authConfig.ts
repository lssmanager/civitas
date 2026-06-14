import { ReservedResource, UserScope, type LogtoConfig } from "@logto/react";
import { APP_ENV } from "./env";

export const logtoConfig: LogtoConfig = {
  endpoint: APP_ENV.logto.endpoint,
  appId: APP_ENV.logto.appId,
  resources: APP_ENV.api.resourceIndicator ? [APP_ENV.api.resourceIndicator, ReservedResource.Organization] : [ReservedResource.Organization],
  scopes: [
    UserScope.Organizations,
    "owner:read",
    "owner:manage",
    "organizations:read",
    "organizations:create",
    "organizations:manage",
    "organization:read",
    "organization:manage",
    "members:read",
    "members:invite",
    "members:manage",
    "documents:read",
    "documents:create",
  ],
};

export const isLogtoConfigurationComplete = Boolean(APP_ENV.logto.endpoint && APP_ENV.logto.appId);
export const isLogtoAuthEnabled = APP_ENV.auth.logtoEnabled && isLogtoConfigurationComplete;
