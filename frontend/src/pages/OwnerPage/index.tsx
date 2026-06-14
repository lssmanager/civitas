import { Badge, ListGroup } from "react-bootstrap";
import type { OwnerMeResponse } from "../../api/owner";
import { OwnerGuard } from "../../guards/OwnerGuard";
import { EmptyState, PageCard, PageShell } from "../../shared/ui";

function OwnerDashboard({ ownerMe }: { ownerMe: OwnerMeResponse }) {
  const { owner } = ownerMe;

  return (
    <PageShell
      eyebrow="Owner"
      title="Portal owner"
      description="Entrada protegida por Logto RBAC. Civitas valida scopes globales del API resource, no roles guardados en PostgreSQL."
      actions={<Badge bg="success">owner:read</Badge>}
    >
      <div className="row g-4">
        <div className="col-12 col-xl-7">
          <PageCard title="Owner autorizado por Logto" subtitle="El owner global se determina por scopes del access token de Logto.">
            <ListGroup variant="flush">
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Internal user id</span><span className="fw-semibold text-break text-end">{owner.internalUserId}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Logto user id</span><span className="fw-semibold text-break text-end">{owner.logtoUserId}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Autorizado por</span><Badge bg="primary">{owner.authorizedBy}</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Scope requerido</span><Badge bg="success">{owner.requiredScope}</Badge></ListGroup.Item>
            </ListGroup>
          </PageCard>
        </div>
        <div className="col-12 col-xl-5">
          <PageCard title="Scopes detectados" subtitle="Permisos globales incluidos en el access token del API resource.">
            <div className="d-flex flex-wrap gap-2">
              {owner.scopes.map((scope) => <Badge bg="secondary" key={scope}>{scope}</Badge>)}
            </div>
          </PageCard>
        </div>
        <div className="col-12">
          <PageCard title="Arquitectura B2B" subtitle="Logto Organizations es la fuente canónica de tenants y membresías.">
            <EmptyState
              title="PostgreSQL solo guarda metadata de producto"
              description="Las organizaciones se crean primero en Logto; Civitas persiste perfiles internos vinculados por logto_organization_id cuando necesita enriquecer datos del producto."
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
