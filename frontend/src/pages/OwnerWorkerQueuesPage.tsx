import { Alert, Badge, Button } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useOwnerApi, type OwnerWorkerQueueBlockedOrganization, type OwnerWorkerQueueOperation, type OwnerWorkerQueueTimelineEvent, type OwnerWorkerQueuesObservabilityResponse } from "../api/owner";
import type { OperationalAction, OperationalBlock } from "../contracts/operational";
import { useAuthorization } from "../authz/useAuthorization";
import { useWorkerQueuesObservability } from "../hooks/useWorkerQueuesObservability";
import { DataTable, EmptyState, ErrorState, KpiGrid, LoadingState, MetricCard, PageShell, PageCard } from "../shared/ui";

const actionLabel: Record<string, string> = { retry: "Reintentar", verify_provider: "Verificar proveedor", open_organization: "Abrir organización", manual_retry_required: "Reintento manual", human_action_required: "Acción humana", none: "Sin acción" };
const statusVariant = (value?: string | null) => ["alive", "ok", "ready", "completed", "success"].includes(value ?? "") ? "success" : ["worker_offline", "failed", "critical", "error", "stuck_in_queue"].includes(value ?? "") ? "danger" : ["worker_heartbeat_stale", "backlog_growing", "warning", "queued", "running", "db_poll_fallback"].includes(value ?? "") ? "warning" : "secondary";
const severityTone = (severity?: string | null): "primary" | "success" | "warning" | "danger" => severity === "success" ? "success" : severity === "critical" ? "danger" : severity === "warning" ? "warning" : "primary";
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : "Sin dato";
const formatSeconds = (value?: number | null) => typeof value === "number" ? value > 60 ? `${Math.round(value / 60)}m` : `${value}s` : "Sin dato";
const sourceLabel = (source?: string | null) => source || "sin fuente";

function FreshnessBadges({ block }: { block: OperationalBlock }) {
  return <div className="d-flex flex-wrap gap-1"><Badge bg={block.freshness?.isStale ? "warning" : "success"} text={block.freshness?.isStale ? "dark" : undefined}>{block.freshness?.isStale ? "stale" : "fresh"}</Badge><Badge bg="secondary">{sourceLabel(block.freshness?.source)}</Badge><Badge bg="light" text="dark">checked {formatDate(block.freshness?.checkedAt)}</Badge></div>;
}

function ActionButtons({ actions, organizationId }: { actions?: OperationalAction[]; organizationId?: string | null }) {
  const uniqueActions = [...new Set(actions ?? [])].filter((action) => action && action !== "none");
  if (uniqueActions.length === 0) return <span className="text-secondary small">Sin acción modelada</span>;
  return <div className="d-flex flex-wrap gap-1">{uniqueActions.map((action) => action === "open_organization" && organizationId ? <Link className="btn btn-outline-primary btn-sm" key={String(action)} to={`/owner/organizations/${encodeURIComponent(organizationId)}`}>{actionLabel[String(action)]}</Link> : <Button key={String(action)} size="sm" variant="outline-secondary" disabled>{actionLabel[String(action)] ?? action}</Button>)}</div>;
}

function RuntimeSourceLegend() {
  return <Alert variant="secondary" className="mb-0">Fuentes runtime explícitas: <Badge bg="success">bullmq</Badge> <Badge bg="warning" text="dark">db_poll_fallback</Badge> <Badge bg="danger">worker_offline</Badge> <Badge bg="warning" text="dark">worker_heartbeat_stale</Badge> <Badge bg="danger">stuck_in_queue</Badge></Alert>;
}

function GlobalHealthCards({ data }: { data: OwnerWorkerQueuesObservabilityResponse }) {
  const health = data.workerHealth;
  return <section><KpiGrid><MetricCard label="Readiness" value={health.readiness} hint={health.humanMessage ?? "Estado agregado del worker"} tone={severityTone(health.severity)} /><MetricCard label="Heartbeat state" value={health.heartbeat?.state ?? health.providerStatus ?? "unknown"} hint={`source: ${String(health.details?.source ?? "sin fuente")}`} tone={severityTone(health.severity)} /><MetricCard label="Freshness" value={health.freshness?.isStale ? "stale" : "fresh"} hint={`checked: ${formatDate(health.freshness?.checkedAt)}`} tone={health.freshness?.isStale ? "warning" : "success"} /><MetricCard label="Suggested action" value={actionLabel[String(health.nextAction)] ?? health.nextAction} hint={`redis: ${String(health.providerCode ?? "sin dato")}`} tone={severityTone(health.severity)} /></KpiGrid><Alert variant={statusVariant(health.classification)} className="mt-3 mb-0"><strong>{health.classification}</strong> · worker source: {String(health.details?.source ?? "sin fuente")} · {health.humanMessage}</Alert></section>;
}

function QueueTable({ data }: { data: OwnerWorkerQueuesObservabilityResponse }) {
  return <PageCard title="Colas" subtitle="Clasificación entregada por el agregado backend; no se recalcula en frontend."><DataTable rows={data.queues} getRowKey={(row) => row.name} emptyTitle="Sin colas" emptyDescription="El agregado no reportó colas en esta lectura." columns={[{ key: "name", header: "Cola", render: (row) => <strong>{row.name}</strong> }, { key: "waiting", header: "Waiting", render: (row) => row.waiting }, { key: "active", header: "Active", render: (row) => row.active }, { key: "delayed", header: "Delayed", render: (row) => row.delayed }, { key: "failed", header: "Failed", render: (row) => row.failed }, { key: "oldest", header: "Oldest job", render: (row) => formatSeconds(row.oldestJobAgeSeconds) }, { key: "classification", header: "Estado clasificado", render: (row) => <Badge bg={statusVariant(row.classification)}>{row.classification}</Badge> }, { key: "freshness", header: "Freshness", render: (row) => <FreshnessBadges block={row} /> }]} /></PageCard>;
}

function OperationsTable({ operations }: { operations: OwnerWorkerQueueOperation[] }) {
  return <PageCard title="Operaciones activas o problemáticas" subtitle="Operaciones del agregado worker-queues con acciones del catálogo operacional estándar."><DataTable rows={operations} getRowKey={(row) => row.operationId} emptyTitle="Sin operaciones activas" emptyDescription="No hay operaciones activas ni recientemente problemáticas." columns={[{ key: "org", header: "Organización", render: (row) => row.organizationId ? <Link to={`/owner/organizations/${encodeURIComponent(row.organizationId)}`}>{row.organizationName || row.organizationId}</Link> : row.organizationName || "Sin organización" }, { key: "type", header: "Operación", render: (row) => <div><strong>{row.operationType}</strong><br /><span className="text-secondary small">{row.entityType}</span></div> }, { key: "step", header: "Step", render: (row) => row.stepName || "Sin step" }, { key: "queue", header: "Queue state", render: (row) => <div><Badge bg={statusVariant(row.retryState)}>{row.retryState}</Badge><br /><span className="small text-secondary">{row.queueName || "sin cola"}</span></div> }, { key: "worker", header: "Worker", render: (row) => <div><Badge bg={statusVariant(row.workerHeartbeatState)}>{row.workerHeartbeatState}</Badge><br /><span className="small text-secondary">{sourceLabel(row.freshness?.source)}</span></div> }, { key: "age", header: "Job age", render: (row) => formatSeconds(row.jobAgeSeconds) }, { key: "provider", header: "Provider", render: (row) => <div>{row.providerCode || "Sin código"}<br /><span className="small text-secondary">{String(row.providerStatus ?? "sin status")}</span></div> }, { key: "message", header: "Mensaje", render: (row) => row.humanMessage || row.status }, { key: "actions", header: "Acciones", render: (row) => <ActionButtons actions={[row.nextAction, ...(row.availableActions ?? [])]} organizationId={row.organizationId} /> }]} /></PageCard>;
}

function BlockedOrganizationsPanel({ rows }: { rows: OwnerWorkerQueueBlockedOrganization[] }) {
  if (rows.length === 0) return <PageCard title="Organizaciones bloqueadas" subtitle="Bloqueos operacionales del agregado worker-queues."><EmptyState title="Sin organizaciones bloqueadas" description="No hay blockers globales en esta lectura." /></PageCard>;
  return <PageCard title="Organizaciones bloqueadas" subtitle="Causas como missing company, contacts not started, worker offline, stuck queue o awaiting WordPress login."><div className="row g-3">{rows.map((row) => <div className="col-12 col-xl-6" key={row.logtoOrganizationId ?? row.name ?? row.blocker}><div className="border rounded p-3 h-100"><div className="d-flex justify-content-between gap-2"><h3 className="h6 mb-1">{row.name || row.logtoOrganizationId || "Organización sin nombre"}</h3><Badge bg={statusVariant(row.severity)}>{row.severity}</Badge></div><p className="mb-2"><strong>{row.blocker}</strong> · {row.humanMessage}</p><FreshnessBadges block={row} /><div className="mt-3"><ActionButtons actions={[row.nextAction, ...(row.availableActions ?? []), "open_organization"]} organizationId={row.logtoOrganizationId} /></div></div></div>)}</div></PageCard>;
}

function Timeline({ events }: { events: OwnerWorkerQueueTimelineEvent[] }) {
  return <PageCard title="Timeline operacional corto" subtitle="Vista rápida; no reemplaza /owner/logs."><DataTable rows={events.slice(0, 12)} getRowKey={(row) => row.id} emptyTitle="Sin eventos recientes" emptyDescription="El agregado no reportó timeline reciente." columns={[{ key: "at", header: "Cuándo", render: (row) => formatDate(row.at) }, { key: "type", header: "Tipo", render: (row) => <Badge bg={statusVariant(row.type)}>{row.type}</Badge> }, { key: "org", header: "Organización", render: (row) => row.organizationId ? <Link to={`/owner/organizations/${encodeURIComponent(row.organizationId)}`}>{row.organizationName || row.organizationId}</Link> : row.organizationName || "Global" }, { key: "step", header: "Step", render: (row) => row.stepName || row.operationId || "Sin step" }, { key: "status", header: "Status", render: (row) => <Badge bg={statusVariant(row.status)}>{row.status}</Badge> }, { key: "message", header: "Mensaje", render: (row) => row.humanMessage || row.providerCode || "Evento operacional" }]} /></PageCard>;
}

export function OwnerWorkerQueuesPage() {
  const ownerApi = useOwnerApi();
  const { canExecute } = useAuthorization();
  const canRefreshSystem = canExecute("owner.system.refresh");
  const resource = useWorkerQueuesObservability(ownerApi.getWorkerQueuesObservability);
  const data = resource.data;
  return <PageShell eyebrow="Owner global / Observabilidad" title="Worker y colas" description="Superficie operacional global basada exclusivamente en el agregado backend worker-queues." actions={<div className="d-flex gap-2"><Link className="btn btn-outline-secondary btn-sm" to="/owner/logs">Ver logs completos</Link><Button size="sm" onClick={resource.retry} disabled={!canRefreshSystem || resource.isLoading}>{canRefreshSystem ? "Refrescar agregado" : "Solo lectura"}</Button></div>}>
    {resource.isLoading && !data ? <LoadingState title="Cargando Worker y colas" description="Consultando /owner/system/worker-queues." /> : null}
    {resource.error ? <ErrorState title="No se pudo cargar Worker y colas" message={resource.error} action={<Button onClick={resource.retry} disabled={!canRefreshSystem}>Reintentar</Button>} /> : null}
    {data ? <div className="d-flex flex-column gap-4"><Alert variant={data.workerHealth.freshness?.isStale ? "warning" : "info"}>Agregado: {data.contractVersion} · source: {data.source.primary} · dominance: {data.source.dominance} · generado {formatDate(data.generatedAt)} · {resource.isAutoRefreshing ? "auto-refresh según freshness backend" : "refresh manual disponible"}</Alert><RuntimeSourceLegend /><GlobalHealthCards data={data} /><QueueTable data={data} /><OperationsTable operations={data.activeOperations} /><BlockedOrganizationsPanel rows={data.blockedOrganizations} /><Timeline events={data.timeline} /></div> : null}
  </PageShell>;
}
