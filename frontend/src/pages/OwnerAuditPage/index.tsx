import { useMemo } from "react";
import { Alert, Badge, Button, ButtonGroup, Card } from "react-bootstrap";
import { useOwnerApi, type OwnerAuditLog, type OwnerAuditPagination, type OwnerAuditResponse } from "../../api/owner";
import { useOrganizationSelectionApi, type SelectableOrganization } from "../../api/organizationSelection";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { DataTable, EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const PAGE_SIZE = 25;
const INITIAL_AUDIT_PARAMS: Required<OwnerAuditPagination> = { limit: PAGE_SIZE, offset: 0 };

const getAuditParamsKey = (params: Required<OwnerAuditPagination>) => `${params.limit}:${params.offset}`;

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const resultVariant = (result: string) => {
  if (result === "success") return "success";
  if (result === "denied") return "warning";
  return "danger";
};

const getAuditErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "No se pudieron cargar los logs owner.";

const formatActor = (row: OwnerAuditLog) => {
  const actor = row.actor;
  if (!actor) return row.actorUserId ?? "No resuelto";
  return actor.email || actor.displayName || actor.logtoUserId || actor.internalUserId || "No resuelto";
};

const formatStage = (row: OwnerAuditLog) => {
  const stage = row.metadata?.stage;
  return typeof stage === "string" ? stage : "Sin etapa";
};

const formatOrganization = (row: OwnerAuditLog) => {
  if (!row.organizationId && !row.organization?.id) return "Global";
  const id = row.organization?.id ?? row.organizationId;
  return row.organization?.name ? `${row.organization.name} (${id})` : id;
};

const getSyncBadge = (status?: string) => {
  if (status === "synced") return <Badge bg="success">Bootstrap completo</Badge>;
  if (status === "logto_created") return <Badge bg="warning" text="dark">Logto creada</Badge>;
  if (status === "creator_membership_pending") return <Badge bg="warning" text="dark">Membership pendiente</Badge>;
  if (status === "creator_role_pending") return <Badge bg="warning" text="dark">Rol admin pendiente</Badge>;
  if (status === "error") return <Badge bg="danger">Sync con error</Badge>;
  if (status === "metadata_missing") return <Badge bg="warning" text="dark">Metadata faltante</Badge>;
  if (status === "conflict") return <Badge bg="danger">Reconciliación pendiente</Badge>;
  return <Badge bg="warning" text="dark">Sync pendiente</Badge>;
};

const getReconciliationLabel = (organization: SelectableOrganization) => {
  const { reconciliation } = organization;

  if (reconciliation.status === "linked") return "Metadata enlazada por id Logto";
  if (reconciliation.status === "name_matched_pending_link") return "Metadata local encontrada por nombre; pendiente de enlazar por id Logto";
  if (reconciliation.status === "metadata_missing") return "Existe en Logto sin metadata local asociada";
  if (reconciliation.status === "conflict") return "Varios perfiles internos coinciden con esta organización real";
  return reconciliation.status;
};

const getOrganizationName = (organization: SelectableOrganization) => organization.name ?? "Organización sin nombre en Logto";
const formatLastSync = (value?: string | null) => value ? new Date(value).toLocaleString() : "Sin sincronización exitosa";

function TechnicalOrganizationCard({ organization }: { organization: SelectableOrganization }) {
  const profile = organization.profile;

  return (
    <Card className="h-100 border-0 shadow-sm">
      <Card.Body className="d-flex flex-column gap-3">
        <div className="d-flex justify-content-between gap-3 align-items-start">
          <div>
            <Card.Title className="mb-1">{getOrganizationName(organization)}</Card.Title>
            <Card.Subtitle className="text-secondary small text-break">
              Organización Logto: {organization.logtoOrganizationId}
            </Card.Subtitle>
          </div>
          {getSyncBadge(organization.syncStatus)}
        </div>
        <div className="small text-secondary d-flex flex-column gap-1">
          <span>Perfil Civitas: {profile?.id ?? "Sin metadata local"}</span>
          <span>Subdominio: {profile?.subdomain ?? "Sin subdominio local configurado"}</span>
          <span>Estado local: {profile?.status ?? "Sin metadata local"}</span>
          <span>Último bootstrap completo: {formatLastSync(profile?.logtoSyncedAt)}</span>
          <span>{getReconciliationLabel(organization)}</span>
          {organization.reconciliation.profileIds.length > 0 ? (
            <span className="text-break">Perfiles internos asociados: {organization.reconciliation.profileIds.join(", ")}</span>
          ) : null}
        </div>
        {organization.syncError ? (
          <Alert variant={organization.syncStatus === "conflict" ? "warning" : "danger"} className="small py-2 px-3 mb-0">
            {organization.syncError}
          </Alert>
        ) : null}
      </Card.Body>
    </Card>
  );
}

export function OwnerAuditPage() {
  const { getAuditLogs } = useOwnerApi();
  const organizationSelectionApi = useOrganizationSelectionApi();
  const {
    data,
    error,
    isLoading,
    params,
    reload,
    retry,
  } = useStableResource<OwnerAuditResponse, Required<OwnerAuditPagination>>({
    initialParams: INITIAL_AUDIT_PARAMS,
    load: getAuditLogs,
    getKey: getAuditParamsKey,
    getErrorMessage: getAuditErrorMessage,
  });
  const organizationsResource = useStableResource({
    initialParams: {},
    load: organizationSelectionApi.getOrganizations,
    getKey: () => "owner-observability-logto-organizations",
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudo cargar el directorio técnico Logto/Civitas.",
  });

  const events = data?.auditLogs ?? [];
  const total = data?.pagination.total ?? 0;
  const offset = params.offset;
  const organizations = organizationsResource.data?.organizations ?? [];
  const unreconciledProfiles = organizationsResource.data?.unreconciledProfiles ?? [];

  const columns = useMemo(
    () => [
      { key: "createdAt", header: "Fecha", render: (row: OwnerAuditLog) => formatDate(row.createdAt) },
      {
        key: "actor",
        header: "Actor",
        render: (row: OwnerAuditLog) => (
          <div className="text-break">
            <div className="fw-semibold">{formatActor(row)}</div>
            <div className="text-secondary small">Logto: {row.actor?.logtoUserId ?? "No resuelto"}</div>
            <div className="text-secondary small">Interno: {row.actor?.internalUserId ?? row.actorUserId ?? "No resuelto"}</div>
          </div>
        ),
      },
      { key: "action", header: "Acción", render: (row: OwnerAuditLog) => <code>{row.action}</code> },
      { key: "stage", header: "Etapa", render: (row: OwnerAuditLog) => <Badge bg="info" text="dark">{formatStage(row)}</Badge> },
      {
        key: "result",
        header: "Resultado",
        render: (row: OwnerAuditLog) => <Badge bg={resultVariant(row.result)}>{row.result}</Badge>,
      },
      {
        key: "organization",
        header: "Organización",
        render: (row: OwnerAuditLog) => (
          <div className="text-break">
            <div className="fw-semibold">{formatOrganization(row)}</div>
            <div className="text-secondary small">organization_id: {row.organization?.id ?? row.organizationId ?? "Global"}</div>
          </div>
        ),
      },
    ],
    []
  );

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const hasPrevious = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageShell
      eyebrow="Owner / Observabilidad"
      title="Logs y directorio técnico"
      description="Observa el estado real del sistema: eventos owner, organizaciones canónicas Logto y reconciliación operativa Civitas."
      actions={<Badge bg="success">owner:read</Badge>}
    >
      <div className="d-flex flex-column gap-4">
        <PageCard
          title="Directorio técnico Logto/Civitas"
          subtitle="Vista de soporte Logto-first: ids canónicos, metadata faltante, conflictos y estados parciales de bootstrap."
        >
          {organizationsResource.isLoading ? (
            <LoadingState title="Cargando directorio técnico" description="Consultando organizaciones reales desde Logto y metadata operativa de Civitas." />
          ) : organizationsResource.error ? (
            <ErrorState title="No se pudo cargar el directorio técnico" message={organizationsResource.error} action={<Button onClick={organizationsResource.retry}>Reintentar</Button>} />
          ) : organizations.length === 0 ? (
            <EmptyState title="Sin organizaciones canónicas" description="Cuando Logto tenga organizaciones reales, aparecerán aquí para observabilidad y soporte." />
          ) : (
            <div className="row g-4">
              {organizations.map((organization) => (
                <div className="col-12 col-xl-6" key={organization.logtoOrganizationId}>
                  <TechnicalOrganizationCard organization={organization} />
                </div>
              ))}
            </div>
          )}

          {!organizationsResource.isLoading && !organizationsResource.error && unreconciledProfiles.length > 0 ? (
            <Alert variant="warning" className="mt-4 mb-0">
              <Alert.Heading className="h6">Perfiles internos sin organización Logto reconciliada</Alert.Heading>
              <p className="mb-2">Hay {unreconciledProfiles.length} perfil(es) local(es) sin identidad canónica Logto vinculada.</p>
              <div className="small text-break">{unreconciledProfiles.map((profile) => profile.nameCache ?? profile.id).join(", ")}</div>
            </Alert>
          ) : null}
        </PageCard>

        <PageCard
          title="Logs operativos"
          subtitle="Listado paginado con eventos recientes primero. El actor visible prioriza Logto; PostgreSQL solo aporta el vínculo interno."
          actions={
            <ButtonGroup size="sm" aria-label="Paginación de auditoría">
              <Button variant="outline-secondary" disabled={isLoading || !hasPrevious} onClick={() => reload((current) => ({ ...current, offset: Math.max(0, current.offset - PAGE_SIZE) }))}>Anterior</Button>
              <Button variant="outline-secondary" disabled>Página {currentPage}</Button>
              <Button variant="outline-secondary" disabled={isLoading || !hasNext} onClick={() => reload((current) => ({ ...current, offset: current.offset + PAGE_SIZE }))}>Siguiente</Button>
            </ButtonGroup>
          }
        >
          {isLoading ? (
            <LoadingState title="Cargando logs" description="Consultando eventos owner registrados en Civitas." />
          ) : error ? (
            <ErrorState title="No se pudieron cargar los logs" message={error} action={<Button onClick={retry}>Reintentar</Button>} />
          ) : (
            <DataTable columns={columns} rows={events} getRowKey={(row) => row.id} emptyTitle="Sin logs" emptyDescription="Cuando un owner cree organizaciones o falle una creación relevante, los eventos aparecerán aquí." />
          )}
        </PageCard>
      </div>
    </PageShell>
  );
}
