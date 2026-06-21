import { Badge, ListGroup } from "react-bootstrap";
import { Link, useOutletContext } from "react-router-dom";
import { useOwnerApi } from "../../api/owner";
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

const healthVariant = (severity?: string) =>
  severity === "success"
    ? "success"
    : severity === "critical"
      ? "danger"
      : "warning";

function OwnerDashboard({ ownerMe }: OwnerDashboardProps) {
  const { owner } = ownerMe;
  const ownerApi = useOwnerApi();
  const summary = useStableResource({
    load: ownerApi.getOperationsSummary,
    getKey: () => "owner-operations-summary",
    initialParams: undefined,
  });

  const metrics = summary.data
    ? [
        {
          label: "Pendientes",
          value: summary.data.counts.queued,
          hint: "colas por completar",
          tone: "warning" as const,
        },
        {
          label: "En ejecución",
          value: summary.data.counts.running,
          hint: "trabajos activos",
          tone: "primary" as const,
        },
        {
          label: "Fallos parciales",
          value: summary.data.counts.partialFailed,
          hint: "requieren revisión",
          tone: "warning" as const,
        },
        {
          label: "Fallidas",
          value: summary.data.counts.failed,
          hint: "bloqueos reales",
          tone: "danger" as const,
        },
        {
          label: "Reintentables",
          value: summary.data.counts.retryable,
          hint: "recuperables",
          tone: "success" as const,
        },
        {
          label: "Downstream pendiente",
          value: summary.data.counts.organizationsWithPendingDownstreamSync,
          hint: "integraciones incompletas",
          tone: "primary" as const,
        },
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
              description="Consultando estado persistido en Civitas y traducción funcional de salud técnica."
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
                      Salud funcional del owner
                    </p>
                    <h2 className="h3 mb-0">{summary.data.functionalHealth.status}</h2>
                    <p className="mb-0 text-secondary">
                      {summary.data.functionalHealth.message}
                    </p>
                  </div>
                  <div className="civitas-dashboard-hero__status d-flex flex-column align-items-xl-end gap-2">
                    <Badge bg={healthVariant(summary.data.functionalHealth.severity)}>
                      {summary.data.functionalHealth.code}
                    </Badge>
                    <Link className="btn btn-outline-primary btn-sm" to="/owner/logs">
                      Ver incidentes y trazabilidad
                    </Link>
                  </div>
                </div>
              </PageCard>
            </div>

            {metrics.map((item) => (
              <div className="col-6 col-xl-2" key={item.label}>
                <MetricCard
                  label={item.label}
                  value={item.value}
                  hint={item.hint}
                  tone={item.tone}
                />
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
                {summary.data.incidents.length === 0 ? (
                  <p className="text-secondary mb-0">
                    No hay incidentes funcionales recientes.
                  </p>
                ) : (
                  <ListGroup variant="flush" className="civitas-dashboard-list">
                    {summary.data.incidents.map((incident, index) => (
                      <ListGroup.Item
                        className="px-0"
                        key={`${incident.type}-${incident.organizationId ?? index}`}
                      >
                        <div className="d-flex justify-content-between gap-3">
                          <strong>
                            {incident.organizationName ?? "Organización sin nombre"}
                          </strong>
                          {incident.retryable ? (
                            <Badge bg="info" text="dark">
                              reintentable
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-secondary small mb-0">{incident.message}</p>
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                )}
              </PageCard>
            </div>

            <div className="col-12 col-xl-7">
              <PageCard
                title="Organizaciones con pendientes"
                subtitle="Estado canónico, downstream, paso actual y retryability por organización."
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
                  rows={summary.data.organizations}
                  getRowKey={(row) => row.profileId}
                  emptyTitle="Sin pendientes"
                  emptyDescription="Todas las organizaciones conocidas están completas o sin errores funcionales."
                  columns={[
                    {
                      key: "name",
                      header: "Organización",
                      render: (row) => row.name ?? row.organizationId ?? "—",
                    },
                    {
                      key: "canonical",
                      header: "Canónico",
                      render: (row) => <Badge bg="primary">{row.canonicalStatus}</Badge>,
                    },
                    {
                      key: "downstream",
                      header: "Downstream",
                      render: (row) => (
                        <Badge
                          bg={
                            row.downstreamStatus === "linked" ||
                            row.downstreamStatus === "synced"
                              ? "success"
                              : "warning"
                          }
                        >
                          {row.downstreamStatus}
                        </Badge>
                      ),
                    },
                    {
                      key: "step",
                      header: "Paso",
                      render: (row) => row.currentStep,
                    },
                    {
                      key: "retry",
                      header: "Acción",
                      render: (row) =>
                        row.retryable ? (
                          <Badge bg="info" text="dark">
                            reintento requerido
                          </Badge>
                        ) : (
                          "—"
                        ),
                    },
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
