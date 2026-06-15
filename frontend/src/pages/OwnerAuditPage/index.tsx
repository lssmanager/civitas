import { useMemo } from "react";
import { Badge, Button, ButtonGroup } from "react-bootstrap";
import { useOwnerApi, type OwnerAuditLog, type OwnerAuditPagination, type OwnerAuditResponse } from "../../api/owner";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { DataTable, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

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

const formatOrganization = (row: OwnerAuditLog) => {
  if (!row.organizationId && !row.organization?.id) return "Global";
  const id = row.organization?.id ?? row.organizationId;
  return row.organization?.name ? `${row.organization.name} (${id})` : id;
};

export function OwnerAuditPage() {
  const { getAuditLogs } = useOwnerApi();
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

  const events = data?.auditLogs ?? [];
  const total = data?.pagination.total ?? 0;
  const offset = params.offset;

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
      eyebrow="Owner"
      title="Logs owner"
      description="Eventos operativos enriquecidos con identidad Logto del actor y organización canónica cuando está disponible."
      actions={<Badge bg="success">owner:read</Badge>}
    >
      <PageCard
        title="Logs operativos"
        subtitle="Listado paginado con eventos recientes primero. El actor visible prioriza Logto; PostgreSQL solo aporta el vínculo interno."
        actions={
          <ButtonGroup size="sm" aria-label="Paginación de auditoría">
            <Button
              variant="outline-secondary"
              disabled={isLoading || !hasPrevious}
              onClick={() => reload((current) => ({ ...current, offset: Math.max(0, current.offset - PAGE_SIZE) }))}
            >
              Anterior
            </Button>
            <Button variant="outline-secondary" disabled>
              Página {currentPage}
            </Button>
            <Button
              variant="outline-secondary"
              disabled={isLoading || !hasNext}
              onClick={() => reload((current) => ({ ...current, offset: current.offset + PAGE_SIZE }))}
            >
              Siguiente
            </Button>
          </ButtonGroup>
        }
      >
        {isLoading ? (
          <LoadingState title="Cargando logs" description="Consultando eventos owner registrados en Civitas." />
        ) : error ? (
          <ErrorState
            title="No se pudieron cargar los logs"
            message={error}
            action={<Button onClick={retry}>Reintentar</Button>}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={events}
            getRowKey={(row) => row.id}
            emptyTitle="Sin logs"
            emptyDescription="Cuando un owner cree organizaciones o falle una creación relevante, los eventos aparecerán aquí."
          />
        )}
      </PageCard>
    </PageShell>
  );
}
