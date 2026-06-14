import { Alert, Badge, ListGroup } from "react-bootstrap";
import { isLogtoAuthEnabled } from "../../authConfig";
import { useSession } from "../../session/SessionContext";
import { ErrorState, PageCard, PageShell } from "../../shared/ui";

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "No disponible");

function LogtoAccountDetails() {
  const { error, idTokenClaims, me } = useSession();

  if (error) {
    return <Alert variant="danger">{error}</Alert>;
  }

  return (
    <ListGroup variant="flush">
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Internal user id</span><span className="fw-semibold text-break text-end">{me?.user.id ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Logto user id</span><span className="fw-semibold text-break text-end">{me?.user.logtoUserId ?? idTokenClaims?.sub ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Email</span><span className="fw-semibold text-break text-end">{me?.user.email ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Status</span><Badge bg={me?.user.status === "active" ? "success" : "warning"}>{me?.user.status ?? "No disponible"}</Badge></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Last login</span><span className="fw-semibold text-end">{formatDate(me?.user.lastLoginAt)}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Token scopes</span><span className="fw-semibold text-break text-end">{me?.auth?.scopes?.join(", ") || "No disponibles"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Audience/resource</span><span className="fw-semibold text-break text-end">{Array.isArray(me?.auth?.audience) ? me?.auth?.audience.join(", ") : me?.auth?.audience ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Organization id</span><span className="fw-semibold text-break text-end">{me?.auth?.organizationId ?? "Token global"}</span></ListGroup.Item>
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
    <PageShell eyebrow="Cuenta" title="Perfil de sesión" description="Muestra la identidad interna de Civitas creada desde la sesión autenticada de Logto." actions={<Badge bg="primary">Fase 03</Badge>}>
      <div className="row g-4">
        <div className="col-12 col-lg-7"><PageCard title="Usuario interno" subtitle="Datos mínimos persistidos en PostgreSQL y vinculados al sub de Logto.">{isLogtoAuthEnabled ? <LogtoAccountDetails /> : <DevAccountDetails />}</PageCard></div>
        <div className="col-12 col-lg-5"><PageCard title="Fuente de autorización"><ErrorState title="Logto RBAC es la autoridad" message="PostgreSQL conserva el usuario interno y metadata de producto. El acceso owner, organizaciones y permisos tenant-scoped se validan con scopes/tokens de Logto, no con users.global_role." /></PageCard></div>
      </div>
    </PageShell>
  );
}
