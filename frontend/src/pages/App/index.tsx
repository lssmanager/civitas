import { useLogto } from "@logto/react";
import { useEffect, useRef } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { routeCapabilities } from "../../authz/routePolicy";
import { isLogtoAuthEnabled } from "../../authConfig";
import { APP_ENV } from "../../env";
import { AppLayout } from "../../layouts/AppLayout";
import { CapabilityRouteGuard } from "../../guards/CapabilityRouteGuard";
import { OwnerGuard } from "../../guards/OwnerGuard";
import { devOwnerMe } from "../../guards/ownerAuthorization";
import { SessionGate, SessionProvider } from "../../session/SessionContext";
import { SessionContext } from "../../session/sessionContext";
import { AuthRequiredState } from "../../shared/ui/AuthRequiredState";
import { AccountPage } from "../AccountPage";
import Callback from "../Callback";
import { OwnerPage } from "../OwnerPage";
import { OwnerAuditPage } from "../OwnerAuditPage";
import { OwnerBrandingSettingsPage } from "../OwnerBrandingSettingsPage";
import { OwnerOrganizationsPage } from "../OwnerOrganizationsPage";
import { OwnerOrganizationConsolePage } from "../OwnerOrganizationConsolePage";
import { OwnerOrganizationSettingsPage } from "../OwnerOrganizationSettingsPage";
import { OwnerSettingsPage } from "../OwnerSettingsPage";
import { OwnerSystemPage } from "../OwnerSystemPage";
import { OwnerWorkerQueuesPage } from "../OwnerWorkerQueuesPage";
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
    return (
      <SessionContext.Provider value={{ me: { user: { id: "dev-owner", logtoUserId: "dev-logto-owner", email: "demo@civitas.local", status: "active", lastLoginAt: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }, auth: { scopes: ["owner:read", "owner:write"], roles: ["owner_global"], globalRoles: ["owner_global"], organizationRoles: [], organizationId: null, owner: { canReadOwner: true, canWriteOwner: true, globalRoles: ["owner_global"], scopes: ["owner:read", "owner:write"] } } }, isLoading: false, refresh: () => undefined }}>
        <AppLayout />
      </SessionContext.Provider>
    );
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
            <Route index element={<CapabilityRouteGuard capability={routeCapabilities["/owner"]}><OwnerPage /></CapabilityRouteGuard>} />
            <Route path="organizations" element={<CapabilityRouteGuard capability={routeCapabilities["/owner/organizations"]}><OwnerOrganizationsPage /></CapabilityRouteGuard>} />
            <Route path="organizations/:organizationId" element={<CapabilityRouteGuard capability={routeCapabilities["/owner/organizations/:organizationId"]}><OwnerOrganizationConsolePage /></CapabilityRouteGuard>} />
            <Route path="organizations/:organizationId/settings" element={<CapabilityRouteGuard capability={routeCapabilities["/owner/organizations/:organizationId/settings"]}><OwnerOrganizationSettingsPage /></CapabilityRouteGuard>} />
            <Route path="logs" element={<CapabilityRouteGuard capability={routeCapabilities["/owner/logs"]}><OwnerAuditPage /></CapabilityRouteGuard>} />
            <Route path="system" element={<CapabilityRouteGuard capability={routeCapabilities["/owner/system"]}><OwnerSystemPage /></CapabilityRouteGuard>} />
            <Route path="system/worker-queues" element={<CapabilityRouteGuard capability={routeCapabilities["/owner/system/worker-queues"]}><OwnerWorkerQueuesPage /></CapabilityRouteGuard>} />
            <Route path="audit" element={<Navigate to="/owner/logs" replace />} />
            <Route path="settings" element={<CapabilityRouteGuard capability={routeCapabilities["/owner/settings/branding"]}><Navigate to="/owner/settings/branding" replace /></CapabilityRouteGuard>} />
            <Route path="settings/branding" element={<CapabilityRouteGuard capability={routeCapabilities["/owner/settings/branding"]}><OwnerBrandingSettingsPage /></CapabilityRouteGuard>} />
            <Route path="settings/role-mapping" element={<CapabilityRouteGuard capability={routeCapabilities["/owner/settings/role-mapping"]}><OwnerSettingsPage /></CapabilityRouteGuard>} />
          </Route>
          <Route path="select-organization" element={<CapabilityRouteGuard capability={routeCapabilities["/select-organization"]}><SelectOrganizationPage /></CapabilityRouteGuard>} />
          <Route path="account" element={<CapabilityRouteGuard capability={routeCapabilities["/account"]}><AccountPage /></CapabilityRouteGuard>} />
          <Route path="*" element={<Navigate to="/owner" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
