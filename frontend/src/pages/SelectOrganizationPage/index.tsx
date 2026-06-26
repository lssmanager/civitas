import { Alert, Badge, Button, Card } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useOrganizationSelectionApi, type SelectableOrganization } from "../../api/organizationSelection";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const getSyncBadge = (status?: string) => {
  if (status === "synced") return <Badge className="civitas-status-badge civitas-status-badge--success">Bootstrap completo</Badge>;
  if (status === "logto_created") return <Badge className="civitas-status-badge civitas-status-badge--warning">Logto creada</Badge>;
  if (status === "creator_membership_pending") return <Badge className="civitas-status-badge civitas-status-badge--warning">Membership pendiente</Badge>;
  if (status === "creator_role_pending") return <Badge className="civitas-status-badge civitas-status-badge--warning">Rol admin pendiente</Badge>;
  if (status === "error") return <Badge className="civitas-status-badge civitas-status-badge--danger">Sync con error</Badge>;
  if (status === "metadata_missing") return <Badge className="civitas-status-badge civitas-status-badge--warning">Metadata faltante</Badge>;
  if (status === "conflict") return <Badge className="civitas-status-badge civitas-status-badge--danger">Reconciliación pendiente</Badge>;
  return <Badge className="civitas-status-badge civitas-status-badge--warning">Sync pendiente</Badge>;
};

const getStatusBadge = (status?: string) => {
  if (status === "active") return <Badge className="civitas-status-badge civitas-status-badge--active">Activa</Badge>;
  if (!status) return <Badge className="civitas-status-badge civitas-status-badge--neutral">Sin metadata local</Badge>;
  return <Badge className="civitas-status-badge civitas-status-badge--neutral">{status}</Badge>;
};

const getOrganizationName = (organization: SelectableOrganization) => organization.name ?? "Organización sin nombre en Logto";

function OrganizationCard({ organization }: { organization: SelectableOrganization }) {
  const profile = organization.profile;
  const canonical = organization.canonical;
  const entryUrl = canonical?.entryUrl || null;
  const entryHost = entryUrl ? entryUrl.replace(/^https?:\/\//, "") : null;
  const customData = canonical.customData || {};
  const civitasProfile = (customData.civitasProfile && typeof customData.civitasProfile === "object" ? customData.civitasProfile : {}) as { business?: Record<string, string>; contact?: Record<string, string>; branding?: Record<string, string> };
  const business = civitasProfile.business || {};
  const contact = civitasProfile.contact || {};
  const logoUrl = civitasProfile.branding?.lightLogoUrl || civitasProfile.branding?.logoUrl || profile?.branding?.logoUrl || null;
  const addressLine = [business.addressLine1, business.addressLine2].filter(Boolean).join(", ");
  const locationLine = [business.city, business.department, business.country, business.postalCode].filter(Boolean).join(" · ");
  const identityLine = [business.nit, business.verificationDigit].filter(Boolean).join(" · ") || entryHost || organization.logtoOrganizationId;

  return (
    <Link className="text-decoration-none text-reset d-block h-100" to={`/owner/organizations/${encodeURIComponent(organization.logtoOrganizationId)}`}>
      <Card className="h-100 border shadow-sm overflow-hidden civitas-select-card civitas-organization-card" role="button">
        <div className="civitas-select-card__hero civitas-organization-card__hero">
          <div className="civitas-organization-card__identity">
            <div className="civitas-select-card__logo civitas-organization-card__logo border rounded-3 d-flex flex-column align-items-center justify-content-center text-secondary">
              {logoUrl ? (
                <img src={logoUrl} alt={`Logo de ${getOrganizationName(organization)}`} className="img-fluid p-3" />
              ) : (
                <>
                  <span className="fs-2">⌂</span>
                  <span className="small">Logo</span>
                </>
              )}
            </div>
            <div className="civitas-organization-card__copy">
              <span className="civitas-select-card__eyebrow">▦ Institución educativa</span>
              <h2 className="h4 fw-bold mb-1">{getOrganizationName(organization)}</h2>
              <p className="mb-0">{identityLine}</p>
            </div>
          </div>
        </div>
        <Card.Body className="p-0 civitas-select-card__body">
          <div className="row g-0 h-100">
            <div className="col-12 p-4 d-flex flex-column gap-3">
              <div className="d-flex justify-content-end gap-2 flex-wrap civitas-select-card__status">
                {getStatusBadge(profile?.status)}
                {getSyncBadge(organization.syncStatus)}
              </div>
              <div className="row g-3">
                <div className="col-12 col-xl-6">
                  <div className="d-flex gap-3 pb-3 border-bottom h-100">
                    <span className="civitas-select-card__icon align-self-start">⌖</span>
                    <div>
                      <p className="text-uppercase text-secondary small fw-bold mb-1">Dirección</p>
                      <p className="fw-semibold mb-0">{addressLine || "Dirección pendiente"}</p>
                      <p className="fw-semibold mb-0">{locationLine || "Ubicación pendiente"}</p>
                    </div>
                  </div>
                </div>
                <div className="col-12 col-xl-6">
                  <div className="d-flex gap-3 pb-3 border-bottom h-100">
                    <span className="civitas-select-card__icon align-self-start">☏</span>
                    <div>
                      <p className="text-uppercase text-secondary small fw-bold mb-1">Teléfono</p>
                      <p className="fw-semibold mb-0">{contact.phone || "Teléfono pendiente"}</p>
                    </div>
                  </div>
                </div>
                <div className="col-12">
                  <div className="d-flex gap-3">
                    <span className="civitas-select-card__icon align-self-start">✉</span>
                    <div>
                      <p className="text-uppercase text-secondary small fw-bold mb-1">Correo electrónico</p>
                      <p className="fw-semibold text-primary mb-0 text-break">{contact.email || "Email pendiente"}</p>
                    </div>
                  </div>
                </div>
              </div>
              {organization.syncError ? (
                <Alert variant={organization.syncStatus === "conflict" ? "warning" : "danger"} className="small py-2 px-3 mb-0">
                  {organization.syncError}
                </Alert>
              ) : null}
            </div>
          </div>
        </Card.Body>
        <Card.Footer className="civitas-select-card__footer bg-white p-3">
          <div className="row g-2">
            <div className="col-12 col-md-6">
              <span className="btn btn-outline-primary w-100 rounded-3 fw-semibold civitas-select-card__footer-action">
                Sitio web
              </span>
            </div>
            <div className="col-12 col-md-6">
              <span className="btn btn-primary w-100 rounded-3 fw-semibold civitas-select-card__footer-action">
                Abrir consola
              </span>
            </div>
          </div>
        </Card.Footer>
      </Card>
    </Link>
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
  const reconciliationIncidents = organizationsResource.data?.reconciliationIncidents ?? [];
  const unreconciledProfiles = organizationsResource.data?.unreconciledProfiles ?? [];

  return (
    <PageShell
      eyebrow="Organizaciones"
      title="Seleccionar organización"
      description="Elige una organización real de Logto. La metadata local de Civitas se muestra como complemento operativo, no como identidad primaria."
    >
      <PageCard
        title="Directorio canónico de Logto"
        subtitle="Cada card representa una organización real; los estados de Civitas aparecen como capa operativa y de reconciliación, sin duplicar la identidad."
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

      {!organizationsResource.isLoading && !organizationsResource.error && reconciliationIncidents.length > 0 ? (
        <Alert variant="warning" className="mb-0">
          <Alert.Heading className="h6">Incidentes de reconciliación fuera del directorio operativo</Alert.Heading>
          <p className="mb-2">
            Hay {reconciliationIncidents.length} perfil(es) local(es) archivados o mantenidos solo para observabilidad; no contaminan el catálogo canónico porque Logto es la fuente real de identidad.
          </p>
          <div className="small text-break d-flex flex-column gap-1">
            {reconciliationIncidents.map((incident) => (
              <span key={incident.profile.id}>
                {incident.profile.nameCache ?? incident.profile.id} · {incident.type} · {incident.policy}
              </span>
            ))}
          </div>
        </Alert>
      ) : !organizationsResource.isLoading && !organizationsResource.error && unreconciledProfiles.length > 0 ? (
        <Alert variant="warning" className="mb-0">
          <Alert.Heading className="h6">Perfiles internos fuera del directorio operativo</Alert.Heading>
          <p className="mb-2">
            Hay {unreconciledProfiles.length} perfil(es) local(es) que se conservan para auditoría/compatibilidad, pero no se muestran como organizaciones canónicas.
          </p>
          <div className="small text-break">
            {unreconciledProfiles.map((profile) => profile.nameCache ?? profile.id).join(", ")}
          </div>
        </Alert>
      ) : null}
    </PageShell>
  );
}
