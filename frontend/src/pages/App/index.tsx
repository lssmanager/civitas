import { useLogto } from "@logto/react";
import { useEffect, useRef } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { isLogtoAuthEnabled } from "../../authConfig";
import { APP_ENV } from "../../env";
import { AppLayout } from "../../layouts/AppLayout";
import { OwnerGuard } from "../../guards/OwnerGuard";
import { devOwnerMe } from "../../guards/ownerAuthorization";
import { SessionGate, SessionProvider } from "../../session/SessionContext";
import { AuthRequiredState } from "../../shared/ui/AuthRequiredState";
import { AccountPage } from "../AccountPage";
import Callback from "../Callback";
import { OwnerPage } from "../OwnerPage";
import { OwnerAuditPage } from "../OwnerAuditPage";
import { OwnerOrganizationsPage } from "../OwnerOrganizationsPage";
import { SelectOrganizationPage } from "../SelectOrganizationPage";

function LogtoPrivateLayout() {
  const { isAuthenticated, isLoading, signIn } = useLogto();
  const hasAuthenticatedOnceRef = useRef(false);

  useEffect(() => {
    if (isAuthenticated) {
      hasAuthenticatedOnceRef.current = true;
    }
  }, [isAuthenticated]);

  if (isLoading && !isAuthenticated && !hasAuthenticatedOnceRef.current) {
    return <AuthRequiredState title="Validando sesion" message="Estamos comprobando tu sesion de Logto." isLoading />;
  }

  if (!isAuthenticated && !isLoading) {
    return (
      <AuthRequiredState
        message="Esta ruta es privada. Inicia sesion con Logto para continuar."
        onSignIn={() => void signIn(APP_ENV.app.redirectUri)}
      />
    );
  }

  return (
    <SessionProvider>
      <AppLayout />
    </SessionProvider>
  );
}

function ProtectedLayout() {
  if (!isLogtoAuthEnabled) {
    return <AppLayout />;
  }

  return <LogtoPrivateLayout />;
}

function ProtectedContentOutlet() {
  if (!isLogtoAuthEnabled) {
    return <Outlet />;
  }

  return (
    <SessionGate>
      <Outlet />
    </SessionGate>
  );
}

function OwnerLayout() {
  if (!isLogtoAuthEnabled) {
    return <Outlet context={devOwnerMe} />;
  }

  return <OwnerGuard>{(ownerMe) => <Outlet context={ownerMe} />}</OwnerGuard>;
}

function App() {
  return (
    <Routes>
      <Route path="callback" element={<Callback />} />
      <Route element={<ProtectedLayout />}>
        <Route element={<ProtectedContentOutlet />}>
          <Route index element={<Navigate to="/owner" replace />} />
          <Route path="owner" element={<OwnerLayout />}>
            <Route index element={<OwnerPage />} />
            <Route path="organizations" element={<OwnerOrganizationsPage />} />
            <Route path="logs" element={<OwnerAuditPage />} />
            <Route path="settings" element={<OwnerPage />} />
          </Route>
          <Route path="select-organization" element={<SelectOrganizationPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/owner" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
