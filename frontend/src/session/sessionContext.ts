import { createContext, useContext } from "react";
import type { IdTokenClaims } from "@logto/react";
import type { MeResponse } from "../api/me";

export type SessionContextValue = {
  me?: MeResponse;
  idTokenClaims?: IdTokenClaims;
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

export const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }

  return context;
}
