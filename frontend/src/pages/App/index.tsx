import { useLogto } from "@logto/react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { isLogtoAuthEnabled } from "../../authConfig";
import { APP_ENV } from "../../env";
import { AppLayout } from "../../layouts/AppLayout";
import { SessionGate, SessionProvider } from "../../session/SessionContext";
import { AuthRequiredState } from "../../shared/ui/AuthRequiredState";
import { AccountPage } from "../AccountPage";
import Callback from "../Callback";
import { OwnerPage } from "../OwnerPage";
import { SelectOrganizationPage } from "../SelectOrganizationPage";

function LogtoPrivateOutlet() {
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
      <SessionGate>
        <Outlet />
      </SessionGate>
    </SessionProvider>
  );
}

function ProtectedOutlet() {
  if (!isLogtoAuthEnabled) {
    return <Outlet />;
  }

  return <LogtoPrivateOutlet />;
}

function App() {
  return (
    <Routes>
      <Route path="callback" element={<Callback />} />
      <Route element={<AppLayout />}>
        <Route element={<ProtectedOutlet />}>
          <Route index element={<Navigate to="/owner" replace />} />
          <Route path="owner" element={<OwnerPage />} />
          <Route path="select-organization" element={<SelectOrganizationPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/owner" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
