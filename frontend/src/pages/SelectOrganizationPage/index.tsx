import { Badge, Button, Card } from "react-bootstrap";
import { useOrganizationSelectionApi, type SelectableOrganization } from "../../api/organizationSelection";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const getSyncBadge = (status?: string) => {
  if (status === "synced") return <Badge bg="success">Bootstrap completo</Badge>;
  if (status === "logto_created") return <Badge bg="warning" text="dark">Logto creada</Badge>;
  if (status === "creator_membership_pending") return <Badge bg="warning" text="dark">Membership pendiente</Badge>;
  if (status === "creator_role_pending") return <Badge bg="warning" text="dark">Rol admin pendiente</Badge>;
  if (status === "error") return <Badge bg="danger">Sync con error</Badge>;
  if (status === "metadata_missing") return <Badge bg="warning" text="dark">Metadata faltante</Badge>;
  if (status === "conflict") return <Badge bg="danger">Reconciliación pendiente</Badge>;
  return <Badge bg="warning" text="dark">Sync pendiente</Badge>;
};

const getStatusBadge = (status?: string) => {
  if (status === "active") return <Badge bg="primary">Activa</Badge>;
  if (!status) return <Badge bg="secondary">Sin metadata local</Badge>;
  return <Badge bg="secondary">{status}</Badge>;
};

const getOrganizationName = (organization: SelectableOrganization) => organization.name ?? "Organización sin nombre en Logto";

const formatLastSync = (value?: string | null) => value ? new Date(value).toLocaleString() : "Sin sincronización exitosa";

function OrganizationCard({ organization }: { organization: SelectableOrganization }) {
  const profile = organization.profile;
  const subdomain = profile?.subdomain;

  return (
    <Card className="h-100 border-0 shadow-sm civitas-select-card">
      <Card.Body className="d-flex flex-column gap-3">
        <div className="d-flex justify-content-between gap-3 align-items-start">
          <div>
            <Card.Title className="mb-1">{getOrganizationName(organization)}</Card.Title>
            <Card.Subtitle className="text-secondary small text-break">
              {subdomain ? `Subdominio: ${subdomain}` : "Pendiente de configuración operativa"}
            </Card.Subtitle>
          </div>
          <div className="d-flex flex-column align-items-end gap-2">
            {getStatusBadge(profile?.status)}
            {getSyncBadge(organization.syncStatus)}
          </div>
        </div>

        <div className="small text-secondary d-flex flex-column gap-1">
          <span>Estado de disponibilidad: {organization.syncStatus ?? "pendiente"}</span>
          <span>Último bootstrap completo: {formatLastSync(profile?.logtoSyncedAt)}</span>
        </div>


        <div className="mt-auto d-flex flex-column gap-2">
          <Button variant="outline-primary" disabled>
            Entrar cuando el contexto tenant esté disponible
          </Button>
          <p className="text-secondary small mb-0">
            La identidad visible proviene de Logto. La obtención de organization token y navegación tenant-scoped se conectará en una fase posterior.
          </p>
        </div>
      </Card.Body>
    </Card>
  );
}

export function SelectOrganizationPage() {
  const organizationSelectionApi = useOrganizationSelectionApi();
  const organizationsResource = useStableResource({
    initialParams: {},
    load: organizationSelectionApi.getOrganizations,
    getKey: () => "selectable-logto-organizations",
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudieron cargar las organizaciones de Logto.",
  });

  const organizations = organizationsResource.data?.organizations ?? [];
  return (
    <PageShell
      eyebrow="Organizaciones"
      title="Seleccionar organización"
      description="Elige una organización disponible para preparar el cambio de contexto tenant. Los detalles técnicos viven en Observabilidad."
    >
      <PageCard
        title="Organizaciones disponibles"
        subtitle="Selector operativo para navegación tenant-scoped futura; no es una consola de reconciliación."
      >
        {organizationsResource.isLoading ? (
          <LoadingState title="Cargando organizaciones" description="Consultando organizaciones reales desde Logto y combinando metadata operativa de Civitas." />
        ) : organizationsResource.error ? (
          <ErrorState
            title="No se pudieron cargar las organizaciones de Logto"
            message={organizationsResource.error}
            action={<Button onClick={organizationsResource.retry}>Reintentar</Button>}
          />
        ) : organizations.length === 0 ? (
          <EmptyState
            title="Sin organizaciones en Logto"
            description="Cuando existan organizaciones disponibles, aparecerán aquí para preparar la selección de contexto."
          />
        ) : (
          <div className="row g-4">
            {organizations.map((organization) => (
              <div className="col-12 col-lg-6" key={organization.logtoOrganizationId}>
                <OrganizationCard organization={organization} />
              </div>
            ))}
          </div>
        )}
      </PageCard>
    </PageShell>
  );
}
