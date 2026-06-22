import "./OwnerSystemPage.css";

import { useEffect, useState } from "react";
import { Alert, Button } from "react-bootstrap";
import {
  useOwnerApi,
  type OwnerIntegrationHealthCheck,
  type OwnerSystemMetric,
  type OwnerWorkerHealth,
} from "../api/owner";
import { useAuthorization } from "../authz/useAuthorization";
import { useStableResource } from "../shared/hooks/useStableResource";
import { DataTable, ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

const actionLabels: Array<{ action: OwnerReconciliationAction; label: string }> = [
  { action: "approve_link", label: "Approve link" },
  { action: "reject_link", label: "Reject link" },
  { action: "create_local_profile", label: "Create local profile" },
  { action: "create_logto_organization", label: "Create Logto organization" },
  { action: "archive_local_profile", label: "Archive local profile" },
  { action: "merge_profiles", label: "Merge profiles" },
  { action: "mark_legacy", label: "Mark as legacy" },
  { action: "ignore", label: "Ignore" },
  { action: "retry", label: "Retry worker task" },
];

const taskBadgeVariant = (task: OwnerReconciliationTask) => {
  if (task.status === "failed" || task.severity === "critical") return "danger";
  if (task.requiresHuman || task.status === "hitl_required") return "warning";
  if (task.status === "resolved" || task.status === "completed") return "success";
  return "secondary";
};

export function OwnerSystemPage() {
  const ownerApi = useOwnerApi();
  const { canExecute } = useAuthorization();
  const canRefreshSystem = canExecute("owner.system.refresh");
  const [integrationsEnabled, setIntegrationsEnabled] = useState(false);
  const [metricsEnabled, setMetricsEnabled] = useState(false);
  const workerResource = useStableResource({
    load: ownerApi.getWorkerHealth,
    getKey: () => "owner-worker-health",
    initialParams: undefined,
  });
  const reconciliation = useStableResource({ load: ownerApi.getReconciliationTasks, getKey: () => "owner-reconciliation-tasks", initialParams: undefined });

  const resolveTask = async (taskId: string, action: OwnerReconciliationAction) => {
    await ownerApi.resolveReconciliationTask(taskId, action, `Acción ${action} ejecutada desde Owner / system.`);
    reconciliation.retry();
  };
  const integrationsResource = useStableResource({
    load: ownerApi.getIntegrationsHealth,
    getKey: () => "owner-integrations-health",
    initialParams: undefined,
    enabled: integrationsEnabled,
  });
  const metricsResource = useStableResource({
    load: ownerApi.getSystemMetrics,
    getKey: () => "owner-system-metrics",
    initialParams: undefined,
    enabled: metricsEnabled,
  });

  const secondaryResourcesAreLoading =
    integrationsResource.isLoading || metricsResource.isLoading;
  const refreshAllIsDisabled =
    !canRefreshSystem || workerResource.isLoading || secondaryResourcesAreLoading;

  useEffect(() => {
    if (
      workerResource.isLoading ||
      workerResource.error ||
      !workerResource.data
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIntegrationsEnabled(true);
    }, SECONDARY_RESOURCE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [workerResource.data, workerResource.error, workerResource.isLoading]);

  useEffect(() => {
    if (!integrationsEnabled || integrationsResource.isLoading) {
      return;
    }

    if (integrationsResource.data || integrationsResource.error) {
      setMetricsEnabled(true);
    }
  }, [
    integrationsEnabled,
    integrationsResource.data,
    integrationsResource.error,
    integrationsResource.isLoading,
  ]);

  const retryAll = () => {
    if (refreshAllIsDisabled) {
      return;
    }

    setIntegrationsEnabled(false);
    setMetricsEnabled(false);
    workerResource.retry();
  };

  const retryIntegrations = () => {
    if (!canRefreshSystem || integrationsResource.isLoading) {
      return;
    }

    setIntegrationsEnabled(true);
    integrationsResource.retry();
  };

  const retryMetrics = () => {
    if (!canRefreshSystem || metricsResource.isLoading) {
      return;
    }

    setMetricsEnabled(true);
    metricsResource.retry();
  };

  const workerHealth = workerResource.data;
  const integrationsHealth = integrationsResource.data;
  const systemMetrics = metricsResource.data;
  const requiredChecks =
    integrationsHealth?.checks.filter((check) => check.required !== false)
      .length ?? 0;
  const okRequiredChecks =
    integrationsHealth?.checks.filter(
      (check) =>
        check.required !== false &&
        ["ok", "ready", "configured"].includes(check.status),
    ).length ?? 0;
  const generalStatus = buildGeneralStatus(
    integrationsHealth?.status,
    workerHealth?.readiness,
  );
  const totals = queueTotals(workerHealth);
  const redisOk = workerHealth?.redis.status === "ok";
  const lastReview = formatCheckedAt(
    integrationsHealth?.checkedAt ?? workerHealth?.worker.heartbeatAt,
  );

  return (
    <PageShell eyebrow="Owner / técnico" title="Salud técnica y reconciliación" description="Vista interna para soporte técnico: worker, Redis, colas y tareas HITL de reconciliación Logto ↔ Civitas.">
      {resource.isLoading ? <LoadingState title="Cargando salud técnica" description="Consultando señales internas de worker y cola." /> : null}
      {resource.error ? <ErrorState title="No se pudo cargar worker health" message={resource.error} /> : null}
      {resource.data ? (
        <div className="row g-4 mb-4">
          <div className="col-12 col-xl-4"><PageCard title="Readiness"><ListGroup variant="flush"><ListGroup.Item className="d-flex justify-content-between px-0"><span>Worker</span><Badge bg={resource.data.worker.heartbeatStale ? "warning" : "success"}>{resource.data.worker.heartbeatStale ? "heartbeat stale" : "heartbeat ok"}</Badge></ListGroup.Item><ListGroup.Item className="d-flex justify-content-between px-0"><span>Redis</span><Badge bg={resource.data.redis.status === "error" ? "danger" : "secondary"}>{resource.data.redis.status}</Badge></ListGroup.Item><ListGroup.Item className="d-flex justify-content-between px-0"><span>Readiness</span><Badge bg={resource.data.readiness === "ready" ? "success" : "warning"}>{resource.data.readiness}</Badge></ListGroup.Item></ListGroup></PageCard></div>
          <div className="col-12 col-xl-8"><PageCard title="Colas"><DataTable rows={resource.data.queues} getRowKey={(row) => row.name} columns={[{ key: "name", header: "Cola", render: (row) => row.name }, { key: "waiting", header: "Waiting", render: (row) => row.waiting }, { key: "active", header: "Active", render: (row) => row.active }, { key: "delayed", header: "Delayed", render: (row) => row.delayed }, { key: "failed", header: "Failed", render: (row) => row.failed }, { key: "oldest", header: "Oldest job age", render: (row) => `${row.oldestJobAgeSeconds}s` }]} /></PageCard></div>
        </div>
      ) : null}

      <PageCard title="Tareas HITL de reconciliación" subtitle="Cada discrepancia detectada por GET /organizations se materializa como tarea idempotente con evidencia, acción sugerida y auditoría de resolución.">
        {reconciliation.isLoading ? <LoadingState title="Cargando tareas" description="Consultando discrepancias operativas." /> : null}
        {reconciliation.error ? <ErrorState title="No se pudieron cargar tareas" message={reconciliation.error} action={<Button onClick={reconciliation.retry}>Reintentar</Button>} /> : null}
        {reconciliation.data ? (
          <DataTable rows={reconciliation.data.tasks} getRowKey={(row) => row.id} columns={[
            { key: "type", header: "Tipo", render: (row) => <div><strong>{row.type}</strong><div className="small text-muted">{row.dedupeKey}</div></div> },
            { key: "status", header: "Estado", render: (row) => <Badge bg={taskBadgeVariant(row)}>{row.status}</Badge> },
            { key: "entities", header: "Entidades", render: (row) => <span className="small">Logto: {row.logtoOrganizationId || "—"}<br />Profile: {row.profileId || "—"}</span> },
            { key: "evidence", header: "Evidencia", render: (row) => {
              const evidence = JSON.stringify(row.evidence);
              return <code className="small text-break">{evidence.slice(0, 260)}{evidence.length > 260 ? "…" : ""}</code>;
            } },
            { key: "action", header: "Acción sugerida", render: (row) => row.suggestedAction || "—" },
            { key: "buttons", header: "Resolución", render: (row) => <div className="d-flex flex-wrap gap-1">{actionLabels.map((item) => <Button key={item.action} size="sm" variant={item.action === "ignore" ? "outline-secondary" : "outline-primary"} onClick={() => void resolveTask(row.id, item.action)}>{item.label}</Button>)}</div> },
          ]} />
        ) : null}
      </PageCard>
    </PageShell>
  );
}
