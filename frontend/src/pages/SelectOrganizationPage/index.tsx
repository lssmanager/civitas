import { Alert, Badge, Button, Card } from "react-bootstrap";
import { useOrganizationSelectionApi, type SelectableOrganization } from "../../api/organizationSelection";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const getSyncBadge = (status?: string) => {
  if (status === "synced") return <Badge bg="success">Logto sincronizado</Badge>;
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

const getReconciliationLabel = (organization: SelectableOrganization) => {
  const { reconciliation } = organization;

  if (reconciliation.status === "linked") return "Metadata enlazada por id Logto";
  if (reconciliation.status === "name_matched_pending_link") return "Metadata local encontrada por nombre; pendiente de enlazar por id Logto";
  if (reconciliation.status === "metadata_missing") return "Existe en Logto sin metadata local asociada";
  if (reconciliation.status === "conflict") return "Varios perfiles internos coinciden con esta organización real";
  return reconciliation.status;
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
              Organización Logto: {organization.logtoOrganizationId}
            </Card.Subtitle>
          </div>
          <div className="d-flex flex-column align-items-end gap-2">
            {getStatusBadge(profile?.status)}
            {getSyncBadge(organization.syncStatus)}
          </div>
        </div>

        <div className="small text-secondary d-flex flex-column gap-1">
          <span>{subdomain ? `Subdominio: ${subdomain}` : "Sin subdominio local configurado"}</span>
          <span>Último sync exitoso: {formatLastSync(profile?.logtoSyncedAt)}</span>
          <span>{getReconciliationLabel(organization)}</span>
          {organization.reconciliation.profileIds.length > 0 ? (
            <span className="text-break">Perfiles internos asociados: {organization.reconciliation.profileIds.join(", ")}</span>
          ) : null}
        </div>

        {organization.syncError ? (
          <Alert variant={organization.syncStatus === "conflict" ? "warning" : "danger"} className="small py-2 px-3 mb-0">
            {organization.syncError}
          </Alert>
        ) : null}

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
  const unreconciledProfiles = organizationsResource.data?.unreconciledProfiles ?? [];

  return (
    <PageShell
      eyebrow="Organizaciones"
      title="Seleccionar organización"
      description="Elige una organización real de Logto. La metadata local de Civitas se muestra como complemento operativo, no como identidad primaria."
    >
      <PageCard
        title="Organizaciones reales en Logto"
        subtitle="Una card por organización canónica de Logto; los perfiles internos duplicados o incompletos se muestran como estados de reconciliación."
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
            description="Cuando existan organizaciones reales en Logto, aparecerán aquí como identidad canónica para preparar la selección de contexto."
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

      {!organizationsResource.isLoading && !organizationsResource.error && unreconciledProfiles.length > 0 ? (
        <Alert variant="warning" className="mb-0">
          <Alert.Heading className="h6">Perfiles internos sin organización Logto reconciliada</Alert.Heading>
          <p className="mb-2">
            Hay {unreconciledProfiles.length} perfil(es) local(es) que no se muestran como organizaciones separadas porque Logto es la fuente de identidad.
          </p>
          <div className="small text-break">
            {unreconciledProfiles.map((profile) => profile.nameCache ?? profile.id).join(", ")}
          </div>
        </Alert>
      ) : null}
    </PageShell>
  );
}
