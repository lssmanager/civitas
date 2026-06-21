import { Badge, ListGroup } from "react-bootstrap";
import { useOwnerApi } from "../api/owner";
import { useStableResource } from "../shared/hooks/useStableResource";
import { DataTable, ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

export function OwnerSystemPage() {
  const ownerApi = useOwnerApi();
  const resource = useStableResource({ load: ownerApi.getWorkerHealth, getKey: () => "owner-worker-health", initialParams: undefined });

  return (
    <PageShell eyebrow="Owner / técnico" title="Salud técnica de sincronización" description="Vista interna para soporte técnico: muestra señales crudas del worker, Redis y colas separadas del resumen funcional.">
      {resource.isLoading ? <LoadingState title="Cargando salud técnica" description="Consultando señales internas de worker y cola." /> : null}
      {resource.error ? <ErrorState title="No se pudo cargar worker health" message={resource.error} /> : null}
      {resource.data ? (
        <div className="row g-4">
          <div className="col-12 col-xl-4"><PageCard title="Readiness"><ListGroup variant="flush"><ListGroup.Item className="d-flex justify-content-between px-0"><span>Worker</span><Badge bg={resource.data.worker.heartbeatStale ? "warning" : "success"}>{resource.data.worker.heartbeatStale ? "heartbeat stale" : "heartbeat ok"}</Badge></ListGroup.Item><ListGroup.Item className="d-flex justify-content-between px-0"><span>Redis</span><Badge bg={resource.data.redis.status === "error" ? "danger" : "secondary"}>{resource.data.redis.status}</Badge></ListGroup.Item><ListGroup.Item className="d-flex justify-content-between px-0"><span>Readiness</span><Badge bg={resource.data.readiness === "ready" ? "success" : "warning"}>{resource.data.readiness}</Badge></ListGroup.Item></ListGroup></PageCard></div>
          <div className="col-12 col-xl-8"><PageCard title="Colas"><DataTable rows={resource.data.queues} getRowKey={(row) => row.name} columns={[{ key: "name", header: "Cola", render: (row) => row.name }, { key: "waiting", header: "Waiting", render: (row) => row.waiting }, { key: "active", header: "Active", render: (row) => row.active }, { key: "delayed", header: "Delayed", render: (row) => row.delayed }, { key: "failed", header: "Failed", render: (row) => row.failed }, { key: "oldest", header: "Oldest job age", render: (row) => `${row.oldestJobAgeSeconds}s` }]} /></PageCard></div>
        </div>
      ) : null}
    </PageShell>
  );
}
