import { useId, useState } from "react";
import { Accordion, Alert, Badge, Button, ButtonGroup, Pagination } from "react-bootstrap";
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

const formatPrimitive = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "No disponible";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
};

const toTitleCase = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());

const METADATA_LABELS: Record<string, string> = {
  action: "Acción interna",
  after: "Después",
  before: "Antes",
  code: "Código",
  companyId: "Company id",
  createdOrganizationId: "Organización creada",
  email: "Email",
  error: "Error",
  errorMessage: "Mensaje de error",
  fluentCompanyId: "FluentCRM company id",
  httpStatus: "HTTP status",
  internalUserId: "Internal user id",
  logtoOrganizationId: "Logto organization id",
  logtoUserId: "Logto user id",
  message: "Mensaje",
  organizationId: "Organization id",
  reason: "Motivo",
  requestId: "Request id",
  response: "Respuesta",
  role: "Rol",
  stage: "Etapa",
  status: "Estado",
  syncStatus: "Estado de sincronización",
  target: "Destino",
  traceId: "Trace id",
  userId: "User id",
  wpRole: "Rol WordPress",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPrimitiveMetadataValue = (value: unknown) =>
  value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);

const getMetadataLabel = (key: string) => METADATA_LABELS[key] ?? toTitleCase(key);

const getMetadataSectionTitle = (key: string) => {
  const normalized = key.toLowerCase();

  if (["error", "err", "exception", "failure", "failed", "reason", "message", "code"].some((part) => normalized.includes(part))) {
    return "Errores y diagnóstico";
  }

  if (["stage", "status", "state", "sync", "result", "step"].some((part) => normalized.includes(part))) {
    return "Estado del flujo";
  }

  if (["before", "after", "change", "changes", "diff", "previous", "next"].some((part) => normalized.includes(part))) {
    return "Cambios detectados";
  }

  if (["request", "response", "payload", "body", "headers", "api", "endpoint", "url"].some((part) => normalized.includes(part))) {
    return "Intercambio técnico";
  }

  if (["id", "email", "logto", "fluent", "wordpress", "wp", "user", "organization", "company", "tenant", "role"].some((part) => normalized.includes(part))) {
    return "Identificadores y referencias";
  }

  return "Metadata adicional";
};

const formatObjectPreview = (value: Record<string, unknown>) => {
  const entries = Object.entries(value);
  const primitiveEntries = entries.filter(([, entryValue]) => isPrimitiveMetadataValue(entryValue));

  if (entries.length > 0 && primitiveEntries.length === entries.length && entries.length <= 8) {
    return primitiveEntries
      .map(([key, entryValue]) => `${getMetadataLabel(key)}: ${formatPrimitive(entryValue)}`)
      .join("\n");
  }

  return JSON.stringify(value, null, 2);
};

const formatMetadataValue = (value: unknown) => {
  if (Array.isArray(value)) {
    if (value.length === 0) return "Sin elementos";
    if (value.every(isPrimitiveMetadataValue)) return value.map(formatPrimitive).join(", ");
    return JSON.stringify(value, null, 2);
  }

  if (isRecord(value)) return formatObjectPreview(value);

  return formatPrimitive(value);
};

type DetailRow = {
  label: string;
  value: string;
  isCode?: boolean;
};

const buildMetadataSections = (metadata: Record<string, unknown> | null) => {
  if (!metadata) return [];

  const sections = new Map<string, DetailRow[]>();

  Object.entries(metadata).forEach(([key, value]) => {
    const title = getMetadataSectionTitle(key);
    const currentRows = sections.get(title) ?? [];

    currentRows.push({
      label: getMetadataLabel(key),
      value: formatMetadataValue(value),
      isCode: !isPrimitiveMetadataValue(value),
    });

    sections.set(title, currentRows);
  });

  const preferredOrder = [
    "Errores y diagnóstico",
    "Estado del flujo",
    "Cambios detectados",
    "Identificadores y referencias",
    "Intercambio técnico",
    "Metadata adicional",
  ];

  return preferredOrder
    .filter((title) => sections.has(title))
    .map((title) => ({ title, rows: sections.get(title) ?? [] }));
};

const buildHumanSummary = (row: OwnerAuditLog) => {
  const stage = formatStage(row);
  const actor = formatActor(row);
  const organization = formatOrganization(row);
  const base = `Civitas registró ${row.action} con resultado ${row.result.toUpperCase()}.`;
  const context = `Etapa: ${stage}. Actor: ${actor}. Alcance: ${organization}.`;

  const errorCandidate = row.metadata?.errorMessage ?? row.metadata?.error ?? row.metadata?.reason ?? row.metadata?.message;
  const errorText = typeof errorCandidate === "string" && errorCandidate.trim().length > 0
    ? ` Diagnóstico: ${errorCandidate}`
    : "";

  return `${base} ${context}${errorText}`;
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

  const metadataSections = buildMetadataSections(row.metadata);

  return (
    <div className="civitas-audit-detail-stack">
      <Alert variant={resultVariant(row.result)} className="mb-0">
        {buildHumanSummary(row)}
      </Alert>
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
      {metadataSections.length > 0 ? (
        <div className="civitas-audit-detail-grid">
          {metadataSections.map((section) => (
            <AuditDetailList key={section.title} title={section.title} rows={section.rows} />
          ))}
        </div>
      ) : null}
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
