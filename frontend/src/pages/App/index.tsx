import { useLogto } from "@logto/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-bootstrap";
import { Navigate, Route, Routes } from "react-router-dom";
import { ApiRequestError } from "../../api/base";
import { useMeApi } from "../../api/me";
import { isLogtoAuthEnabled } from "../../authConfig";
import { APP_ENV } from "../../env";
import { AppLayout } from "../../layouts/AppLayout";
import { AuthRequiredState } from "../../shared/ui/AuthRequiredState";
import { ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";
import { AccountPage } from "../AccountPage";
import Callback from "../Callback";
import { OwnerPage } from "../OwnerPage";
import { SelectOrganizationPage } from "../SelectOrganizationPage";

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

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const { getMe } = useMeApi();
  const getMeRef = useRef(getMe);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string>();
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    getMeRef.current = getMe;
  }, [getMe]);

  useEffect(() => {
    let isMounted = true;

    async function bootstrapSession() {
      setIsReady(false);
      setError(undefined);

      for (let attempt = 1; attempt <= SESSION_BOOTSTRAP_MAX_ATTEMPTS; attempt += 1) {
        try {
          await getMeRef.current();

          if (isMounted) {
            setIsReady(true);
          }
          return;
        } catch (bootstrapError) {
          const shouldRetry = attempt < SESSION_BOOTSTRAP_MAX_ATTEMPTS && isRetryableBootstrapError(bootstrapError);

          if (!shouldRetry) {
            if (isMounted) {
              setError(getBootstrapErrorMessage(bootstrapError));
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

  if (!isReady && !error) {
    return (
      <PageShell eyebrow="Sesion" title="Preparando acceso" description="Validando token, creando usuario interno y calentando la sesion antes de cargar la aplicacion.">
        <PageCard title="Bootstrap de sesion">
          <LoadingState title="Inicializando Civitas" description="Estamos ejecutando una sola llamada controlada a /me para estabilizar la sesion." />
        </PageCard>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell eyebrow="Sesion" title="No pudimos preparar la sesion" description="La aplicacion no deberia depender de entrar primero a otra pestaña para arrancar.">
        <PageCard title="Bootstrap fallido">
          <ErrorState
            title="Fallo al inicializar Civitas"
            message={error}
            action={<Button onClick={() => setRetryNonce((value) => value + 1)}>Reintentar</Button>}
          />
        </PageCard>
      </PageShell>
    );
  }

  return <>{children}</>;
}

function LogtoPrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, signIn } = useLogto();
  if (isLoading) {
    return <AuthRequiredState title="Validando sesion" message="Estamos comprobando tu sesion de Logto." isLoading />;
  }

  if (!isAuthenticated) {
    return (
      <AuthRequiredState
        message="Esta ruta es privada. Inicia sesion con Logto para continuar."
        onSignIn={() => void signIn(APP_ENV.app.redirectUri)}
      />
    );
  }

  return <SessionBootstrap>{children}</SessionBootstrap>;
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  if (!isLogtoAuthEnabled) {
    return <>{children}</>;
  }

  return <LogtoPrivateRoute>{children}</LogtoPrivateRoute>;
}

function App() {
  return (
    <Routes>
      <Route path="callback" element={<Callback />} />
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/owner" replace />} />
        <Route
          path="owner"
          element={
            <PrivateRoute>
              <OwnerPage />
            </PrivateRoute>
          }
        />
        <Route
          path="select-organization"
          element={
            <PrivateRoute>
              <SelectOrganizationPage />
            </PrivateRoute>
          }
        />
        <Route
          path="account"
          element={
            <PrivateRoute>
              <AccountPage />
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/owner" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
