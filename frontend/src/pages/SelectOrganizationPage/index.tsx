import { Alert, Badge, Button, Card } from "react-bootstrap";
import { useOrganizationSelectionApi, type SelectableOrganization } from "../../api/organizationSelection";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const getSyncBadge = (status?: string) => {
  if (status === "synced") return <Badge bg="success">Logto sincronizado</Badge>;
  if (status === "error") return <Badge bg="danger">Sync con error</Badge>;
  return <Badge bg="warning" text="dark">Sync pendiente</Badge>;
};

const getStatusBadge = (status?: string) => {
  if (status === "active") return <Badge bg="primary">Activa</Badge>;
  if (!status) return <Badge bg="secondary">Sin estado</Badge>;
  return <Badge bg="secondary">{status}</Badge>;
};

const getOrganizationName = (organization: SelectableOrganization) =>
  organization.name ?? organization.profile?.nameCache ?? "Organización sin nombre";

const formatLastSync = (value?: string | null) => value ? new Date(value).toLocaleString() : "Sin sincronización exitosa";

function OrganizationCard({ organization }: { organization: SelectableOrganization }) {
  const profile = organization.profile;
  const subdomain = profile?.subdomain;
  const logtoSyncStatus = profile?.logtoSyncStatus;

  return (
    <Card className="h-100 border-0 shadow-sm civitas-select-card">
      <Card.Body className="d-flex flex-column gap-3">
        <div className="d-flex justify-content-between gap-3 align-items-start">
          <div>
            <Card.Title className="mb-1">{getOrganizationName(organization)}</Card.Title>
            <Card.Subtitle className="text-secondary small text-break">
              {subdomain ? `Subdominio: ${subdomain}` : "Sin subdominio configurado"}
            </Card.Subtitle>
          </div>
          <div className="d-flex flex-column align-items-end gap-2">
            {getStatusBadge(profile?.status)}
            {getSyncBadge(logtoSyncStatus)}
          </div>
        </div>

        <div className="small text-secondary d-flex flex-column gap-1">
          <span className="text-break">Perfil interno: {profile?.id ?? "No disponible"}</span>
          <span className="text-break">Logto: {organization.logtoOrganizationId ?? "Aún sin id sincronizado"}</span>
          <span>Último sync exitoso: {formatLastSync(profile?.logtoSyncedAt)}</span>
        </div>

        {profile?.logtoSyncError ? (
          <Alert variant="danger" className="small py-2 px-3 mb-0">
            {profile.logtoSyncError}
          </Alert>
        ) : null}

        <div className="mt-auto d-flex flex-column gap-2">
          <Button variant="outline-primary" disabled>
            Entrar cuando el contexto tenant esté disponible
          </Button>
          <p className="text-secondary small mb-0">
            Esta tarjeta ya usa organizaciones reales. La obtención de organization token y navegación tenant-scoped se conectará en una fase posterior.
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
    getKey: () => "selectable-organizations",
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudieron cargar las organizaciones.",
  });

  const organizations = organizationsResource.data?.organizations ?? [];

  return (
    <PageShell
      eyebrow="Organizaciones"
      title="Seleccionar organización"
      description="Elige una organización real registrada en Civitas. El cambio completo de contexto tenant-scoped se habilitará cuando esté disponible el flujo con organization token."
    >
      <PageCard
        title="Organizaciones disponibles"
        subtitle="Datos cargados desde el backend de Civitas y sincronizados con el modelo operativo interno."
      >
        {organizationsResource.isLoading ? (
          <LoadingState title="Cargando organizaciones" description="Consultando organizaciones reales registradas en Civitas." />
        ) : organizationsResource.error ? (
          <ErrorState
            title="No se pudieron cargar las organizaciones"
            message={organizationsResource.error}
            action={<Button onClick={organizationsResource.retry}>Reintentar</Button>}
          />
        ) : organizations.length === 0 ? (
          <EmptyState
            title="Sin organizaciones disponibles"
            description="Cuando owner cree organizaciones y Civitas las persista, aparecerán aquí para preparar la selección de contexto."
          />
        ) : (
          <div className="row g-4">
            {organizations.map((organization) => (
              <div className="col-12 col-lg-6" key={organization.profile?.id ?? organization.logtoOrganizationId ?? getOrganizationName(organization)}>
                <OrganizationCard organization={organization} />
              </div>
            ))}
          </div>
        )}
      </PageCard>
    </PageShell>
  );
}
