import { Badge, Button, ListGroup } from "react-bootstrap";
import { useOwnerApi, type OwnerIntegrationHealthCheck } from "../api/owner";
import { useStableResource } from "../shared/hooks/useStableResource";
import { DataTable, ErrorState, LoadingState, PageCard, PageShell, StatusBadge } from "../shared/ui";

const badgeVariant = (check: OwnerIntegrationHealthCheck) =>
  check.severity === "success" ? "success" : check.severity === "danger" ? "danger" : check.severity === "secondary" ? "secondary" : "warning";

const statusTone = (status: string) => {
  if (["ok", "ready"].includes(status)) return "success" as const;
  if (["error", "degraded"].includes(status)) return "danger" as const;
  if (["unknown", "attention", "pending_integration", "not_configured"].includes(status)) return "warning" as const;
  return "neutral" as const;
};

const formatCheckedAt = (value?: string) => (value ? new Date(value).toLocaleString() : "Sin dato");

const buildGeneralStatus = (status?: string) => {
  if (status === "ok") return "ok";
  if (status === "degraded") return "degraded";
  if (status === "attention") return "attention";
  return "unknown";
};

export function OwnerSystemPage() {
  const ownerApi = useOwnerApi();
  const workerResource = useStableResource({ load: ownerApi.getWorkerHealth, getKey: () => "owner-worker-health", initialParams: undefined });
  const integrationsResource = useStableResource({ load: ownerApi.getIntegrationsHealth, getKey: () => "owner-integrations-health", initialParams: undefined });
  const retryAll = () => {
    workerResource.retry();
    integrationsResource.retry();
  };

  const workerHealth = workerResource.data;
  const integrationsHealth = integrationsResource.data;
  const generalStatus = buildGeneralStatus(integrationsHealth?.status);

  return (
    <PageShell
      eyebrow="Owner / sistema"
      title="Salud técnica e integraciones"
      description="Checks permanentes para Logto, Redis/BullMQ, FluentCRM, WordPress y el camino preparado para Moodle. Estos checks viven fuera del wizard de crear organización."
      actions={
        <>
          <Button size="sm" variant="outline-primary" onClick={integrationsResource.retry}>
            Verificar conexión CRM
          </Button>
          <Button size="sm" variant="outline-secondary" onClick={retryAll}>
            Revisar todo
          </Button>
        </>
      }
      className="owner-system-page"
    >
      {workerResource.isLoading || integrationsResource.isLoading ? <LoadingState title="Cargando salud técnica" description="Consultando worker, colas e integraciones." /> : null}
      {workerResource.error ? <ErrorState title="No se pudo cargar worker health" message={workerResource.error} action={<Button onClick={workerResource.retry}>Reintentar worker</Button>} /> : null}
      {integrationsResource.error ? <ErrorState title="No se pudieron cargar integraciones" message={integrationsResource.error} action={<Button onClick={integrationsResource.retry}>Reintentar integraciones</Button>} /> : null}

      <div className="row g-4 owner-system-page__grid">
        {integrationsHealth ? (
          <div className="col-12">
            <PageCard
              title="Checks permanentes de integración"
              subtitle={`Estado general: ${generalStatus}. Última revisión: ${formatCheckedAt(integrationsHealth.checkedAt)}.`}
              className="owner-system-page__hero-card"
            >
              <div className="row g-3">
                {integrationsHealth.checks.map((check) => (
                  <div className="col-12 col-xl-6" key={check.key}>
                    <div className="owner-system-page__check-card h-100">
                      <div className="d-flex justify-content-between gap-3 align-items-start">
                        <div>
                          <h3 className="h6 mb-1">{check.label}</h3>
                          <div className="small text-secondary">
                            {check.system}
                            {check.required === false ? " · opcional/futuro" : " · requerido"}
                          </div>
                        </div>
                        <Badge bg={badgeVariant(check)} className="text-lowercase owner-system-page__status-pill">
                          {check.status}
                        </Badge>
                      </div>

                      <p className="small mb-0 mt-3">{check.message}</p>
                      {check.nextAction ? <div className="small text-secondary mt-3">Acción: {check.nextAction}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </PageCard>
          </div>
        ) : null}

        {workerHealth ? (
          <>
            <div className="col-12 col-xl-4">
              <PageCard title="Readiness operacional" className="owner-system-page__compact-card owner-system-page__readiness-card">
                <ListGroup variant="flush" className="owner-system-page__readiness-list">
                  <ListGroup.Item className="d-flex justify-content-between px-0 align-items-center">
                    <span>Worker</span>
                    <StatusBadge tone={workerHealth.worker.heartbeatStale ? "warning" : "success"}>
                      {workerHealth.worker.heartbeatStale ? "heartbeat stale" : "heartbeat ok"}
                    </StatusBadge>
                  </ListGroup.Item>
                  <ListGroup.Item className="d-flex justify-content-between px-0 align-items-center">
                    <span>Redis</span>
                    <StatusBadge tone={statusTone(workerHealth.redis.status)}>{workerHealth.redis.status}</StatusBadge>
                  </ListGroup.Item>
                  <ListGroup.Item className="d-flex justify-content-between px-0 align-items-center">
                    <span>Readiness</span>
                    <StatusBadge tone={statusTone(workerHealth.readiness)}>{workerHealth.readiness}</StatusBadge>
                  </ListGroup.Item>
                </ListGroup>
              </PageCard>
            </div>

            <div className="col-12 col-xl-8">
              <PageCard title="Colas" className="owner-system-page__compact-card owner-system-page__queue-card">
                <DataTable
                  rows={workerHealth.queues}
                  getRowKey={(row) => row.name}
                  columns={[
                    { key: "name", header: "Cola", render: (row) => row.name },
                    { key: "waiting", header: "Waiting", render: (row) => row.waiting },
                    { key: "active", header: "Active", render: (row) => row.active },
                    { key: "delayed", header: "Delayed", render: (row) => row.delayed },
                    { key: "failed", header: "Failed", render: (row) => row.failed },
                    { key: "oldest", header: "Oldest job age", render: (row) => `${row.oldestJobAgeSeconds}s` },
                  ]}
                />
              </PageCard>
            </div>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
