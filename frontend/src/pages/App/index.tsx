import { useLogto } from "@logto/react";
import { Navigate, Route, Routes } from "react-router-dom";
import { isLogtoAuthEnabled } from "../../authConfig";
import { APP_ENV } from "../../env";
import { AppLayout } from "../../layouts/AppLayout";
import { SessionGate, SessionProvider } from "../../session/SessionContext";
import { AuthRequiredState } from "../../shared/ui/AuthRequiredState";
import { AccountPage } from "../AccountPage";
import Callback from "../Callback";
import { OwnerPage } from "../OwnerPage";
import { SelectOrganizationPage } from "../SelectOrganizationPage";

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

  return (
    <SessionProvider>
      <SessionGate>{children}</SessionGate>
    </SessionProvider>
  );
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
