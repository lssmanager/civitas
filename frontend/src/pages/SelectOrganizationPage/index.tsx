import { Badge, Button, Card } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useOrganizationSelectionApi, type SelectableOrganization } from "../../api/organizationSelection";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const getStatusVariant = (summary?: string) => {
  if (!summary || summary === "ok") return "civitas-status-badge--active";
  if (summary.includes("falla")) return "civitas-status-badge--danger";
  return "civitas-status-badge--warning";
};

const getTerritorialState = (business: Record<string, string | undefined>) => business.state ?? business.department ?? "";

const getOrganizationName = (organization: SelectableOrganization) => organization.name ?? "Organización sin nombre en Logto";

const getComponentState = (organization: SelectableOrganization, key: string) =>
  organization.operationalStatus?.components.find((component) => component.key === key)?.state ?? "ok";

const formatCrmCompanyState = (organization: SelectableOrganization) => {
  const status = organization.profile?.fluentcrmSyncStatus;
  if (!organization.profile?.fluentcrmCompanyId && (status === "not_linked" || status === "pending")) return "faltante";
  if (status === "error" || status === "conflict") return "error";
  if (status === "pending") return "pendiente";
  return organization.profile?.fluentcrmCompanyId ? "ok" : "pendiente";
};

function OrganizationCard({ organization }: { organization: SelectableOrganization }) {
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
  const operationalStatus = organization.operationalStatus ?? { base: profile?.status === "suspended" ? "Suspendida" : "Activa", summary: "ok", text: `${profile?.status === "suspended" ? "Suspendida" : "Activa"} · ok`, components: [] };
  const logsUrl = `/owner/logs?organizationId=${encodeURIComponent(organization.logtoOrganizationId)}`;
  const organizationUrl = `/owner/organizations/${encodeURIComponent(organization.logtoOrganizationId)}`;
  const requiresHumanAction = operationalStatus.components.some((component) => component.state === "failure" || /human|hitl|manual/i.test(component.detail || ""));
  const retryState = operationalStatus.components.find((component) => component.state === "pending")?.detail || (operationalStatus.summary === "ok" ? "none" : operationalStatus.summary);
  const canRetry = operationalStatus.components.some((component) => component.state === "pending" || component.state === "failure") || formatCrmCompanyState(organization) !== "ok";
  const openApp = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (entryUrl) window.open(entryUrl, "_blank", "noopener,noreferrer");
  };

  return (
      <Card className="h-100 border shadow-sm overflow-hidden civitas-select-card civitas-organization-card">
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
        <Card.Body className="civitas-select-card__body p-4">
          <div className="d-flex flex-column gap-3">
            <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap civitas-select-card__status">
              <Badge className={`civitas-status-badge ${getStatusVariant(operationalStatus.summary)}`}>{operationalStatus.text}</Badge>
              {entryHost ? <span className="small text-secondary text-break">{entryHost}</span> : null}
            </div>
            <div className="d-flex flex-column gap-2 small">
              <div className="rounded-3 border bg-light p-2">
                <div className="fw-bold mb-1">Resumen operativo</div>
                <div>Logto: {getComponentState(organization, "logto")}</div>
                <div>FluentCRM company: {formatCrmCompanyState(organization)}</div>
                <div>FluentCRM contact: {getComponentState(organization, "users")}</div>
                <div>Último retry: {retryState}</div>
                <div>Acción humana requerida: {requiresHumanAction ? "sí" : "no"}</div>
              </div>
              <div className="d-flex gap-2 align-items-start">
                <span className="civitas-select-card__icon align-self-start">⌖</span>
                <span className="fw-semibold">{[addressLine, locationLine].filter(Boolean).join(" · ") || "Ubicación pendiente"}</span>
              </div>
              <div className="d-flex gap-2 align-items-start">
                <span className="civitas-select-card__icon align-self-start">☏</span>
                <span className="fw-semibold">{contact.phone || "Teléfono pendiente"}</span>
              </div>
              <div className="d-flex gap-2 align-items-start">
                <span className="civitas-select-card__icon align-self-start">✉</span>
                <span className="fw-semibold text-primary text-break">{contact.email || "Email pendiente"}</span>
              </div>
            </div>
          </div>
        </Card.Body>
        <Card.Footer className="civitas-select-card__footer bg-white p-3">
          <div className="row g-2">
            <div className="col-12 col-md-6"><span className={`btn ${entryUrl ? "btn-primary" : "btn-outline-secondary disabled"} w-100 rounded-3 fw-semibold civitas-select-card__footer-action`} role="button" aria-disabled={!entryUrl} onClick={openApp}>Abrir app</span></div>
            <div className="col-12 col-md-6"><Link className="btn btn-outline-secondary w-100 rounded-3 fw-semibold civitas-select-card__footer-action" to={organizationUrl}>Ver organización</Link></div>
            <div className="col-12 col-md-6"><Link className="btn btn-outline-primary w-100 rounded-3 fw-semibold civitas-select-card__footer-action" to={logsUrl}>Ver logs</Link></div>
            <div className="col-12 col-md-6"><Link className={`btn ${canRetry ? "btn-warning" : "btn-outline-secondary disabled"} w-100 rounded-3 fw-semibold civitas-select-card__footer-action`} aria-disabled={!canRetry} to={`${logsUrl}${canRetry ? "&retryable=true" : ""}`}>Reintentar</Link></div>
          </div>
        </Card.Footer>
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
    </PageShell>
  );
}
