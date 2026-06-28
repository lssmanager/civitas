import { useMemo, useState } from "react";
import { Accordion, Badge, Button, Form, Pagination, ToggleButton, ToggleButtonGroup } from "react-bootstrap";
import { Link, useSearchParams } from "react-router-dom";
import { useOwnerApi, type OwnerAuditLog, type OwnerAuditPagination, type OwnerAuditResponse } from "../../api/owner";
import { getLogPlane, getVerificationLevel } from "../../operational/backbone";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { EmptyState, ErrorState, JsonLogBlock, LoadingState, PageCard, PageShell } from "../../shared/ui";

const PAGE_SIZE = 25;
type AuditFilterParams = Required<Pick<OwnerAuditPagination, "limit" | "offset">> & Omit<OwnerAuditPagination, "limit" | "offset">;

const getAuditParamsKey = (params: AuditFilterParams) => JSON.stringify(params);

const compactFilters = (params: AuditFilterParams): AuditFilterParams => Object.fromEntries(
  Object.entries(params).filter(([, value]) => value !== undefined && value !== "")
) as AuditFilterParams;

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const resultVariant = (result: string) => {
  if (["completed", "success", "succeeded"].includes(result)) return "success";
  if (["queued", "pending", "running"].includes(result)) return "warning";
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
  const stage = row.stepName || row.metadata?.stepName || row.metadata?.stage;
  return typeof stage === "string" ? stage : "Sin etapa";
};

const formatOrganization = (row: OwnerAuditLog) => {
  if (!row.organizationId && !row.organization?.id) return "Global";
  const id = row.organization?.id ?? row.organizationId;
  return row.organization?.name ? `${row.organization.name} (${id})` : id;
};

const getMetadataString = (row: OwnerAuditLog, key: string) => {
  const value = row.metadata?.[key];
  return typeof value === "string" ? value : null;
};

const formatLogStatement = (row: OwnerAuditLog) =>
  row.humanMessage || getMetadataString(row, "humanMessage") || `${row.result.toUpperCase()} · ${row.microAction || row.action} · ${formatOrganization(row)} · ${formatDate(row.createdAt)}`;

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
    { label: "Plano operacional", value: getLogPlane(row) },
    { label: "Verification level", value: getVerificationLevel(row) },
    { label: "Source", value: row.executionSource || row.metadata?.source || row.metadata?.freshnessSource },
    { label: "Tipo de fila", value: row.rowType },
    { label: "Sistema", value: row.system || row.metadata?.affectedSystem },
    { label: "Microacción", value: row.microAction || row.action },
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
    { label: "Step", value: row.stepName || row.metadata?.stepName },
    { label: "Entidad", value: row.entityType || row.metadata?.entityType },
    { label: "Target", value: row.targetIdentity || row.metadata?.targetIdentity },
    { label: "Mensaje humano", value: row.humanMessage || row.metadata?.humanMessage },
    { label: "Cola", value: row.queueName || row.metadata?.queueName },
    { label: "Estado cola", value: row.queueStatus || row.metadata?.queueStatus },
    { label: "Fuente ejecución", value: row.executionSource || row.metadata?.executionSource },
    { label: "Job", value: row.jobId || row.metadata?.jobId },
    { label: "Edad job", value: row.jobAgeSeconds ?? row.metadata?.jobAgeSeconds },
    { label: "Retry", value: row.retryState || row.metadata?.retryState },
    { label: "Worker", value: row.workerHeartbeatState || row.metadata?.workerHeartbeatState },
    { label: "Sistema afectado", value: row.system || row.metadata?.affectedSystem },
    { label: "Campos enviados", value: row.metadata?.fieldsSent },
    { label: "Campos faltantes", value: row.missingFields || row.metadata?.missingFields },
    { label: "Diff campos", value: row.fieldDiffs || row.metadata?.fieldDiffs },
    { label: "Provider code", value: row.providerCode || row.metadata?.providerCode },
    { label: "Provider status", value: row.providerStatus || row.metadata?.providerStatus },
    { label: "Acción sugerida", value: row.metadata?.suggestedAction },
    { label: "Requiere humano", value: row.requiresHumanAction ?? row.metadata?.requiresHumanAction },
    { label: "Retryable", value: row.retryable ?? row.metadata?.retryable },
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

function AuditLogCard({ row, onRetry }: { row: OwnerAuditLog; onRetry: () => void }) {
  const [detailMode, setDetailMode] = useState<AuditLogDetailMode>("formatted");
  const ownerApi = useOwnerApi();
  const operationId = typeof row.metadata?.operationId === "string" ? row.metadata.operationId : null;
  const organizationId = row.organization?.id ?? row.organizationId;
  const canRetry = Boolean(operationId && organizationId && (row.retryable || row.metadata?.retryable || row.result === "error" || row.result === "failed" || row.availableActions?.includes("retry")));
  const canResend = Boolean(operationId && organizationId && row.availableActions?.includes("resend_payload"));
  const canVerify = Boolean(operationId && organizationId && row.availableActions?.includes("verify_provider"));
  const needsHuman = Boolean(row.requiresHumanAction || row.metadata?.requiresHumanAction || row.availableActions?.includes("manual_review_required") || row.availableActions?.includes("manual_resolution"));
  const canCorrect = Boolean(row.suggestedRoute && row.availableActions?.includes("correct_data"));

  return (
    <Accordion.Item eventKey={row.id} className="civitas-audit-item border rounded-4 overflow-hidden">
      <Accordion.Header>
        <div className="civitas-audit-summary w-100 pe-3">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <Badge bg="secondary">{row.rowType || "operational_step"}</Badge>
            <Badge bg={getLogPlane(row) === "live" ? "primary" : getLogPlane(row) === "worker" ? "dark" : getLogPlane(row) === "local" ? "info" : "secondary"} text={getLogPlane(row) === "local" ? "dark" : undefined}>plane: {getLogPlane(row)}</Badge>
            <Badge bg="light" text="dark">verification: {getVerificationLevel(row)}</Badge>
            <Badge bg={resultVariant(row.result)}>{row.result}</Badge>
            {row.system ? <Badge bg="light" text="dark">{row.system}</Badge> : null}
            <Badge bg="info" text="dark">{formatStage(row)}</Badge>
            {row.workerHeartbeatState || row.metadata?.workerHeartbeatState ? <Badge bg="warning" text="dark">Worker: {String(row.workerHeartbeatState || row.metadata?.workerHeartbeatState)}</Badge> : null}
            {row.executionSource || row.metadata?.executionSource ? <Badge bg="light" text="dark">Fuente: {String(row.executionSource || row.metadata?.executionSource)}</Badge> : null}
            {row.jobAgeSeconds ?? row.metadata?.jobAgeSeconds ? <Badge bg="light" text="dark">Job age: {String(row.jobAgeSeconds ?? row.metadata?.jobAgeSeconds)}s</Badge> : null}
            <span className="text-secondary small">{formatDate(row.createdAt)}</span>
          </div>
          <div className="fw-semibold text-break">{formatLogStatement(row)}</div>
          <div className="text-secondary small text-break">Organización: {formatOrganization(row)} · Actor: {formatActor(row)}</div>
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
        <div className="d-flex flex-wrap gap-2 mb-3">
          {organizationId ? <Link className="btn btn-outline-secondary btn-sm" to={`/owner/organizations/${encodeURIComponent(organizationId)}`}>Abrir organización</Link> : null}
          {canCorrect ? <Link className="btn btn-primary btn-sm" to={`${row.suggestedRoute}${row.suggestedSection ? `#${row.suggestedSection}` : ""}`}>{row.suggestedAction || "Corregir datos"}</Link> : null}
          {canRetry ? <Button size="sm" variant="outline-primary" onClick={() => ownerApi.retrySyncOperation(organizationId!, operationId!).then(onRetry)}>Reintentar</Button> : null}
          {canResend ? <Button size="sm" variant="outline-secondary" onClick={() => ownerApi.resendSyncOperationPayload(organizationId!, operationId!).then(onRetry)}>Reenviar payload</Button> : null}
          {canVerify ? <Button size="sm" variant="outline-info" onClick={() => ownerApi.verifySyncOperationProvider(organizationId!, operationId!).then(onRetry)}>Verificar en proveedor</Button> : null}
          {needsHuman ? <Button size="sm" variant="outline-warning" onClick={() => ownerApi.manualResolveSyncOperation(organizationId!, operationId!, { resolutionType: "reviewed_no_action", resolutionReason: "owner_reviewed_from_operational_center" }).then(onRetry)}>Marcar revisado</Button> : null}
        </div>
        {detailMode === "formatted" ? <AuditLogFormattedDetail row={row} /> : <JsonLogBlock value={row} />}
      </Accordion.Body>
    </Accordion.Item>
  );
}

function AuditLogList({ rows, onRetry }: { rows: OwnerAuditLog[]; onRetry: () => void }) {
  if (rows.length === 0) return null;

  return (
    <Accordion alwaysOpen className="civitas-audit-list d-grid gap-3">
      {rows.map((row) => (
        <AuditLogCard key={row.id} row={row} onRetry={onRetry} />
      ))}
    </Accordion>
  );
}

export function OwnerAuditPage() {
  const { getOperationalLogs } = useOwnerApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialParams = useMemo<AuditFilterParams>(() => compactFilters({
    limit: PAGE_SIZE,
    offset: 0,
    organizationId: searchParams.get("organizationId") || undefined,
    organizationName: searchParams.get("organizationName") || undefined,
    entityType: searchParams.get("entityType") || undefined,
    stepName: searchParams.get("stepName") || undefined,
    affectedSystem: searchParams.get("affectedSystem") || searchParams.get("system") || undefined,
    system: searchParams.get("system") || undefined,
    status: searchParams.get("status") || undefined,
    retryState: searchParams.get("retryState") || undefined,
    retryable: searchParams.get("retryable") || undefined,
    requiresHumanAction: searchParams.get("requiresHumanAction") || undefined,
    downstream: searchParams.get("downstream") || undefined,
    microAction: searchParams.get("microAction") || undefined,
    queueName: searchParams.get("queueName") || undefined,
    q: searchParams.get("q") || undefined,
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    requiresAction: searchParams.get("requiresAction") || undefined,
  }), []);
  const {
    data,
    error,
    isLoading,
    params,
    reload,
    retry,
  } = useStableResource<OwnerAuditResponse, AuditFilterParams>({
    initialParams,
    load: getOperationalLogs,
    getKey: getAuditParamsKey,
    getErrorMessage: getAuditErrorMessage,
  });

  const events = data?.auditLogs ?? [];
  const total = data?.pagination.total ?? 0;
  const offset = params.offset ?? 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrevious = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  const goToPage = (page: number) => {
    const nextOffset = Math.max(0, (page - 1) * PAGE_SIZE);
    reload((current) => ({ ...current, offset: nextOffset }));
  };

  const updateFilter = (key: keyof OwnerAuditPagination, value: string) => {
    const next = compactFilters({ ...params, limit: params.limit ?? PAGE_SIZE, [key]: value || undefined, offset: 0 });
    setSearchParams(Object.fromEntries(Object.entries(next).filter(([entryKey]) => !["limit", "offset"].includes(entryKey)).map(([entryKey, entryValue]) => [entryKey, String(entryValue)])));
    reload(() => next);
  };

  return (
    <PageShell
      eyebrow="Owner"
      title="Centro operativo owner"
      description="Timeline histórico/operativo etiquetado por plano: live provider checks, worker runtime, local reconciled y audit histórico."
      actions={<Badge bg="success">owner:read</Badge>}
    >
      <PageCard
        title="Centro operativo"
        subtitle="Filtra por organización, sistema, microacción, estado, retry, cola o texto; cada fila expone source y verificationLevel para no mezclar planos semánticos."
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
        <Form className="row g-2 mb-3">
          {[
            ["organizationId", "Organization ID"],
            ["organizationName", "Organización"],
            ["q", "Búsqueda"],
            ["affectedSystem", "Sistema"],
            ["microAction", "Microacción"],
            ["status", "Estado"],
            ["retryState", "Retry"],
            ["queueName", "Cola"],
            ["from", "Desde"],
            ["to", "Hasta"],
            ["stepName", "Step técnico"],
            ["entityType", "Entidad técnica"],
          ].map(([key, label]) => (
            <Form.Group className="col-12 col-md-3" key={key}>
              <Form.Label>{label}</Form.Label>
              <Form.Control size="sm" value={String(params[key as keyof OwnerAuditPagination] ?? "")} onChange={(event) => updateFilter(key as keyof OwnerAuditPagination, event.target.value)} />
            </Form.Group>
          ))}
          <Form.Group className="col-12 col-md-3">
            <Form.Label>Retryable</Form.Label>
            <Form.Select size="sm" value={params.retryable ?? ""} onChange={(event) => updateFilter("retryable", event.target.value)}>
              <option value="">Todos</option>
              <option value="true">Sí</option>
              <option value="false">No</option>
            </Form.Select>
          </Form.Group>
          <Form.Group className="col-12 col-md-3">
            <Form.Label>Acción humana</Form.Label>
            <Form.Select size="sm" value={params.requiresHumanAction ?? ""} onChange={(event) => updateFilter("requiresHumanAction", event.target.value)}>
              <option value="">Todos</option>
              <option value="true">Sí</option>
              <option value="false">No</option>
            </Form.Select>
          </Form.Group>
          <Form.Group className="col-12 col-md-3">
            <Form.Label>Downstream</Form.Label>
            <Form.Select size="sm" value={params.downstream ?? ""} onChange={(event) => updateFilter("downstream", event.target.value)}>
              <option value="">Todos</option>
              <option value="true">Sí</option>
            </Form.Select>
          </Form.Group>
          <Form.Group className="col-12 col-md-3">
            <Form.Label>Requiere acción</Form.Label>
            <Form.Select size="sm" value={params.requiresAction ?? ""} onChange={(event) => updateFilter("requiresAction", event.target.value)}>
              <option value="">Todos</option>
              <option value="true">Sí</option>
              <option value="false">No</option>
            </Form.Select>
          </Form.Group>
        </Form>
        <p className="text-secondary small mb-3">
          Mostrando {events.length} de {total} filas operativas. Badges de plane/source/verificationLevel separan live, worker runtime, local reconciled y audit histórico; el JSON queda solo como detalle técnico.
        </p>
        {isLoading ? (
          <LoadingState title="Cargando centro operativo" description="Consultando sync_operations, sync_operation_steps y estado de worker/cola." />
        ) : error ? (
          <ErrorState
            title="No se pudieron cargar los logs"
            message={error}
            action={<Button onClick={retry}>Reintentar</Button>}
          />
        ) : events.length === 0 ? (
          <EmptyState
            title="Sin filas operativas"
            description="Cuando existan microacciones, retries o pendientes de sincronización, aparecerán aquí filtrables por organización."
          />
        ) : (
          <AuditLogList rows={events} onRetry={retry} />
        )}
      </PageCard>
    </PageShell>
  );
}
