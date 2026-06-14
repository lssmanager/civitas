import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "react-bootstrap";
import { ApiRequestError } from "../api/base";
import { type MeResponse, useMeApi } from "../api/me";
import { ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

const SESSION_BOOTSTRAP_RETRY_DELAY_MS = 400;
const SESSION_BOOTSTRAP_MAX_ATTEMPTS = 2;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function isRetryableBootstrapError(error: unknown) {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }

  return error.status === undefined || error.status >= 500;
}

function getBootstrapErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) {
      return "No pudimos obtener un access token valido de Logto. Cierra sesion y vuelve a entrar.";
    }

    if (error.status === 403) {
      return "La sesion existe, pero Civitas no pudo inicializar el usuario interno con los permisos actuales.";
    }
  }

  return error instanceof Error ? error.message : "No se pudo preparar la sesion de Civitas.";
}

type SessionContextValue = {
  me?: MeResponse;
  isLoading: boolean;
  error?: string;
  refresh: () => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { getMe } = useMeApi();
  const getMeRef = useRef(getMe);
  const [me, setMe] = useState<MeResponse>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    getMeRef.current = getMe;
  }, [getMe]);

  useEffect(() => {
    let isMounted = true;

    async function bootstrapSession() {
      setIsLoading(true);
      setError(undefined);

      for (let attempt = 1; attempt <= SESSION_BOOTSTRAP_MAX_ATTEMPTS; attempt += 1) {
        try {
          const response = await getMeRef.current();

          if (isMounted) {
            setMe(response);
            setIsLoading(false);
          }
          return;
        } catch (bootstrapError) {
          const shouldRetry = attempt < SESSION_BOOTSTRAP_MAX_ATTEMPTS && isRetryableBootstrapError(bootstrapError);

          if (!shouldRetry) {
            if (isMounted) {
              setMe(undefined);
              setError(getBootstrapErrorMessage(bootstrapError));
              setIsLoading(false);
            }
            return;
          }

          await wait(SESSION_BOOTSTRAP_RETRY_DELAY_MS);
        }
      }
    }

    void bootstrapSession();

    return () => {
      isMounted = false;
    };
  }, [retryNonce]);

  const value = useMemo(
    () => ({
      me,
      isLoading,
      error,
      refresh: () => setRetryNonce((current) => current + 1),
    }),
    [error, isLoading, me]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }

  return context;
}

export function SessionGate({ children }: { children: ReactNode }) {
  const { error, isLoading, refresh } = useSession();

  if (isLoading) {
    return (
      <PageShell eyebrow="Sesion" title="Preparando acceso" description="Validando token, creando usuario interno y calentando la sesion antes de cargar la aplicacion.">
        <PageCard title="Bootstrap de sesion">
          <LoadingState title="Inicializando Civitas" description="La aplicacion usa una sola llamada global a /me para estabilizar la sesion." />
        </PageCard>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell eyebrow="Sesion" title="No pudimos preparar la sesion" description="La aplicacion no debe depender de abrir primero otra pestaña para arrancar.">
        <PageCard title="Bootstrap fallido">
          <ErrorState
            title="Fallo al inicializar Civitas"
            message={error}
            action={<Button onClick={refresh}>Reintentar</Button>}
          />
        </PageCard>
      </PageShell>
    );
  }

  return <>{children}</>;
}
