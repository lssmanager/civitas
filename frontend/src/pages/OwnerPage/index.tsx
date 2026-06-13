import { Badge, Button } from "react-bootstrap";
import { ownerWorkspaces, type OwnerWorkspace } from "../../navigation/mockData";
import { DataTable, EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";
import type { DataTableColumn } from "../../shared/ui";

const columns: DataTableColumn<OwnerWorkspace>[] = [
  {
    key: "name",
    header: "Espacio",
    render: (workspace) => <span className="fw-semibold">{workspace.name}</span>,
  },
  {
    key: "status",
    header: "Estado",
    render: (workspace) => <Badge bg={workspace.status === "Activo" ? "success" : "secondary"}>{workspace.status}</Badge>,
  },
  {
    key: "updatedAt",
    header: "Actualizado",
    render: (workspace) => workspace.updatedAt,
    className: "text-nowrap",
  },
];

export function OwnerPage() {
  return (
    <PageShell
      eyebrow="Owner"
      title="Panel principal local"
      description="Vista base para validar layout, navegación y componentes compartidos sin backend ni autenticación."
      actions={<Button variant="primary">Acción mock</Button>}
    >
      <div className="row g-4">
        <div className="col-12 col-xl-8">
          <PageCard
            title="Espacios mock"
            subtitle="Tabla reutilizable renderizando columnas y filas locales."
          >
            <DataTable
              columns={columns}
              rows={ownerWorkspaces}
              getRowKey={(workspace) => workspace.id}
            />
          </PageCard>
        </div>
        <div className="col-12 col-xl-4">
          <div className="d-flex flex-column gap-4">
            <PageCard title="Estado de carga" subtitle="Componente genérico LoadingState.">
              <LoadingState title="Preparando UI" description="Estado demo sin petición de red activa." />
            </PageCard>
            <PageCard title="Error visual" subtitle="Componente genérico ErrorState.">
              <ErrorState
                title="Error mock controlado"
                message="Este mensaje valida la apariencia del estado de error sin disparar lógica real."
              />
            </PageCard>
          </div>
        </div>
        <div className="col-12">
          <PageCard title="Estado vacío" subtitle="Componente genérico EmptyState reutilizable.">
            <EmptyState
              title="Sin acciones pendientes"
              description="El estado vacío queda disponible para cualquier página futura de Civitas."
            />
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}
