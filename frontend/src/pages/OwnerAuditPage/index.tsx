import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "react-bootstrap";
import { ApiRequestError } from "../../api/base";
import { type AuditLog, useAuditApi } from "../../api/audit";
import { OwnerGuard } from "../../guards/OwnerGuard";
import { DataTable, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const PAGE_SIZE = 25;

function getAuditErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) {
      return "Sesión inválida o expirada. Inicia sesión nuevamente para ver la auditoría.";
    }

    if (error.status === 403) {
      return "No tienes permisos owner. El endpoint requiere el scope global owner:read de Logto.";
    }

    if (error.status === 500) {
      return "Error del servidor al cargar auditoría. Intenta nuevamente o revisa el backend.";
    }
  }

  return error instanceof Error ? error.message : "No se pudo cargar la auditoría.";
}

function shortId(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function getOrganizationLabel(log: AuditLog) {
  const organizationName = typeof log.metadata.organizationName === "string" ? log.metadata.organizationName : null;
  const logtoOrganizationId = typeof log.metadata.logtoOrganizationId === "string" ? log.metadata.logtoOrganizationId : null;

  if (organizationName && (log.organizationId || logtoOrganizationId)) {
    return `${organizationName} (${shortId(log.organizationId || logtoOrganizationId)})`;
  }

  return organizationName || shortId(log.organizationId || logtoOrganizationId);
}

function metadataSummary(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && value !== "");

  if (entries.length === 0) {
    return "—";
  }

  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
}

function resultBadge(result: AuditLog["result"]) {
  const variant = result === "success" ? "success" : result === "denied" ? "warning" : "danger";
  return <Badge bg={variant}>{result}</Badge>;
}

function OwnerAuditContent() {
  const { listOwnerAuditLogs } = useAuditApi();
  const listOwnerAuditLogsRef = useRef(listOwnerAuditLogs);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [offset, setOffset] = useState(0);
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    listOwnerAuditLogsRef.current = listOwnerAuditLogs;
  }, [listOwnerAuditLogs]);

  useEffect(() => {
    let isMounted = true;

    async function loadAuditLogs() {
      setIsLoading(true);
      setError(undefined);

      try {
        const response = await listOwnerAuditLogsRef.current({ limit: PAGE_SIZE, offset });
        if (isMounted) {
          setAuditLogs(response.auditLogs);
          setCount(response.pagination.count);
        }
      } catch (loadError) {
        if (isMounted) {
          setAuditLogs([]);
          setCount(0);
          setError(getAuditErrorMessage(loadError));
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
  }, [offset]);

  const columns = useMemo(
    () => [
      { key: "date", header: "Fecha", render: (log: AuditLog) => new Date(log.createdAt).toLocaleString() },
      { key: "actor", header: "Actor", render: (log: AuditLog) => shortId(log.actorUserId) },
      { key: "action", header: "Acción", render: (log: AuditLog) => log.action },
      { key: "result", header: "Resultado", render: (log: AuditLog) => resultBadge(log.result) },
      { key: "organization", header: "Organización", render: (log: AuditLog) => getOrganizationLabel(log) },
      { key: "details", header: "Detalles", render: (log: AuditLog) => <span className="text-secondary small">{metadataSummary(log.metadata)}</span> },
    ],
    []
  );

  return (
    <PageShell
      eyebrow="Owner"
      title="Auditoría"
      description="Eventos críticos mínimos guardados en PostgreSQL. La lectura está protegida por Logto RBAC con owner:read."
      actions={<Badge bg="success">owner:read</Badge>}
    >
      <PageCard
        title="Audit logs"
        subtitle="Ordenados por fecha descendente. Sin filtros avanzados en esta fase."
        actions={
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" disabled={offset === 0 || isLoading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Anterior</Button>
            <Button variant="outline-secondary" disabled={count < PAGE_SIZE || isLoading} onClick={() => setOffset(offset + PAGE_SIZE)}>Siguiente</Button>
          </div>
        }
      >
        {isLoading && <LoadingState title="Cargando auditoría" description="Consultando /owner/audit con access token global de Logto." />}
        {!isLoading && error && <ErrorState title="Error al cargar auditoría" message={error} />}
        {!isLoading && !error && (
          <DataTable
            columns={columns}
            rows={auditLogs}
            getRowKey={(log) => log.id}
            emptyTitle="Sin eventos de auditoría"
            emptyDescription="Aún no hay acciones críticas registradas. Crear una organización generará un evento organization.create."
          />
        )}
      </PageCard>
    </PageShell>
  );
}

export function OwnerAuditPage() {
  return <OwnerGuard>{() => <OwnerAuditContent />}</OwnerGuard>;
}
