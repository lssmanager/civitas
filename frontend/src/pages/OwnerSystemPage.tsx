import { Badge, Button, ListGroup } from "react-bootstrap";
import { useOwnerApi, type OwnerIntegrationHealthCheck } from "../api/owner";
import { useStableResource } from "../shared/hooks/useStableResource";
import { DataTable, ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

const badgeVariant = (check: OwnerIntegrationHealthCheck) =>
  check.severity === "success" ? "success" : check.severity === "danger" ? "danger" : check.severity === "secondary" ? "secondary" : "warning";

export function OwnerSystemPage() {
  const ownerApi = useOwnerApi();
  const workerResource = useStableResource({ load: ownerApi.getWorkerHealth, getKey: () => "owner-worker-health", initialParams: undefined });
  const integrationsResource = useStableResource({ load: ownerApi.getIntegrationsHealth, getKey: () => "owner-integrations-health", initialParams: undefined });
  const retryAll = () => { workerResource.retry(); integrationsResource.retry(); };

  return (
    <PageShell eyebrow="Owner / sistema" title="Salud técnica e integraciones" description="Checks permanentes para Logto, Redis/BullMQ, FluentCRM, WordPress y el camino preparado para Moodle. Estos checks viven fuera del wizard de crear organización.">
      <div className="d-flex justify-content-end mb-3"><Button size="sm" variant="outline-primary" onClick={retryAll}>Revisar ahora</Button></div>
      {workerResource.isLoading || integrationsResource.isLoading ? <LoadingState title="Cargando salud técnica" description="Consultando worker, colas e integraciones." /> : null}
      {workerResource.error ? <ErrorState title="No se pudo cargar worker health" message={workerResource.error} action={<Button onClick={workerResource.retry}>Reintentar worker</Button>} /> : null}
      {integrationsResource.error ? <ErrorState title="No se pudieron cargar integraciones" message={integrationsResource.error} action={<Button onClick={integrationsResource.retry}>Reintentar integraciones</Button>} /> : null}
      <div className="row g-4">
        {integrationsResource.data ? (
          <div className="col-12"><PageCard title="Checks permanentes de integración" subtitle={`Estado general: ${integrationsResource.data.status}. Última revisión: ${new Date(integrationsResource.data.checkedAt).toLocaleString()}.`}><div className="row g-3">{integrationsResource.data.checks.map((check) => <div className="col-12 col-xl-6" key={check.key}><div className="border rounded-3 p-3 h-100"><div className="d-flex justify-content-between gap-3"><div><h3 className="h6 mb-1">{check.label}</h3><div className="small text-secondary">{check.system}{check.required === false ? " · opcional/futuro" : " · requerido"}</div></div><Badge bg={badgeVariant(check)} className="align-self-start">{check.status}</Badge></div><p className="small mb-2 mt-3">{check.message}</p>{check.nextAction ? <div className="small text-secondary">Acción: {check.nextAction}</div> : null}</div></div>)}</div></PageCard></div>
        ) : null}
        {workerResource.data ? (
          <><div className="col-12 col-xl-4"><PageCard title="Readiness operacional"><ListGroup variant="flush"><ListGroup.Item className="d-flex justify-content-between px-0"><span>Worker</span><Badge bg={workerResource.data.worker.heartbeatStale ? "warning" : "success"}>{workerResource.data.worker.heartbeatStale ? "heartbeat stale" : "heartbeat ok"}</Badge></ListGroup.Item><ListGroup.Item className="d-flex justify-content-between px-0"><span>Redis</span><Badge bg={workerResource.data.redis.status === "error" ? "danger" : workerResource.data.redis.status === "unknown" ? "warning" : "success"}>{workerResource.data.redis.status}</Badge></ListGroup.Item><ListGroup.Item className="d-flex justify-content-between px-0"><span>Readiness</span><Badge bg={workerResource.data.readiness === "ready" ? "success" : "warning"}>{workerResource.data.readiness}</Badge></ListGroup.Item></ListGroup></PageCard></div><div className="col-12 col-xl-8"><PageCard title="Colas"><DataTable rows={workerResource.data.queues} getRowKey={(row) => row.name} columns={[{ key: "name", header: "Cola", render: (row) => row.name }, { key: "waiting", header: "Waiting", render: (row) => row.waiting }, { key: "active", header: "Active", render: (row) => row.active }, { key: "delayed", header: "Delayed", render: (row) => row.delayed }, { key: "failed", header: "Failed", render: (row) => row.failed }, { key: "oldest", header: "Oldest job age", render: (row) => `${row.oldestJobAgeSeconds}s` }]} /></PageCard></div></>
        ) : null}
      </div>
    </PageShell>
  );
}
