import { useMemo, useState } from "react";
import { Accordion, Badge, Button, ButtonGroup, Form } from "react-bootstrap";
import { useOwnerApi, type OwnerAuditLog, type OwnerAuditPagination, type OwnerAuditResponse } from "../../api/owner";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { DataTable, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const PAGE_SIZE = 25;
const INITIAL_AUDIT_PARAMS: Required<OwnerAuditPagination> = { limit: PAGE_SIZE, offset: 0 };

type AuditViewMode = "friendly" | "json";

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

const getMetadataBullets = (metadata: Record<string, unknown> | null) => {
  if (!metadata) return [];
  return Object.entries(metadata).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
};

const getJsonPayload = (row: OwnerAuditLog) => JSON.stringify(row, null, 2);

function AuditLogCard({ row, viewMode }: { row: OwnerAuditLog; viewMode: AuditViewMode }) {
  const metadataBullets = getMetadataBullets(row.metadata);

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
        {viewMode === "json" ? (
          <pre className="civitas-json-view mb-0"><code>{getJsonPayload(row)}</code></pre>
        ) : (
          <div className="civitas-audit-detail-grid">
            <section>
              <h3 className="h6">Enunciado del log</h3>
              <p className="mb-0 text-break">{formatLogStatement(row)}</p>
            </section>
            <section>
              <h3 className="h6">Identidad</h3>
              <ul className="mb-0 ps-3">
                <li><strong>Actor:</strong> {formatActor(row)}</li>
                <li><strong>Logto:</strong> {row.actor?.logtoUserId ?? "No resuelto"}</li>
                <li><strong>Interno:</strong> {row.actor?.internalUserId ?? row.actorUserId ?? "No resuelto"}</li>
                <li><strong>Organización:</strong> {formatOrganization(row)}</li>
              </ul>
            </section>
            <section>
              <h3 className="h6">Detalle comprimido</h3>
              {metadataBullets.length > 0 ? (
                <ul className="mb-0 ps-3">
                  {metadataBullets.map((item) => (
                    <li key={item.key} className="text-break"><strong>{item.key}:</strong> {item.value}</li>
                  ))}
                </ul>
              ) : (
                <p className="mb-0 text-secondary">Sin metadata adicional.</p>
              )}
            </section>
          </div>
        )}
      </Accordion.Body>
    </Accordion.Item>
  );
}

function AuditLogList({ rows, viewMode }: { rows: OwnerAuditLog[]; viewMode: AuditViewMode }) {
  if (rows.length === 0) return null;

  return (
    <Accordion alwaysOpen className="civitas-audit-list d-grid gap-3">
      {rows.map((row) => (
        <AuditLogCard key={row.id} row={row} viewMode={viewMode} />
      ))}
    </Accordion>
  );
}

export function OwnerAuditPage() {
  const { getAuditLogs } = useOwnerApi();
  const [viewMode, setViewMode] = useState<AuditViewMode>("friendly");
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
        key: "statement",
        header: "Enunciado del log",
        render: (row: OwnerAuditLog) => <span className="text-break">{formatLogStatement(row)}</span>,
      },
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
      eyebrow="Owner"
      title="Logs owner"
      description="Eventos operativos enriquecidos con identidad Logto del actor y organización canónica cuando está disponible."
      actions={<Badge bg="success">owner:read</Badge>}
    >
      <PageCard
        title="Logs operativos"
        subtitle="Vista responsive con enunciado comprimido por log. Expande cada evento para ver detalle normal o payload JSON."
        actions={
          <div className="civitas-audit-actions d-flex flex-wrap justify-content-end gap-2">
            <ButtonGroup size="sm" aria-label="Vista de logs">
              <Button variant={viewMode === "friendly" ? "primary" : "outline-secondary"} onClick={() => setViewMode("friendly")}>Normal</Button>
              <Button variant={viewMode === "json" ? "primary" : "outline-secondary"} onClick={() => setViewMode("json")}>JSON</Button>
            </ButtonGroup>
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
          </div>
        }
      >
        <Form.Text className="d-block mb-3">Mostrando {events.length} de {total} logs. Usa los bullets expandidos para diagnosticar sin romper el layout móvil.</Form.Text>
        {isLoading ? (
          <LoadingState title="Cargando logs" description="Consultando eventos owner registrados en Civitas." />
        ) : error ? (
          <ErrorState
            title="No se pudieron cargar los logs"
            message={error}
            action={<Button onClick={retry}>Reintentar</Button>}
          />
        ) : events.length === 0 ? (
          <DataTable
            columns={columns}
            rows={events}
            getRowKey={(row) => row.id}
            emptyTitle="Sin logs"
            emptyDescription="Cuando un owner cree organizaciones o falle una creación relevante, los eventos aparecerán aquí."
          />
        ) : (
          <>
            <div className={viewMode === "friendly" ? "civitas-audit-cards" : "civitas-audit-cards civitas-audit-cards-force"}>
              <AuditLogList rows={events} viewMode={viewMode} />
            </div>
            <div className={viewMode === "friendly" ? "civitas-audit-table mt-4" : "civitas-audit-table d-none"}>
              <DataTable columns={columns} rows={events} getRowKey={(row) => row.id} />
            </div>
          </>
        )}
      </PageCard>
    </PageShell>
  );
}
