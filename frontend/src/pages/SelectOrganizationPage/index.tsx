import { Alert, Badge, Button, Card } from "react-bootstrap";
import { Link } from "react-router-dom";
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


function OrganizationCard({ organization }: { organization: SelectableOrganization }) {
  const profile = organization.profile;
  const canonical = organization.canonical;
  const subdomain = canonical?.appSubdomain || profile?.subdomain || canonical?.slug;
  const entryHost = subdomain ? `${subdomain}.learnsocialstudies.com` : null;
  const customData = canonical.customData || {};
  const civitasProfile = (customData.civitasProfile && typeof customData.civitasProfile === "object" ? customData.civitasProfile : {}) as { business?: Record<string, string>; contact?: Record<string, string>; branding?: Record<string, string> };
  const business = civitasProfile.business || {};
  const contact = civitasProfile.contact || {};
  const logoUrl = civitasProfile.branding?.lightLogoUrl || civitasProfile.branding?.logoUrl || profile?.branding?.logoUrl || null;
  const addressLine = [business.addressLine1, business.addressLine2].filter(Boolean).join(', ');
  const locationLine = [business.city, business.department, business.country, business.postalCode].filter(Boolean).join(' · ');
  const nit = [business.nit, business.verificationDigit].filter(Boolean).join(' · Establecimiento ');

  return (
    <Link className="text-decoration-none text-reset d-block h-100" to={`/owner/organizations/${encodeURIComponent(organization.logtoOrganizationId)}`}>
      <Card className="h-100 border shadow-sm overflow-hidden civitas-select-card" role="button">
        <div className="bg-primary text-white p-4">
          <span className="badge rounded-pill text-bg-light bg-opacity-25 border border-light border-opacity-25 mb-3">▦ Institución educativa</span>
          <h2 className="h4 fw-bold mb-1">{getOrganizationName(organization)}</h2>
          <p className="mb-0 opacity-75">{nit ? `NIT ${nit}` : entryHost ?? organization.logtoOrganizationId}</p>
        </div>
        <Card.Body className="p-0">
          <div className="row g-0 h-100">
            <div className="col-12 col-md-4 bg-light border-end d-flex align-items-center justify-content-center p-4">
              <div className="border rounded-3 d-flex flex-column align-items-center justify-content-center text-secondary" style={{ width: 128, height: 128 }}>{logoUrl ? <img src={logoUrl} alt={`Logo de ${getOrganizationName(organization)}`} className="img-fluid p-3" /> : <><span className="fs-2">⌂</span><span className="small">Logo</span></>}</div>
            </div>
            <div className="col-12 col-md-8 p-4 d-flex flex-column gap-3">
              <div className="d-flex justify-content-end gap-2">{getStatusBadge(profile?.status)}{getSyncBadge(organization.syncStatus)}</div>
              <div className="d-flex gap-3 pb-3 border-bottom"><span className="badge text-bg-primary bg-opacity-10 text-primary rounded-3 align-self-start">⌖</span><div><p className="text-uppercase text-secondary small fw-bold mb-1">Dirección</p><p className="fw-semibold mb-0">{addressLine || "Dirección pendiente"}</p><p className="fw-semibold mb-0">{locationLine || "Ubicación pendiente"}</p></div></div>
              <div className="d-flex gap-3 pb-3 border-bottom"><span className="badge text-bg-primary bg-opacity-10 text-primary rounded-3 align-self-start">☏</span><div><p className="text-uppercase text-secondary small fw-bold mb-1">Teléfono</p><p className="fw-semibold mb-0">{contact.phone || "Teléfono pendiente"}</p></div></div>
              <div className="d-flex gap-3"><span className="badge text-bg-primary bg-opacity-10 text-primary rounded-3 align-self-start">✉</span><div><p className="text-uppercase text-secondary small fw-bold mb-1">Correo electrónico</p><p className="fw-semibold text-primary mb-0 text-break">{contact.email || "Email pendiente"}</p></div></div>
              {organization.syncError ? <Alert variant={organization.syncStatus === "conflict" ? "warning" : "danger"} className="small py-2 px-3 mb-0">{organization.syncError}</Alert> : null}
            </div>
          </div>
        </Card.Body>
        <Card.Footer className="bg-white p-3"><div className="row g-2"><div className="col-12 col-md-6"><span className="btn btn-primary w-100 rounded-3 fw-semibold">{entryHost ? `URL ${entryHost}` : "URL pendiente"}</span></div><div className="col-12 col-md-6"><span className="btn btn-primary w-100 rounded-3 fw-semibold">Abrir consola</span></div></div></Card.Footer>
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
