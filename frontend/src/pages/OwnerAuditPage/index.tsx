import { useState } from "react";
import { Accordion, Badge, Button, Pagination, ToggleButton, ToggleButtonGroup } from "react-bootstrap";
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

const formatOptionalValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "No disponible";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
};

const getMetadataEntries = (metadata: OwnerAuditLog["metadata"]) => Object.entries(metadata ?? {});

type AuditLogDetailMode = "formatted" | "json";

function AuditLogFormattedDetail({ row }: { row: OwnerAuditLog }) {
  const metadataEntries = getMetadataEntries(row.metadata);

  const summaryItems = [
    { label: "Acción", value: row.action },
    { label: "Resultado", value: row.result },
    { label: "Fecha", value: formatDate(row.createdAt) },
    { label: "Etapa", value: formatStage(row) },
    { label: "Actor visible", value: formatActor(row) },
    { label: "Email del actor", value: row.actor?.email },
    { label: "Logto user id", value: row.actor?.logtoUserId },
    { label: "Internal user id", value: row.actor?.internalUserId ?? row.actorUserId },
    { label: "Organización visible", value: formatOrganization(row) },
    { label: "Organization id", value: row.organization?.id ?? row.organizationId },
  ];

  return (
    <div className="civitas-audit-formatted-detail">
      <dl className="civitas-audit-formatted-grid mb-3">
        {summaryItems.map((item) => (
          <div key={item.label} className="civitas-audit-formatted-field">
            <dt>{item.label}</dt>
            <dd>{formatOptionalValue(item.value)}</dd>
          </div>
        ))}
      </dl>

      <section className="civitas-audit-metadata rounded-4 border p-3">
        <h3 className="h6 mb-3">Metadata operativa</h3>
        {metadataEntries.length === 0 ? (
          <p className="text-secondary small mb-0">Este evento no incluye metadata operativa.</p>
        ) : (
          <dl className="civitas-audit-metadata-list mb-0">
            {metadataEntries.map(([key, value]) => (
              <div key={key} className="civitas-audit-metadata-row">
                <dt>{key}</dt>
                <dd>{formatOptionalValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

function AuditLogCard({ row }: { row: OwnerAuditLog }) {
  const [detailMode, setDetailMode] = useState<AuditLogDetailMode>("formatted");

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
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
          <span className="text-secondary small">Detalle del evento</span>
          <ToggleButtonGroup
            type="radio"
            name={`audit-detail-mode-${row.id}`}
            value={detailMode}
            onChange={(value) => setDetailMode(value as AuditLogDetailMode)}
            size="sm"
          >
            <ToggleButton id={`audit-detail-formatted-${row.id}`} value="formatted" variant="outline-primary">
              Formatted
            </ToggleButton>
            <ToggleButton id={`audit-detail-json-${row.id}`} value="json" variant="outline-primary">
              JSON
            </ToggleButton>
          </ToggleButtonGroup>
        </div>
        {detailMode === "formatted" ? <AuditLogFormattedDetail row={row} /> : <JsonLogBlock value={row} />}
      </Accordion.Body>
    </Accordion.Item>
  );
}

function AuditLogList({ rows }: { rows: OwnerAuditLog[] }) {
  if (rows.length === 0) return null;

  return (
    <Accordion alwaysOpen className="civitas-audit-list d-grid gap-3">
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
        subtitle="Vista expandible por evento con detalle legible y payload JSON para inspección y soporte."
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
          Mostrando {events.length} de {total} logs. Abre cada evento para alternar entre una vista formateada y su payload JSON completo.
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
