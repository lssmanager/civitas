import { Badge, Button, Card } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useOrganizationSelectionApi, type SelectableOrganization } from "../../api/organizationSelection";
import { useOwnerApi } from "../../api/owner";
import { actionLabel, compactOperationalState, severityVariant, sourceLabel, statusVariant } from "../../operational/backbone";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const getTerritorialState = (business: Record<string, string | undefined>) => business.state ?? business.department ?? "";
const getOrganizationName = (organization: SelectableOrganization) => organization.name ?? "Organización sin nombre en Logto";

function OrganizationCard({ organization }: { organization: SelectableOrganization }) {
  const ownerApi = useOwnerApi();
  const operational = useStableResource({ initialParams: organization.logtoOrganizationId, load: ownerApi.getOrganizationOperationalState, getKey: (id) => `select-organization-operational-${id}` });
  const profile = organization.profile;
  const canonical = organization.canonical;
  const entryUrl = canonical?.entryUrl || (canonical?.appSubdomain && canonical?.appBaseDomain ? `https://${canonical.appSubdomain}.${canonical.appBaseDomain}` : null);
  const entryHost = entryUrl ? entryUrl.replace(/^https?:\/\//, "") : null;
  const customData = canonical.customData || {};
  const civitasProfile = (customData.civitasProfile && typeof customData.civitasProfile === "object" ? customData.civitasProfile : {}) as { business?: Record<string, string>; contact?: Record<string, string>; branding?: Record<string, string> };
  const business = civitasProfile.business || {};
  const contact = civitasProfile.contact || {};
  const logoUrl = civitasProfile.branding?.lightLogoUrl || civitasProfile.branding?.logoUrl || profile?.branding?.logoUrl || null;
  const addressLine = [business.addressLine1, business.addressLine2].filter(Boolean).join(", ");
  const locationLine = [business.city, getTerritorialState(business), business.country, business.postalCode].filter(Boolean).join(" · ");
  const identityLine = [business.nit, business.verificationDigit].filter(Boolean).join(" · ") || entryHost || organization.logtoOrganizationId;
  const compact = operational.data ? compactOperationalState(operational.data) : null;
  const fallbackStatus = organization.operationalStatus;
  const openApp = (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); if (entryUrl) window.open(entryUrl, "_blank", "noopener,noreferrer"); };

  return (
    <Link className="text-decoration-none text-reset d-block h-100" to={`/owner/organizations/${encodeURIComponent(organization.logtoOrganizationId)}`}>
      <Card className="h-100 border shadow-sm overflow-hidden civitas-select-card civitas-organization-card" role="button">
        <div className="civitas-select-card__hero civitas-organization-card__hero"><div className="civitas-organization-card__identity"><div className="civitas-select-card__logo civitas-organization-card__logo border rounded-3 d-flex flex-column align-items-center justify-content-center text-secondary">{logoUrl ? <img src={logoUrl} alt={`Logo de ${getOrganizationName(organization)}`} className="img-fluid p-3" /> : <><span className="fs-2">⌂</span><span className="small">Logo</span></>}</div><div className="civitas-organization-card__copy"><span className="civitas-select-card__eyebrow">▦ Institución educativa</span><h2 className="h4 fw-bold mb-1">{getOrganizationName(organization)}</h2><p className="mb-0">{identityLine}</p></div></div></div>
        <Card.Body className="civitas-select-card__body p-4">
          <div className="d-flex flex-column gap-3">
            {compact ? (
              <div className="d-flex flex-column gap-2">
                <div className="d-flex flex-wrap gap-2"><Badge bg={statusVariant(compact.canonicalStatus)}>Logto: {compact.canonicalStatus}</Badge><Badge bg={statusVariant(compact.fluentcrmStatus)}>FluentCRM: {compact.fluentcrmStatus}</Badge><Badge bg={statusVariant(compact.wordpressStatus)}>WordPress: {compact.wordpressStatus}</Badge></div>
                <div className="d-flex flex-wrap gap-2"><Badge bg={severityVariant(compact.blocker.severity)}>blocker: {compact.blocker.status}</Badge><Badge bg="light" text="dark">source: {sourceLabel(compact.dominantSource)}</Badge><Badge bg={compact.freshness?.isStale ? "warning" : "success"} text={compact.freshness?.isStale ? "dark" : undefined}>{compact.freshness?.isStale ? "stale" : "fresh"}</Badge></div>
                <p className="small text-secondary mb-0">{compact.blocker.humanMessage || operational.data?.summary.humanMessage}</p>
              </div>
            ) : (
              <div className="d-flex flex-column gap-2"><Badge bg="secondary">fallback local: {fallbackStatus?.text || "estado operativo no proyectado"}</Badge><p className="small text-secondary mb-0">Fallback temporal etiquetado; el contrato operational-state no cargó todavía.</p></div>
            )}
            <div className="d-flex flex-column gap-2 small"><div className="d-flex gap-2 align-items-start"><span className="civitas-select-card__icon align-self-start">⌖</span><span className="fw-semibold">{[addressLine, locationLine].filter(Boolean).join(" · ") || "Ubicación pendiente"}</span></div><div className="d-flex gap-2 align-items-start"><span className="civitas-select-card__icon align-self-start">☏</span><span className="fw-semibold">{contact.phone || "Teléfono pendiente"}</span></div><div className="d-flex gap-2 align-items-start"><span className="civitas-select-card__icon align-self-start">✉</span><span className="fw-semibold text-primary text-break">{contact.email || "Email pendiente"}</span></div></div>
          </div>
        </Card.Body>
        <Card.Footer className="civitas-select-card__footer bg-white p-3"><span className={`btn ${entryUrl ? "btn-primary" : "btn-outline-secondary disabled"} w-100 rounded-3 fw-semibold civitas-select-card__footer-action`} role="button" aria-disabled={!entryUrl} onClick={openApp}>{compact ? (actionLabel[String(compact.nextAction)] ?? compact.nextAction) : "Abrir app"}</span></Card.Footer>
      </Card>
    </Link>
  );
}

export function SelectOrganizationPage() {
  const organizationSelectionApi = useOrganizationSelectionApi();
  const organizationsResource = useStableResource({ initialParams: {}, load: organizationSelectionApi.getOrganizations, getKey: () => "selectable-logto-organizations", getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudieron cargar las organizaciones de Logto." });
  const organizations = organizationsResource.data?.organizations ?? [];
  return <PageShell eyebrow="Organizaciones" title="Seleccionar organización" description="Cada fila lee la misma capa operational-state que la consola owner: Logto canónico, downstream FluentCRM/WordPress, blocker y nextAction estándar."><PageCard title="Directorio canónico de Logto" subtitle="La identidad viene de Logto; badges, blocker y CTA salen del backbone operacional consolidado con fallback local explícito.">{organizationsResource.isLoading ? <LoadingState title="Cargando organizaciones" description="Consultando organizaciones reales desde Logto y combinando operational-state por organización." /> : organizationsResource.error ? <ErrorState title="No se pudieron cargar las organizaciones de Logto" message={organizationsResource.error} action={<Button onClick={organizationsResource.retry}>Reintentar</Button>} /> : organizations.length === 0 ? <EmptyState title="Sin organizaciones en Logto" description="Cuando existan organizaciones reales en Logto, aparecerán aquí como identidad canónica para preparar la selección de contexto." /> : <div className="row g-4">{organizations.map((organization) => <div className="col-12 col-lg-6" key={organization.logtoOrganizationId}><OrganizationCard organization={organization} /></div>)}</div>}</PageCard></PageShell>;
}
