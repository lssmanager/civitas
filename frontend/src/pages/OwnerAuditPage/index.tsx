import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, ButtonGroup } from "react-bootstrap";
import { useOwnerApi, type OwnerAuditLog, type OwnerAuditResponse } from "../../api/owner";
import { DataTable, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const PAGE_SIZE = 25;

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

export function OwnerAuditPage() {
  const { getAuditLogs } = useOwnerApi();
  const getAuditLogsRef = useRef(getAuditLogs);
  const [events, setEvents] = useState<OwnerAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAuditLogsRef.current = getAuditLogs;
  }, [getAuditLogs]);

  useEffect(() => {
    let isMounted = true;

    async function loadAuditLogs() {
      setIsLoading(true);
      setError(null);

      try {
        const response: OwnerAuditResponse = await getAuditLogsRef.current({ limit: PAGE_SIZE, offset });

        if (!isMounted) {
          return;
        }

        setEvents(response.auditLogs);
        setTotal(response.pagination.total);
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la auditoría owner.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadAuditLogs();

    return () => {
      isMounted = false;
    };
  }, [offset, refreshNonce]);

  const columns = useMemo(
    () => [
      { key: "createdAt", header: "Fecha", render: (row: OwnerAuditLog) => formatDate(row.createdAt) },
      {
        key: "actor",
        header: "Actor",
        render: (row: OwnerAuditLog) => <span className="text-break">{row.actorUserId ?? "No resuelto"}</span>,
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
        render: (row: OwnerAuditLog) => <span className="text-break">{row.organizationId ?? "Global"}</span>,
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
      title="Auditoría mínima"
      description="Eventos operativos generados por el middleware owner. Esta fase muestra creación de organizaciones y resultados básicos."
      actions={<Badge bg="success">owner:read</Badge>}
    >
      <PageCard
        title="Eventos de auditoría"
        subtitle="Listado paginado con eventos recientes primero. No incluye filtros avanzados ni exportación en esta fase."
        actions={
          <ButtonGroup size="sm" aria-label="Paginación de auditoría">
            <Button variant="outline-secondary" disabled={isLoading || !hasPrevious} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>
              Anterior
            </Button>
            <Button variant="outline-secondary" disabled>
              Página {currentPage}
            </Button>
            <Button variant="outline-secondary" disabled={isLoading || !hasNext} onClick={() => setOffset((current) => current + PAGE_SIZE)}>
              Siguiente
            </Button>
          </ButtonGroup>
        }
      >
        {isLoading ? (
          <LoadingState title="Cargando auditoría" description="Consultando eventos owner registrados en Civitas." />
        ) : error ? (
          <ErrorState
            title="No se pudo cargar la auditoría"
            message={error}
            action={<Button onClick={() => setRefreshNonce((current) => current + 1)}>Reintentar</Button>}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={events}
            getRowKey={(row) => row.id}
            emptyTitle="Sin eventos de auditoría"
            emptyDescription="Cuando un owner cree organizaciones o falle una creación relevante, los eventos aparecerán aquí."
          />
        )}
      </PageCard>
    </PageShell>
  );
}
