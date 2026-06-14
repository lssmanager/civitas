import { Badge, ListGroup } from "react-bootstrap";
import type { OwnerMeResponse } from "../../api/owner";
import { OwnerGuard } from "../../guards/OwnerGuard";
import { EmptyState, PageCard, PageShell } from "../../shared/ui";

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "No disponible");

function OwnerDashboard({ ownerMe }: { ownerMe: OwnerMeResponse }) {
  const { owner, scope } = ownerMe;

  return (
    <PageShell
      eyebrow="Owner"
      title="Portal owner"
      description="Entrada mínima protegida para el owner global de Civitas. Las funciones administrativas reales quedan fuera de esta fase."
      actions={<Badge bg="success">owner_global</Badge>}
    >
      <div className="row g-4">
        <div className="col-12 col-xl-7">
          <PageCard title="Owner autenticado" subtitle="Datos mínimos del usuario interno persistido en PostgreSQL.">
            <ListGroup variant="flush">
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Internal user id</span><span className="fw-semibold text-break text-end">{owner.id}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Logto user id</span><span className="fw-semibold text-break text-end">{owner.logtoUserId}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Email</span><span className="fw-semibold text-break text-end">{owner.email ?? "No disponible"}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Status</span><Badge bg={owner.status === "active" ? "success" : "warning"}>{owner.status}</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Rol global</span><Badge bg="primary">{owner.globalRole}</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Last login</span><span className="fw-semibold text-end">{formatDate(owner.lastLoginAt)}</span></ListGroup.Item>
            </ListGroup>
          </PageCard>
        </div>
        <div className="col-12 col-xl-5">
          <PageCard title="Alcance Fase 04" subtitle="Banderas explícitas para evitar prometer módulos no construidos.">
            <ListGroup variant="flush">
              <ListGroup.Item className="d-flex justify-content-between px-0"><span>Organizaciones</span><Badge bg={scope.organizations ? "success" : "secondary"}>Fuera de alcance</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between px-0"><span>Membresías</span><Badge bg={scope.memberships ? "success" : "secondary"}>Fuera de alcance</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between px-0"><span>RBAC fino</span><Badge bg={scope.rbac ? "success" : "secondary"}>Fuera de alcance</Badge></ListGroup.Item>
            </ListGroup>
          </PageCard>
        </div>
        <div className="col-12">
          <PageCard title="Dashboard inicial" subtitle="Placeholder protegido sin métricas reales ni administración de usuarios.">
            <EmptyState
              title="Sin funciones administrativas todavía"
              description="Esta fase solo habilita la puerta segura del owner global. Organizaciones, invitaciones, auditoría, métricas y RBAC se implementarán en fases posteriores."
            />
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}

export function OwnerPage() {
  return <OwnerGuard>{(ownerMe) => <OwnerDashboard ownerMe={ownerMe} />}</OwnerGuard>;
}
