import { Badge, Button, ListGroup } from "react-bootstrap";
import { useOwnerApi, type OwnerIntegrationHealthCheck, type OwnerWorkerHealth } from "../api/owner";
import { useStableResource } from "../shared/hooks/useStableResource";
import { DataTable, ErrorState, LoadingState, MetricCard, PageCard, PageShell, StatusBadge } from "../shared/ui";

const badgeVariant = (check: OwnerIntegrationHealthCheck) =>
  check.severity === "success" ? "success" : check.severity === "danger" ? "danger" : check.severity === "secondary" ? "secondary" : "warning";

const toStatusTone = (status: string) => {
  if (["ok", "ready"].includes(status)) return "success" as const;
  if (["error", "degraded"].includes(status)) return "danger" as const;
  if (["unknown", "attention", "pending_integration"].includes(status)) return "warning" as const;
  return "neutral" as const;
};

const toMetricTone = (status: string) => {
  if (["ok", "ready"].includes(status)) return "success" as const;
  if (["error", "degraded"].includes(status)) return "danger" as const;
  return "warning" as const;
};

const formatCheckedAt = (value?: string) => (value ? new Date(value).toLocaleString() : "Sin dato");

function buildKpis(checks: OwnerIntegrationHealthCheck[], workerHealth: OwnerWorkerHealth) {
  const requiredChecks = checks.filter((check) => check.required !== false);
  const requiredHealthy = requiredChecks.filter((check) => check.status === "ok").length;
  const requiredAttention = requiredChecks.filter((check) => check.status !== "ok").length;
  const optionalPending = checks.filter((check) => check.required === false && check.status !== "ok").length;
  const backlog = workerHealth.queues.reduce((sum, queue) => sum + queue.waiting + queue.active + queue.delayed, 0);
  const failedJobs = workerHealth.queues.reduce((sum, queue) => sum + queue.failed, 0);

  return {
    requiredHealthy,
    requiredTotal: requiredChecks.length,
    requiredAttention,
    optionalPending,
    backlog,
    failedJobs,
  };
}

function buildOperationalRows(workerHealth: OwnerWorkerHealth) {
  return [
    {
      label: "Worker",
      value: workerHealth.worker.heartbeatStale ? "Heartbeat stale" : "Heartbeat ok",
      tone: workerHealth.worker.heartbeatStale ? "warning" : "success",
      detail: workerHealth.worker.heartbeatAt ? `Último heartbeat: ${formatCheckedAt(workerHealth.worker.heartbeatAt)}` : "Sin heartbeat reportado",
    },
    {
      label: "Redis",
      value: workerHealth.redis.status,
      tone: toStatusTone(workerHealth.redis.status),
      detail:
        "latencyMs" in workerHealth.redis && typeof workerHealth.redis.latencyMs === "number"
          ? `Latencia: ${workerHealth.redis.latencyMs} ms`
          : workerHealth.redis.message || "Sin métrica adicional",
    },
    {
      label: "Readiness",
      value: workerHealth.readiness,
      tone: toStatusTone(workerHealth.readiness),
      detail: "Estado consolidado del worker y su conectividad con la cola operacional.",
    },
  ];
}

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
  const kpis = workerHealth && integrationsHealth ? buildKpis(integrationsHealth.checks, workerHealth) : null;
  const operationalRows = workerHealth ? buildOperationalRows(workerHealth) : [];

  return (
    <PageShell
      eyebrow="Owner / sistema"
      title="Dashboard operativo"
      description="Vista ejecutiva para revisar conectividad, colas y readiness de las integraciones críticas de Civitas."
      actions={
        <>
          <Button size="sm" variant="outline-primary" onClick={integrationsResource.retry}>
            Verificar CRM
          </Button>
          <Button size="sm" variant="outline-secondary" onClick={retryAll}>
            Actualizar panel
          </Button>
        </>
      }
    >
      {workerResource.isLoading || integrationsResource.isLoading ? <LoadingState title="Cargando dashboard operativo" description="Consultando integraciones, cola y worker." /> : null}
      {workerResource.error ? <ErrorState title="No se pudo cargar worker health" message={workerResource.error} action={<Button onClick={workerResource.retry}>Reintentar worker</Button>} /> : null}
      {integrationsResource.error ? <ErrorState title="No se pudieron cargar integraciones" message={integrationsResource.error} action={<Button onClick={integrationsResource.retry}>Reintentar integraciones</Button>} /> : null}

      {kpis && integrationsHealth ? (
        <div className="row g-3">
          <div className="col-12 col-md-6 col-xl-3">
            <MetricCard label="Integraciones requeridas" value={`${kpis.requiredHealthy}/${kpis.requiredTotal}`} hint={`Última revisión: ${formatCheckedAt(integrationsHealth.checkedAt)}`} tone={toMetricTone(integrationsHealth.status)} />
          </div>
          <div className="col-12 col-md-6 col-xl-3">
            <MetricCard label="Checks con atención" value={kpis.requiredAttention} hint="Incluye errores y estados sin confirmación operativa." tone={kpis.requiredAttention === 0 ? "success" : "warning"} />
          </div>
          <div className="col-12 col-md-6 col-xl-3">
            <MetricCard label="Backlog de colas" value={kpis.backlog} hint={`${kpis.failedJobs} trabajos fallidos visibles`} tone={kpis.backlog === 0 && kpis.failedJobs === 0 ? "success" : "warning"} />
          </div>
          <div className="col-12 col-md-6 col-xl-3">
            <MetricCard label="Integraciones futuras" value={kpis.optionalPending} hint="Checks opcionales o aún no activados." tone={kpis.optionalPending === 0 ? "success" : "primary"} />
          </div>
        </div>
      ) : null}

      <div className="row g-4">
        {workerHealth ? (
          <>
            <div className="col-12 col-xl-4">
              <PageCard title="Estado operativo" subtitle="Resumen corto para saber si el sistema está listo para procesar trabajo.">
                <div className="d-flex flex-column gap-3">
                  {operationalRows.map((row) => (
                    <div key={row.label} className="border rounded-3 p-3">
                      <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
                        <div>
                          <div className="fw-semibold">{row.label}</div>
                          <div className="small text-secondary">{row.detail}</div>
                        </div>
                        <StatusBadge tone={row.tone}>{row.value}</StatusBadge>
                      </div>
                    </div>
                  ))}
                </div>
              </PageCard>
            </div>
            <div className="col-12 col-xl-8">
              <PageCard title="Colas activas" subtitle="Métricas en tiempo real para la operación del worker y la propagación downstream.">
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

        {integrationsHealth ? (
          <div className="col-12">
            <PageCard
              title="Mapa de integraciones"
              subtitle={`Estado general: ${integrationsHealth.status}. Última revisión: ${formatCheckedAt(integrationsHealth.checkedAt)}.`}
            >
              <div className="row g-3">
                {integrationsHealth.checks.map((check) => (
                  <div className="col-12 col-lg-6 col-xxl-4" key={check.key}>
                    <div className="border rounded-3 p-3 h-100 d-flex flex-column gap-3">
                      <div className="d-flex justify-content-between align-items-start gap-3">
                        <div>
                          <h3 className="h6 mb-1">{check.label}</h3>
                          <div className="small text-secondary">
                            {check.system}
                            {check.required === false ? " · opcional/futuro" : " · requerido"}
                          </div>
                        </div>
                        <Badge bg={badgeVariant(check)}>{check.status}</Badge>
                      </div>
                      <p className="small mb-0">{check.message}</p>
                      {check.nextAction ? <div className="small text-secondary">Siguiente paso: {check.nextAction}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </PageCard>
          </div>
        ) : null}

        {workerHealth ? (
          <div className="col-12">
            <PageCard title="Lectura rápida para owner" subtitle="Señales resumidas para decidir si hay que intervenir o solo observar.">
              <ListGroup variant="flush">
                <ListGroup.Item className="px-0 d-flex justify-content-between gap-3">
                  <span>Readiness general</span>
                  <StatusBadge tone={toStatusTone(workerHealth.readiness)}>{workerHealth.readiness}</StatusBadge>
                </ListGroup.Item>
                <ListGroup.Item className="px-0 d-flex justify-content-between gap-3">
                  <span>Redis / BullMQ</span>
                  <StatusBadge tone={toStatusTone(workerHealth.redis.status)}>{workerHealth.redis.status}</StatusBadge>
                </ListGroup.Item>
                <ListGroup.Item className="px-0 d-flex justify-content-between gap-3">
                  <span>Heartbeat del worker</span>
                  <StatusBadge tone={workerHealth.worker.heartbeatStale ? "warning" : "success"}>{workerHealth.worker.heartbeatStale ? "stale" : "ok"}</StatusBadge>
                </ListGroup.Item>
              </ListGroup>
            </PageCard>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
