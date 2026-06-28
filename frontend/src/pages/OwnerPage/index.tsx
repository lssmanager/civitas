import { Badge, ListGroup } from "react-bootstrap";
import { Link, useOutletContext } from "react-router-dom";
import { useOwnerApi } from "../../api/owner";
import { actionLabel, formatDateTime, severityVariant, sourceLabel, statusVariant } from "../../operational/backbone";
import {
  devOwnerMe,
  type OwnerAuthorizationContext,
} from "../../guards/ownerAuthorization";
import { useStableResource } from "../../shared/hooks/useStableResource";
import {
  DataTable,
  ErrorState,
  KeyValueList,
  LoadingState,
  MetricCard,
  PageCard,
  PageShell,
} from "../../shared/ui";

type OwnerDashboardProps = { ownerMe: OwnerAuthorizationContext };

function OwnerDashboard({ ownerMe }: OwnerDashboardProps) {
  const { owner } = ownerMe;
  const ownerApi = useOwnerApi();
  const summary = useStableResource({
    load: ownerApi.getWorkerQueuesObservability,
    getKey: () => "owner-operational-backbone",
    initialParams: undefined,
  });

  const metrics = summary.data
    ? [
        { label: "Operaciones activas", value: summary.data.activeOperations.length, hint: "worker runtime", tone: "primary" as const, to: "/owner/system/worker-queues" },
        { label: "Colas con backlog", value: summary.data.queues.filter((queue) => queue.waiting > 0 || queue.failed > 0 || queue.classification !== "alive").length, hint: "ver colas", tone: "warning" as const, to: "/owner/system/worker-queues" },
        { label: "Organizaciones bloqueadas", value: summary.data.blockedOrganizations.length, hint: "blocker principal", tone: "danger" as const, to: "/owner/logs?requiresAction=true" },
        { label: "Eventos recientes", value: summary.data.timeline.length, hint: "timeline operacional", tone: "success" as const, to: "/owner/logs" },
      ]
    : [];

  return (
    <PageShell
      eyebrow="Owner global"
      title="Resumen owner"
      description="Vista operativa del producto. Logto sigue siendo la fuente canónica para identidad, organizaciones, membresías, roles y permisos; Civitas resume propagación, pendientes y conflictos sin mezclar administración global con contexto tenant-scoped."
      actions={
        <>
          <Badge bg="success">owner:read</Badge>
          <Link className="btn btn-outline-secondary btn-sm" to="/owner/system">
            Vista técnica
          </Link>
        </>
      }
    >
      <div className="row g-4">
        <div className="col-12">
          {summary.isLoading ? (
            <LoadingState
              title="Cargando sincronización operativa"
              description="Consultando agregado worker-queues y contrato operacional consolidado."
            />
          ) : null}
          {summary.error ? (
            <ErrorState
              title="No se pudo cargar el resumen operativo"
              message={summary.error}
            />
          ) : null}
        </div>

        {summary.data ? (
          <>
            <div className="col-12">
              <PageCard className="civitas-dashboard-hero-card">
                <div className="civitas-dashboard-hero d-flex flex-column flex-xl-row justify-content-between gap-4">
                  <div className="civitas-dashboard-hero__copy d-flex flex-column gap-2">
                    <p className="civitas-dashboard-hero__eyebrow mb-0">
                      Backbone operacional owner
                    </p>
                    <h2 className="h3 mb-0">{summary.data.workerHealth.readiness}</h2>
                    <p className="mb-0 text-secondary">
                      {summary.data.workerHealth.humanMessage}
                    </p>
                  </div>
                  <div className="civitas-dashboard-hero__status d-flex flex-column align-items-xl-end gap-2">
                    <Badge bg={severityVariant(summary.data.workerHealth.severity)}>
                      {summary.data.workerHealth.classification}
                    </Badge>
                    <Link className="btn btn-outline-primary btn-sm" to="/owner/logs">
                      Ver timeline operativo
                    </Link>
                  </div>
                </div>
              </PageCard>
            </div>

            {metrics.map((item) => (
              <div className="col-6 col-xl-2" key={item.label}>
                <Link className="text-decoration-none text-reset d-block h-100" to={item.to} aria-label={`${item.label}: abrir logs filtrados`}>
                  <MetricCard label={item.label} value={item.value} hint={item.value === 0 ? `${item.hint} (sin resultados actuales)` : item.hint} tone={item.tone} />
                </Link>
              </div>
            ))}

            <div className="col-12 col-xl-5">
              <PageCard
                title="Incidentes funcionales recientes"
                subtitle="Errores legibles y accionables, sin stack traces ni payloads internos."
                actions={
                  <Link to="/owner/logs" className="btn btn-outline-secondary btn-sm">
                    Ver logs
                  </Link>
                }
              >
                {summary.data.timeline.length === 0 ? (
                  <p className="text-secondary mb-0">
                    No hay eventos operacionales recientes.
                  </p>
                ) : (
                  <ListGroup variant="flush" className="civitas-dashboard-list">
                    {summary.data.timeline.slice(0, 6).map((event) => (
                      <ListGroup.Item className="px-0" key={event.id}>
                        <div className="d-flex justify-content-between gap-3">
                          <strong>{event.organizationName ?? event.organizationId ?? "Global"}</strong>
                          <Badge bg={statusVariant(event.status)}>{event.type}</Badge>
                        </div>
                        <p className="text-secondary small mb-2">{event.humanMessage || event.providerCode || "Evento operacional"}</p>
                        <div className="d-flex flex-wrap gap-2 align-items-center">
                          <Badge bg="light" text="dark">source: {summary.data?.source.primary}</Badge>
                          <span className="small text-secondary">{formatDateTime(event.at)}</span>
                          {event.organizationId ? <Link className="btn btn-outline-primary btn-sm" to={`/owner/logs?organizationId=${encodeURIComponent(event.organizationId)}`}>Ver logs filtrados</Link> : null}
                        </div>
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                )}
              </PageCard>
            </div>

            <div className="col-12 col-xl-7">
              <PageCard
                title="Organizaciones con blocker principal"
                subtitle="Derivado del agregado worker-queues: blocker, freshness, provider status y nextAction estándar."
                actions={
                  <Link
                    to="/owner/organizations"
                    className="btn btn-outline-primary btn-sm"
                  >
                    Ver operaciones pendientes
                  </Link>
                }
              >
                <DataTable
                  rows={summary.data.blockedOrganizations}
                  getRowKey={(row) => row.logtoOrganizationId ?? row.blocker}
                  emptyTitle="Sin pendientes"
                  emptyDescription="Todas las organizaciones conocidas están completas o sin errores funcionales."
                  columns={[
                    { key: "name", header: "Organización", render: (row) => row.logtoOrganizationId ? <Link to={`/owner/organizations/${encodeURIComponent(row.logtoOrganizationId)}`}>{row.name ?? row.logtoOrganizationId}</Link> : row.name ?? "—" },
                    { key: "blocker", header: "Blocker", render: (row) => <Badge bg={severityVariant(row.severity)}>{row.blocker}</Badge> },
                    { key: "provider", header: "Proveedor", render: (row) => <div>{row.providerCode || "sin código"}<br /><span className="small text-secondary">{String(row.providerStatus ?? "sin status")}</span></div> },
                    { key: "freshness", header: "Freshness", render: (row) => <div className="d-flex flex-column gap-1"><Badge bg={row.freshness?.isStale ? "warning" : "success"} text={row.freshness?.isStale ? "dark" : undefined}>{row.freshness?.isStale ? "stale" : "fresh"}</Badge><span className="small text-secondary">{sourceLabel(row.freshness?.source)}</span></div> },
                    { key: "action", header: "Next action", render: (row) => row.logtoOrganizationId ? <Link className="btn btn-outline-primary btn-sm" to={`/owner/logs?organizationId=${encodeURIComponent(row.logtoOrganizationId)}`}>{actionLabel[String(row.nextAction)] ?? row.nextAction}</Link> : actionLabel[String(row.nextAction)] ?? row.nextAction },
                  ]}
                />
              </PageCard>
            </div>
          </>
        ) : null}

        <div className="col-12 col-xl-7">
          <PageCard
            title="Owner autorizado por Logto"
            subtitle="El owner global se determina por scopes globales y no por pertenencia tenant-scoped."
          >
            <KeyValueList
              items={[
                { label: "Internal user id", value: owner.internalUserId },
                { label: "Logto user id", value: owner.logtoUserId },
                { label: "Scope requerido", value: owner.requiredScope },
              ]}
            />
          </PageCard>
        </div>

        <div className="col-12 col-xl-5">
          <PageCard title="Accesos rápidos" subtitle="Entradas frecuentes para operación global owner.">
            <div className="civitas-quick-links d-flex flex-column gap-2">
              <Link to="/owner/organizations" className="btn btn-outline-primary text-start">
                Crear organización
              </Link>
              <Link to="/select-organization" className="btn btn-outline-secondary text-start">
                Select Organization
              </Link>
              <Link to="/owner/logs" className="btn btn-outline-secondary text-start">
                Logs y conflictos
              </Link>
              <Link to="/owner/settings" className="btn btn-outline-secondary text-start">
                Settings
              </Link>
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
