import { useId, useState } from "react";
import { Accordion, Badge, Button, ButtonGroup, Pagination } from "react-bootstrap";
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
  const id = row.organization?.id ?? row.organizationId ?? "Global";
  return row.organization?.name ? `${row.organization.name} (${id})` : id;
};

const formatLogStatement = (row: OwnerAuditLog) =>
  `${row.result.toUpperCase()} · ${row.action} · ${formatOrganization(row)} · ${formatDate(row.createdAt)}`;

const formatPrimitive = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "No disponible";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
};

const toTitleCase = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());

const buildMetadataRows = (metadata: Record<string, unknown> | null) => {
  if (!metadata) return [];

  return Object.entries(metadata).map(([key, value]) => ({
    label: toTitleCase(key),
    value: formatPrimitive(value),
    isCode: typeof value === "object" && value !== null,
  }));
};

type DetailRow = {
  label: string;
  value: string;
  isCode?: boolean;
};

function AuditDetailList({
  title,
  rows,
}: {
  title: string;
  rows: DetailRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <section className="civitas-audit-detail-section">
      <p className="civitas-audit-detail-section__title mb-2">{title}</p>
      <dl className="civitas-audit-detail-list mb-0">
        {rows.map((row) => (
          <div key={`${title}-${row.label}`} className="civitas-audit-detail-list__row">
            <dt>{row.label}</dt>
            <dd className={row.isCode ? "civitas-audit-detail-list__code" : undefined}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function AuditFormattedView({ row }: { row: OwnerAuditLog }) {
  const overviewRows: DetailRow[] = [
    { label: "Acción", value: row.action },
    { label: "Resultado", value: row.result.toUpperCase() },
    { label: "Etapa", value: formatStage(row) },
    { label: "Fecha", value: formatDate(row.createdAt) },
  ];

  const actorRows: DetailRow[] = [
    { label: "Actor visible", value: formatActor(row) },
    { label: "Email", value: row.actor?.email ?? "No disponible" },
    { label: "Display name", value: row.actor?.displayName ?? "No disponible" },
    { label: "Logto user id", value: row.actor?.logtoUserId ?? "No disponible", isCode: true },
    { label: "Internal user id", value: row.actor?.internalUserId ?? row.actorUserId ?? "No disponible", isCode: true },
  ];

  const organizationRows: DetailRow[] = [
    { label: "Organización", value: formatOrganization(row) },
    { label: "Organization id", value: row.organization?.id ?? row.organizationId ?? "Global", isCode: true },
    { label: "Nombre canónico", value: row.organization?.name ?? "No disponible" },
  ];

  const metadataRows = buildMetadataRows(row.metadata);

  return (
    <div className="civitas-audit-detail-stack">
      <div className="civitas-audit-overview-grid">
        {overviewRows.map((item) => (
          <div key={item.label} className="civitas-audit-overview-card">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      <div className="civitas-audit-detail-grid">
        <AuditDetailList title="Actor" rows={actorRows} />
        <AuditDetailList title="Organización" rows={organizationRows} />
      </div>
      <AuditDetailList title="Metadata operativa" rows={metadataRows} />
    </div>
  );
}

function AuditLogCard({ row }: { row: OwnerAuditLog }) {
  const [detailMode, setDetailMode] = useState<"formatted" | "json">("formatted");
  const detailModeId = useId();

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
      <Accordion.Body className="civitas-audit-item__body">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
          <div>
            <p className="mb-1 fw-semibold">Detalle del evento</p>
            <p className="mb-0 text-secondary small">
              Usa la vista resumida para soporte rápido o cambia a JSON cuando necesites el payload completo.
            </p>
          </div>
          <ButtonGroup aria-label={`Vista del log ${detailModeId}`} className="civitas-audit-mode-switch">
            <Button
              variant={detailMode === "formatted" ? "primary" : "outline-primary"}
              onClick={() => setDetailMode("formatted")}
            >
              Formatted
            </Button>
            <Button
              variant={detailMode === "json" ? "primary" : "outline-primary"}
              onClick={() => setDetailMode("json")}
            >
              JSON
            </Button>
          </ButtonGroup>
        </div>
        {detailMode === "formatted" ? <AuditFormattedView row={row} /> : <JsonLogBlock value={row} />}
      </Accordion.Body>
    </Accordion.Item>
  );
}

function AuditLogList({ rows }: { rows: OwnerAuditLog[] }) {
  if (rows.length === 0) return null;

  return (
    <Accordion className="civitas-audit-list d-grid gap-3">
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
        subtitle="Vista expandible por evento con lectura resumida y payload JSON."
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
          Mostrando {events.length} de {total} logs. Cada evento entra cerrado por defecto y puedes alternar entre vista resumida y JSON.
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
