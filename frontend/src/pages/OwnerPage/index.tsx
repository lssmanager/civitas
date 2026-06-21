import { Badge, ListGroup } from "react-bootstrap";
import { Link, useOutletContext } from "react-router-dom";
import { useOwnerApi } from "../../api/owner";
import { devOwnerMe, type OwnerAuthorizationContext } from "../../guards/ownerAuthorization";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { DataTable, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

type OwnerDashboardProps = { ownerMe: OwnerAuthorizationContext };

const healthVariant = (severity?: string) => severity === "success" ? "success" : severity === "critical" ? "danger" : "warning";

function OwnerDashboard({ ownerMe }: OwnerDashboardProps) {
  const { owner } = ownerMe;
  const ownerApi = useOwnerApi();
  const summary = useStableResource({ load: ownerApi.getOperationsSummary, getKey: () => "owner-operations-summary", initialParams: undefined });

  return (
    <PageShell eyebrow="Owner" title="Resumen owner" description="Estado funcional de bootstrap y sincronización. Logto es la fuente canónica; Civitas resume propagación, pendientes, conflictos y reintentos sin exponer métricas crudas de infraestructura." actions={<><Badge bg="success">owner:read</Badge><Link className="btn btn-outline-secondary btn-sm" to="/owner/system">Vista técnica</Link></>}>
      <div className="row g-4">
        <div className="col-12">
          {summary.isLoading ? <LoadingState title="Cargando sincronización operativa" description="Consultando estado persistido en Civitas y traducción funcional de salud técnica." /> : null}
          {summary.error ? <ErrorState title="No se pudo cargar el resumen operativo" message={summary.error} /> : null}
        </div>
        {summary.data ? (
          <>
            <div className="col-12"><PageCard title="Estado general de sincronización" actions={<Badge bg={healthVariant(summary.data.functionalHealth.severity)}>{summary.data.functionalHealth.status}</Badge>}><p className="lead mb-0">{summary.data.functionalHealth.message}</p></PageCard></div>
            {[{ label: "Pendientes", value: summary.data.counts.queued }, { label: "En ejecución", value: summary.data.counts.running }, { label: "Fallos parciales", value: summary.data.counts.partialFailed }, { label: "Fallidas", value: summary.data.counts.failed }, { label: "Reintentables", value: summary.data.counts.retryable }, { label: "Downstream pendiente", value: summary.data.counts.organizationsWithPendingDownstreamSync }].map((item) => <div className="col-6 col-xl-2" key={item.label}><PageCard><p className="text-secondary small mb-1">{item.label}</p><p className="display-6 fw-semibold mb-0">{item.value}</p></PageCard></div>)}
            <div className="col-12 col-xl-5"><PageCard title="Incidentes funcionales recientes" subtitle="Errores legibles y accionables, sin stack traces ni payloads internos." actions={<Link to="/owner/logs" className="btn btn-outline-secondary btn-sm">Ver logs</Link>}>{summary.data.incidents.length === 0 ? <p className="text-secondary mb-0">No hay incidentes funcionales recientes.</p> : <ListGroup variant="flush">{summary.data.incidents.map((incident, index) => <ListGroup.Item className="px-0" key={`${incident.type}-${incident.organizationId ?? index}`}><div className="d-flex justify-content-between gap-3"><strong>{incident.organizationName ?? "Organización sin nombre"}</strong>{incident.retryable ? <Badge bg="info" text="dark">reintentable</Badge> : null}</div><p className="text-secondary small mb-0">{incident.message}</p></ListGroup.Item>)}</ListGroup>}</PageCard></div>
            <div className="col-12 col-xl-7"><PageCard title="Organizaciones con pendientes" subtitle="Estado canónico, downstream, paso actual y retryability por organización." actions={<Link to="/owner/organizations" className="btn btn-outline-primary btn-sm">Ver operaciones pendientes</Link>}><DataTable rows={summary.data.organizations} getRowKey={(row) => row.profileId} emptyTitle="Sin pendientes" emptyDescription="Todas las organizaciones conocidas están completas o sin errores funcionales." columns={[{ key: "name", header: "Organización", render: (row) => row.name ?? row.organizationId ?? "—" }, { key: "canonical", header: "Canónico", render: (row) => <Badge bg="primary">{row.canonicalStatus}</Badge> }, { key: "downstream", header: "Downstream", render: (row) => <Badge bg={row.downstreamStatus === "linked" || row.downstreamStatus === "synced" ? "success" : "warning"}>{row.downstreamStatus}</Badge> }, { key: "step", header: "Paso", render: (row) => row.currentStep }, { key: "retry", header: "Acción", render: (row) => row.retryable ? <Badge bg="info" text="dark">reintento requerido</Badge> : "—" }]} /></PageCard></div>
          </>
        ) : null}
        <div className="col-12 col-xl-7"><PageCard title="Owner autorizado por Logto" subtitle="El owner global se determina por scopes globales; no por pertenencia tenant-scoped."><ListGroup variant="flush"><ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Internal user id</span><span className="fw-semibold text-break text-end">{owner.internalUserId}</span></ListGroup.Item><ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Logto user id</span><span className="fw-semibold text-break text-end">{owner.logtoUserId}</span></ListGroup.Item><ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Scope requerido</span><Badge bg="success">{owner.requiredScope}</Badge></ListGroup.Item></ListGroup></PageCard></div>
        <div className="col-12 col-xl-5"><PageCard title="Accesos rápidos"><div className="d-flex flex-column gap-2"><Link to="/owner/organizations" className="btn btn-outline-primary text-start">Crear organización</Link><Link to="/select-organization" className="btn btn-outline-secondary text-start">Select Organization</Link><Link to="/owner/logs" className="btn btn-outline-secondary text-start">Logs y conflictos</Link><Link to="/owner/settings" className="btn btn-outline-secondary text-start">Settings</Link></div></PageCard></div>
      </div>
    </PageShell>
  );
}

export function OwnerPage() {
  const ownerMe = useOutletContext<OwnerAuthorizationContext | undefined>();
  return <OwnerDashboard ownerMe={ownerMe ?? devOwnerMe} />;
}
