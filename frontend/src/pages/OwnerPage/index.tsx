import { Badge, ListGroup } from "react-bootstrap";
import { Link, useOutletContext } from "react-router-dom";
import { devOwnerMe, type OwnerAuthorizationContext } from "../../guards/ownerAuthorization";
import { PageCard, PageShell } from "../../shared/ui";

type OwnerDashboardProps = {
  ownerMe: OwnerAuthorizationContext;
};

function OwnerDashboard({ ownerMe }: OwnerDashboardProps) {
  const { owner } = ownerMe;

  return (
    <PageShell
      eyebrow="Owner"
      title="Resumen owner"
      description="Entrada protegida por Logto RBAC. Civitas valida scopes globales del API resource; Logto sigue siendo fuente canónica."
      actions={<Badge bg="success">owner:read</Badge>}
    >
      <div className="row g-4">
        <div className="col-12 col-xl-7">
          <PageCard title="Owner autorizado por Logto" subtitle="El owner global se determina por scopes del access token de Logto, no por pertenencia a cada organización.">
            <ListGroup variant="flush">
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Internal user id</span><span className="fw-semibold text-break text-end">{owner.internalUserId}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Logto user id</span><span className="fw-semibold text-break text-end">{owner.logtoUserId}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Autorizado por</span><Badge bg="primary">{owner.authorizedBy}</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Scope requerido</span><Badge bg="success">{owner.requiredScope}</Badge></ListGroup.Item>
            </ListGroup>
          </PageCard>
        </div>
        <div className="col-12 col-xl-5">
          <PageCard title="Secciones de Fase 07" subtitle="La administración owner queda separada en vistas navegables por responsabilidad.">
            <div className="d-flex flex-column gap-2">
              <Link to="/owner/organizations" className="btn btn-outline-primary text-start">Crear organización</Link>
              <Link to="/select-organization" className="btn btn-outline-secondary text-start">Select Organization</Link>
              <Link to="/owner/logs" className="btn btn-outline-secondary text-start">Logs</Link>
              <Link to="/owner/settings" className="btn btn-outline-secondary text-start">Settings</Link>
            </div>
          </PageCard>
        </div>
        <div className="col-12">
          <PageCard title="Scopes detectados" subtitle="Permisos globales incluidos en el access token del API resource.">
            <div className="d-flex flex-wrap gap-2">
              {owner.scopes.map((scope) => <Badge bg="secondary" key={scope}>{scope}</Badge>)}
            </div>
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}

export function OwnerPage() {
  const ownerMe = useOutletContext<OwnerAuthorizationContext | undefined>();

  return <OwnerDashboard ownerMe={ownerMe ?? devOwnerMe} />;
}
