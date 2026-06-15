import { Link, useParams } from "react-router-dom";
import { Alert, Badge, Button } from "react-bootstrap";
import { useOwnerApi } from "../api/owner";
import { useStableResource } from "../shared/hooks/useStableResource";
import { ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

export function OwnerOrganizationSettingsPage() {
  const { organizationId = "" } = useParams();
  const ownerApi = useOwnerApi();
  const organizationsResource = useStableResource({
    initialParams: {},
    load: ownerApi.getOrganizations,
    getKey: () => `owner-organization-settings-${organizationId}`,
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudo cargar la configuración preparada.",
  });

  const organization = organizationsResource.data?.organizations.find((item) => item.profile?.id === organizationId || item.logtoOrganizationId === organizationId);
  const profile = organization?.profile;

  return (
    <PageShell
      eyebrow="Owner / Settings"
      title={organization?.name ?? profile?.nameCache ?? "Settings de organización"}
      description="Entrypoint estructural para settings B2B por organización. Logto/API conserva la organización canónica; Civitas prepara solo configuración de producto editable en fases siguientes."
      actions={<Link to="/owner/organizations" className="btn btn-outline-secondary">Volver</Link>}
    >
      {organizationsResource.isLoading ? (
        <LoadingState title="Cargando settings" description="Consultando directorio Logto y configuración Civitas local." />
      ) : organizationsResource.error ? (
        <ErrorState title="No se pudo cargar settings" message={organizationsResource.error} action={<Button onClick={organizationsResource.retry}>Reintentar</Button>} />
      ) : !organization ? (
        <Alert variant="warning">No encontramos la organización solicitada en el directorio owner actual.</Alert>
      ) : (
        <div className="row g-4">
          <div className="col-12 col-lg-6">
            <PageCard title="Identidad canónica" subtitle="Solo lectura en este scaffold; proviene de Logto cuando existe.">
              <dl className="mb-0 small">
                <dt>Logto organization id</dt><dd className="text-break">{organization.logtoOrganizationId ?? "Pendiente"}</dd>
                <dt>Nombre</dt><dd>{organization.name ?? profile?.nameCache ?? "Sin nombre"}</dd>
                <dt>Estado sync</dt><dd><Badge bg={profile?.logtoSyncStatus === "synced" ? "success" : "warning"}>{profile?.logtoSyncStatus ?? "metadata_missing"}</Badge></dd>
              </dl>
            </PageCard>
          </div>
          <div className="col-12 col-lg-6">
            <PageCard title="Configuración preparada" subtitle="Configuración exclusiva de Civitas para el futuro portal organization admin.">
              <dl className="mb-0 small">
                <dt>Slug</dt><dd>{profile?.slug ?? "Sin slug"}</dd>
                <dt>Dominio admin</dt><dd>{profile?.adminDomain ?? "Sin dominio"}</dd>
                <dt>Login experience</dt><dd>{profile?.organizationLoginExperienceEnabled ? "Preparada / habilitada" : "No habilitada"}</dd>
                <dt>Roles predeterminados</dt><dd>{profile?.defaultRoleNames?.join(", ") || "Sin roles configurados"}</dd>
              </dl>
            </PageCard>
          </div>
          <div className="col-12 col-lg-6">
            <PageCard title="Branding" subtitle="No se aplica automáticamente a Logto en este PR; queda listo para settings futuros.">
              <dl className="mb-0 small">
                <dt>Logo URL</dt><dd className="text-break">{profile?.branding?.logoUrl ?? "Sin logo"}</dd>
                <dt>Favicon URL</dt><dd className="text-break">{profile?.branding?.faviconUrl ?? "Sin favicon"}</dd>
                <dt>Color primario</dt><dd>{profile?.branding?.primaryColor ?? "Sin color"}</dd>
                <dt>Color oscuro</dt><dd>{profile?.branding?.primaryColorDark ?? "Sin color"}</dd>
              </dl>
            </PageCard>
          </div>
          <div className="col-12 col-lg-6">
            <PageCard title="OIDC inicial" subtitle="El secreto nunca se devuelve en texto plano; solo se informa si fue configurado.">
              <dl className="mb-0 small">
                <dt>Application ID</dt><dd className="text-break">{profile?.oidcApplicationId ?? "Pendiente"}</dd>
                <dt>Redirect URI</dt><dd className="text-break">{String(profile?.oidcInitialConfig?.redirectUri ?? "Pendiente")}</dd>
                <dt>Secret</dt><dd>{profile?.oidcApplicationSecretConfigured ? "Configurado (redactado)" : "No configurado"}</dd>
                <dt>Dominio email</dt><dd>{profile?.emailDomainProvisioningStatus ?? "not_requested"}</dd>
              </dl>
            </PageCard>
          </div>
        </div>
      )}
    </PageShell>
  );
}
