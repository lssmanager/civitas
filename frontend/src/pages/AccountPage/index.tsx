import { useEffect, useState } from "react";
import { Alert, Badge, ListGroup, Spinner } from "react-bootstrap";
import { useMeApi, type MeProfileResponse } from "../../api/me";
import { deriveAuthorizationCapabilities } from "../../authz/capabilities";
import { isLogtoAuthEnabled } from "../../authConfig";
import { useSession } from "../../session/sessionContext";
import { ErrorState, PageCard, PageShell } from "../../shared/ui";

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "No disponible");

function LogtoAccountDetails() {
  const { error, idTokenClaims, me, refresh } = useSession();
  const { getMeProfile } = useMeApi();
  const [profile, setProfile] = useState<MeProfileResponse>();
  const [profileError, setProfileError] = useState<string>();
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const capabilities = deriveAuthorizationCapabilities(me);

  useEffect(() => {
    let isMounted = true;
    setIsProfileLoading(true);
    setProfileError(undefined);
    getMeProfile()
      .then((response) => { if (isMounted) setProfile(response); })
      .catch((profileLoadError) => { if (isMounted) setProfileError(profileLoadError instanceof Error ? profileLoadError.message : "No se pudo cargar el perfil enriquecido."); })
      .finally(() => { if (isMounted) setIsProfileLoading(false); });
    return () => { isMounted = false; };
  }, [getMeProfile]);
  const email = me?.identity?.email ?? me?.user.email ?? idTokenClaims?.email ?? "No disponible";
  const displayName = me?.identity?.displayName ?? me?.identity?.username ?? idTokenClaims?.name ?? idTokenClaims?.username ?? idTokenClaims?.sub ?? "No disponible";

  if (error) {
    return <Alert variant="danger">{error}</Alert>;
  }

  return (
    <ListGroup variant="flush">
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Nombre visible Logto</span><span className="fw-semibold text-break text-end">{displayName}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Internal user id</span><span className="fw-semibold text-break text-end">{me?.identity?.internalUserId ?? me?.user.id ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Logto user id</span><span className="fw-semibold text-break text-end">{me?.identity?.logtoUserId ?? me?.user.logtoUserId ?? idTokenClaims?.sub ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Email Logto</span><span className="fw-semibold text-break text-end">{email}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Status</span><Badge bg={me?.user.status === "active" ? "success" : "warning"}>{me?.user.status ?? "No disponible"}</Badge></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Last login</span><span className="fw-semibold text-end">{formatDate(me?.user.lastLoginAt)}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Token scopes</span><span className="fw-semibold text-break text-end">{me?.auth?.scopes?.join(", ") || "No disponibles"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Roles globales</span><span className="fw-semibold text-break text-end">{me?.auth?.globalRoles?.join(", ") || "No disponibles"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Roles organización</span><span className="fw-semibold text-break text-end">{me?.auth?.organizationRoles?.join(", ") || "No disponibles"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Owner read/write</span><span className="fw-semibold text-break text-end">{String(capabilities.owner.canReadOwner)} / {String(capabilities.owner.canWriteOwner)}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Capacidades UI</span><span className="fw-semibold text-break text-end">{Object.entries(capabilities).filter(([, value]) => value === true).map(([key]) => key).join(", ") || "Sin capacidades"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Audience/resource</span><span className="fw-semibold text-break text-end">{Array.isArray(me?.auth?.audience) ? me?.auth?.audience.join(", ") : me?.auth?.audience ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Organization id</span><span className="fw-semibold text-break text-end">{me?.auth?.organizationId ?? "Token global"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Token emitido</span><span className="fw-semibold text-end">{formatDate(me?.auth?.token?.issuedAt)}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Token expira</span><span className="fw-semibold text-end">{formatDate(me?.auth?.token?.expiresAt)}</span></ListGroup.Item>
      <ListGroup.Item className="px-0"><Alert variant="info" className="mb-0 small">Los permisos efectivos son los scopes del access token actual. Cambios de rol en Logto se reflejan al renovar el token, refrescar sesión o volver a iniciar sesión.</Alert></ListGroup.Item>
      <ListGroup.Item className="px-0">{isProfileLoading ? <span className="small text-secondary"><Spinner size="sm" /> Cargando perfil enriquecido sin bloquear la sesión…</span> : profileError ? <Alert variant="warning" className="mb-0 small">/me/profile falló sin tumbar la sesión base: {profileError}</Alert> : profile ? <Alert variant="success" className="mb-0 small">Perfil enriquecido cargado desde {profile.sourcePolicy?.identity}: {String(profile.identity.email ?? profile.identity.name ?? "sin email")}</Alert> : null}</ListGroup.Item>
      <ListGroup.Item className="px-0"><button type="button" className="btn btn-outline-primary btn-sm" onClick={refresh}>Refrescar identidad/token</button></ListGroup.Item>
    </ListGroup>
  );
}

function DevAccountDetails() {
  return (
    <ListGroup variant="flush">
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Nombre visible</span><span className="fw-semibold">Usuario Civitas Demo</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Correo</span><span className="fw-semibold">demo@civitas.local</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Modo</span><Badge bg="secondary">Mock sin auth</Badge></ListGroup.Item>
    </ListGroup>
  );
}

export function AccountPage() {
  return (
    <PageShell eyebrow="Cuenta" title="Perfil de sesión" description="Muestra identidad canónica de Logto, metadata mínima local y los scopes vigentes del token actual." actions={<Badge bg="primary">Logto-first</Badge>}>
      <div className="row g-4">
        <div className="col-12 col-lg-7"><PageCard title="Identidad de sesión" subtitle="Logto es la fuente de identidad; PostgreSQL solo conserva el usuario interno vinculado y metadata operativa.">{isLogtoAuthEnabled ? <LogtoAccountDetails /> : <DevAccountDetails />}</PageCard></div>
        <div className="col-12 col-lg-5"><PageCard title="Fuente de autorización"><ErrorState title="Logto RBAC es la autoridad" message="PostgreSQL conserva el usuario interno y metadata de producto. El acceso owner, organizaciones y permisos tenant-scoped se validan con scopes/tokens de Logto, no con users.global_role." /></PageCard></div>
      </div>
    </PageShell>
  );
}
