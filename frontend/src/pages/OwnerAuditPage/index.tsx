import { Accordion, Badge, Button, Pagination } from "react-bootstrap";
import { useOwnerApi, type OwnerAuditLog, type OwnerAuditPagination, type OwnerAuditResponse } from "../../api/owner";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { EmptyState, ErrorState, JsonLogBlock, LoadingState, PageCard, PageShell } from "../../shared/ui";

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

const formatLogStatement = (row: OwnerAuditLog) =>
  `${row.result.toUpperCase()} · ${row.action} · ${formatOrganization(row)} · ${formatDate(row.createdAt)}`;


function AuditLogCard({ row }: { row: OwnerAuditLog }) {
  return (
    <Accordion.Item eventKey={row.id} className="civitas-audit-item border rounded-4 overflow-hidden">
      <Accordion.Header>
        <div className="civitas-audit-summary w-100 pe-3">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <Badge bg={resultVariant(row.result)}>{row.result}</Badge>
            <Badge bg="info" text="dark">{formatStage(row)}</Badge>
            <span className="text-secondary small">{formatDate(row.createdAt)}</span>
          </div>
          <div className="fw-semibold text-break">{formatLogStatement(row)}</div>
          <div className="text-secondary small text-break">Actor: {formatActor(row)}</div>
        </div>
      </Accordion.Header>
      <Accordion.Body>
        <JsonLogBlock value={row} />
      </Accordion.Body>
    </Accordion.Item>
  );
}

function AuditLogList({ rows }: { rows: OwnerAuditLog[] }) {
  if (rows.length === 0) return null;

  return (
    <Accordion alwaysOpen defaultActiveKey={rows[0]?.id} className="civitas-audit-list d-grid gap-3">
      {rows.map((row) => (
        <AuditLogCard key={row.id} row={row} />
      ))}
    </Accordion>
  );
}

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
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrevious = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  const goToPage = (page: number) => {
    const nextOffset = Math.max(0, (page - 1) * PAGE_SIZE);
    reload((current) => ({ ...current, offset: nextOffset }));
  };

  return (
    <PageShell
      eyebrow="Owner"
      title="Logs owner"
      description="Eventos operativos enriquecidos con identidad Logto del actor y organización canónica cuando está disponible."
      actions={<Badge bg="success">owner:read</Badge>}
    >
      <PageCard
        title="Logs operativos"
        subtitle="Vista JSON expandible por evento para inspección y soporte."
        actions={
          totalPages > 1 ? (
            <Pagination size="sm" className="mb-0 civitas-audit-pagination">
              <Pagination.Prev disabled={isLoading || !hasPrevious} onClick={() => goToPage(currentPage - 1)} />
              <Pagination.Item active>{currentPage}</Pagination.Item>
              <Pagination.Next disabled={isLoading || !hasNext} onClick={() => goToPage(currentPage + 1)} />
            </Pagination>
          ) : undefined
        }
      >
        <p className="text-secondary small mb-3">
          Mostrando {events.length} de {total} logs. Abre cada evento para ver su payload estructurado.
        </p>
        {isLoading ? (
          <LoadingState title="Cargando logs" description="Consultando eventos owner registrados en Civitas." />
        ) : error ? (
          <ErrorState
            title="No se pudieron cargar los logs"
            message={error}
            action={<Button onClick={retry}>Reintentar</Button>}
          />
        ) : events.length === 0 ? (
          <EmptyState
            title="Sin logs"
            description="Cuando un owner cree organizaciones o falle una creación relevante, los eventos aparecerán aquí."
          />
        ) : (
          <AuditLogList rows={events} />
        )}
      </PageCard>
    </PageShell>
  );
}
