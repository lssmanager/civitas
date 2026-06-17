import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Badge, Button, Form } from "react-bootstrap";
import { useOwnerApi } from "../api/owner";
import { useStableResource } from "../shared/hooks/useStableResource";
import { ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

const getFluentCrmBadgeVariant = (status?: string | null) => {
  if (status === "linked") return "success";
  if (status === "conflict" || status === "error") return "danger";
  if (status === "pending") return "warning";
  return "secondary";
};

const formatTimestamp = (value?: string | null) => value ? new Date(value).toLocaleString() : "Nunca";

export function OwnerOrganizationSettingsPage() {
  const { organizationId = "" } = useParams();
  const ownerApi = useOwnerApi();
  const [crmForm, setCrmForm] = useState({ companyName: "", companyEmail: "", companyPhone: "", about: "", website: "", numberOfEmployees: "", industry: "", type: "", companyOwner: "", description: "" });
  const [crmSubmitStatus, setCrmSubmitStatus] = useState<string | null>(null);
  const [crmSubmitError, setCrmSubmitError] = useState<string | null>(null);
  const [contactSyncStatus, setContactSyncStatus] = useState<string | null>(null);
  const [contactSyncError, setContactSyncError] = useState<string | null>(null);
  const organizationsResource = useStableResource({
    initialParams: {},
    load: ownerApi.getOrganizations,
    getKey: () => `owner-organization-settings-${organizationId}`,
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudo cargar la configuración preparada.",
  });

  const organization = organizationsResource.data?.organizations.find((item) => item.profile?.id === organizationId || item.logtoOrganizationId === organizationId);
  const profile = organization?.profile;
  const provisioningState = profile?.settings?.provisioningState && typeof profile.settings.provisioningState === "object" ? profile.settings.provisioningState as Record<string, unknown> : null;
  const requiresResume = Boolean(provisioningState?.requiresResume);
  const updateCrmForm = (field: keyof typeof crmForm, value: string) => setCrmForm((current) => ({ ...current, [field]: value }));
  const handleContactSync = async () => {
    if (!profile?.id && !organization?.logtoOrganizationId) return;
    setContactSyncStatus(null);
    setContactSyncError(null);
    try {
      const result = await ownerApi.syncOrganizationFluentCrmContacts(profile?.id || organization?.logtoOrganizationId || "");
      setContactSyncStatus(`${result.contactSync.status}: ${result.contactSync.succeeded}/${result.contactSync.total} contactos sincronizados, ${result.contactSync.failed} errores, ${result.contactSync.conflicts} conflictos`);
      organizationsResource.retry();
    } catch (error) {
      setContactSyncError(error instanceof Error ? error.message : "No se pudo sincronizar contactos FluentCRM.");
    }
  };

  const handleCrmSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile?.id && !organization?.logtoOrganizationId) return;
    setCrmSubmitStatus(null);
    setCrmSubmitError(null);
    try {
      const result = await ownerApi.updateOrganizationFluentCrm(profile?.id || organization?.logtoOrganizationId || "", {
        ...crmForm,
        numberOfEmployees: crmForm.numberOfEmployees ? Number(crmForm.numberOfEmployees) : undefined,
      });
      setCrmSubmitStatus(result.status);
      organizationsResource.retry();
    } catch (error) {
      setCrmSubmitError(error instanceof Error ? error.message : "No se pudo sincronizar FluentCRM.");
    }
  };

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
                <dt>Estado sync</dt><dd><Badge bg={profile?.logtoSyncStatus === "bootstrapped" || profile?.logtoSyncStatus === "synced" ? "success" : requiresResume ? "danger" : "warning"}>{profile?.logtoSyncStatus ?? "metadata_missing"}</Badge></dd>
                <dt>Bootstrap</dt><dd>{requiresResume ? `Requiere reanudación${provisioningState?.failedStage ? ` desde ${String(provisioningState.failedStage)}` : ""}` : "Completo o sin acción pendiente"}</dd>
              </dl>            </PageCard>
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
            <PageCard title="Vínculo comercial FluentCRM" subtitle="Referencia CRM comercial; Logto sigue siendo la fuente canónica de identidad, roles y membresía.">
              <dl className="mb-0 small">
                <dt>Estado CRM</dt><dd><Badge bg={getFluentCrmBadgeVariant(profile?.fluentcrmSyncStatus)}>{profile?.fluentcrmSyncStatus ?? "not_linked"}</Badge></dd>
                <dt>Company ID</dt><dd className="text-break">{profile?.fluentcrmCompanyId ?? "Sin vincular"}</dd>
                <dt>Última sincronización</dt><dd>{formatTimestamp(profile?.fluentcrmSyncedAt)}</dd>
                {profile?.fluentcrmSyncError ? <><dt>Error CRM</dt><dd className="text-break text-danger">{profile.fluentcrmSyncError}</dd></> : null}
              </dl>

              <Form onSubmit={handleCrmSubmit} className="mt-3 d-flex flex-column gap-2">
                <Form.Group controlId="settingsCrmCompanyName"><Form.Label>Company Name</Form.Label><Form.Control value={crmForm.companyName} onChange={(event) => updateCrmForm("companyName", event.target.value)} placeholder={organization.name ?? profile?.nameCache ?? ""} /></Form.Group>
                <div className="row g-2">
                  <Form.Group className="col-12 col-lg-6" controlId="settingsCrmCompanyEmail"><Form.Label>Company Email</Form.Label><Form.Control type="email" value={crmForm.companyEmail} onChange={(event) => updateCrmForm("companyEmail", event.target.value)} /></Form.Group>
                  <Form.Group className="col-12 col-lg-6" controlId="settingsCrmCompanyPhone"><Form.Label>Company Phone Number</Form.Label><Form.Control value={crmForm.companyPhone} onChange={(event) => updateCrmForm("companyPhone", event.target.value)} /></Form.Group>
                </div>
                <Form.Group controlId="settingsCrmAbout"><Form.Label>About this company</Form.Label><Form.Control as="textarea" rows={2} value={crmForm.about} onChange={(event) => updateCrmForm("about", event.target.value)} /></Form.Group>
                <div className="row g-2">
                  <Form.Group className="col-12 col-lg-6" controlId="settingsCrmWebsite"><Form.Label>Website</Form.Label><Form.Control value={crmForm.website} onChange={(event) => updateCrmForm("website", event.target.value)} placeholder={profile?.adminDomain ?? ""} /></Form.Group>
                  <Form.Group className="col-12 col-lg-6" controlId="settingsCrmEmployees"><Form.Label>Number of Employees</Form.Label><Form.Control type="number" min="0" value={crmForm.numberOfEmployees} onChange={(event) => updateCrmForm("numberOfEmployees", event.target.value)} /></Form.Group>
                </div>
                <div className="row g-2">
                  <Form.Group className="col-12 col-lg-4" controlId="settingsCrmIndustry"><Form.Label>Industry</Form.Label><Form.Control value={crmForm.industry} onChange={(event) => updateCrmForm("industry", event.target.value)} /></Form.Group>
                  <Form.Group className="col-12 col-lg-4" controlId="settingsCrmType"><Form.Label>Type</Form.Label><Form.Control value={crmForm.type} onChange={(event) => updateCrmForm("type", event.target.value)} /></Form.Group>
                  <Form.Group className="col-12 col-lg-4" controlId="settingsCrmOwner"><Form.Label>Company Owner</Form.Label><Form.Control value={crmForm.companyOwner} onChange={(event) => updateCrmForm("companyOwner", event.target.value)} /></Form.Group>
                </div>
                <Form.Group controlId="settingsCrmDescription"><Form.Label>Description</Form.Label><Form.Control as="textarea" rows={2} value={crmForm.description} onChange={(event) => updateCrmForm("description", event.target.value)} /></Form.Group>
                {crmSubmitStatus ? <Alert variant="success" className="mb-0">Estado FluentCRM: {crmSubmitStatus}</Alert> : null}
                {crmSubmitError ? <Alert variant="danger" className="mb-0">{crmSubmitError}</Alert> : null}
                <Button type="submit" variant="outline-primary">Crear o vincular Company en FluentCRM</Button>
              </Form>
              <div className="mt-3 d-flex flex-column gap-2">
                <Button type="button" variant="outline-secondary" onClick={handleContactSync}>Sincronizar contactos por roles Logto</Button>
                <small className="text-secondary">Las tags/lists CRM son segmentación de comunicación; los permisos siguen viniendo de roles organizacionales en Logto.</small>
                {contactSyncStatus ? <Alert variant="success" className="mb-0">{contactSyncStatus}</Alert> : null}
                {contactSyncError ? <Alert variant="danger" className="mb-0">{contactSyncError}</Alert> : null}
              </div>

            </PageCard>
          </div>
          <div className="col-12 col-lg-6">
            <PageCard title="OIDC inicial" subtitle="El secreto nunca se devuelve en texto plano; solo se informa si fue configurado.">
              <dl className="mb-0 small">
                <dt>Application ID</dt><dd className="text-break">{profile?.oidcApplicationId ?? "Pendiente"}</dd>
                <dt>Redirect URI</dt><dd className="text-break">{String(profile?.oidcInitialConfig?.oidcRedirectUri ?? "Pendiente")}</dd>
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
