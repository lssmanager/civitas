import { LogtoProvider } from "@logto/react";
import type { ReactNode } from "react";
import { APP_ENV } from "./env";
import { AuthRequiredState } from "./shared/ui/AuthRequiredState";
import { isLogtoConfigurationComplete, logtoConfig } from "./authConfig";

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!APP_ENV.auth.logtoEnabled) {
    return <>{children}</>;
  }

  if (!isLogtoConfigurationComplete) {
    return (
      <AuthRequiredState
        title="Configuración de Logto incompleta"
        message="VITE_ENABLE_LOGTO está activo, pero faltan VITE_LOGTO_ENDPOINT o VITE_LOGTO_APP_ID. Completa el .env del frontend o desactiva Logto para desarrollo local."
      />
    );
  }

  return <LogtoProvider config={logtoConfig}>{children}</LogtoProvider>;
}
