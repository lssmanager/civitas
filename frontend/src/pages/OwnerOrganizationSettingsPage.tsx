import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Badge, Button, Form, Nav } from "react-bootstrap";
import { useOwnerApi } from "../api/owner";
import { useAuthorization } from "../authz/useAuthorization";
import { useStableResource } from "../shared/hooks/useStableResource";
import { ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

const getFluentCrmBadgeVariant = (status?: string | null) => {
  if (status === "linked") return "success";
  if (status === "conflict" || status === "error") return "danger";
  if (status === "pending") return "warning";
  return "secondary";
};

const formatTimestamp = (value?: string | null) => value ? new Date(value).toLocaleString() : "Nunca";

type BrandingTabKey = "logos" | "light" | "dark";

const getBrandingValue = (branding: Record<string, string | null | undefined> | null | undefined, key: string, fallbackKey?: string) => {
  const value = branding?.[key] || (fallbackKey ? branding?.[fallbackKey] : null);
  return value || "Sin configurar";
};

export function OwnerOrganizationSettingsPage() {
  const { organizationId = "" } = useParams();
  const ownerApi = useOwnerApi();
  const { canExecute } = useAuthorization();
  const canManageIntegrations = canExecute("owner.integrations.manage");
  const canSyncCommercial = canExecute("owner.organization.commercial.sync");
  const canDeprovisionMember = canExecute("owner.organization.member.deprovision");
  const [crmForm, setCrmForm] = useState({ companyName: "", companyEmail: "", companyPhone: "", about: "", website: "", numberOfEmployees: "", industry: "", type: "", companyOwner: "", description: "" });
  const [crmSubmitStatus, setCrmSubmitStatus] = useState<string | null>(null);
  const [crmSubmitError, setCrmSubmitError] = useState<string | null>(null);
  const [contactSyncStatus, setContactSyncStatus] = useState<string | null>(null);
  const [contactSyncError, setContactSyncError] = useState<string | null>(null);
  const [deprovisionUserId, setDeprovisionUserId] = useState("");
  const [brandingTab, setBrandingTab] = useState<BrandingTabKey>("logos");
  const [deprovisionStatus, setDeprovisionStatus] = useState<string | null>(null);
  const [deprovisionError, setDeprovisionError] = useState<string | null>(null);
  const organizationsResource = useStableResource({
    initialParams: {},
    load: ownerApi.getOrganizations,
    getKey: () => `owner-organization-settings-${organizationId}`,
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudo cargar la configuración preparada.",
  });
  const commercialResource = useStableResource({
    initialParams: {},
    load: () => ownerApi.getOrganizationCommercialStatus(organizationId),
    getKey: () => `owner-organization-commercial-${organizationId}`,
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudo cargar estado comercial.",
  });

  const organization = organizationsResource.data?.organizations.find((item) => item.profile?.id === organizationId || item.logtoOrganizationId === organizationId);
  const profile = organization?.profile;
  const branding = profile?.branding as Record<string, string | null | undefined> | null | undefined;
  const provisioningState = profile?.settings?.provisioningState && typeof profile.settings.provisioningState === "object" ? profile.settings.provisioningState as Record<string, unknown> : null;
  const requiresResume = Boolean(provisioningState?.requiresResume);
  const updateCrmForm = (field: keyof typeof crmForm, value: string) => setCrmForm((current) => ({ ...current, [field]: value }));
  const handleContactSync = async () => {
    if (!canManageIntegrations || (!profile?.id && !organization?.logtoOrganizationId)) return;
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
    if (!canSyncCommercial || (!profile?.id && !organization?.logtoOrganizationId)) return;
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
  const handleDeprovisionSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const targetOrganizationId = profile?.id || organization?.logtoOrganizationId || "";
    if (!canDeprovisionMember || !targetOrganizationId || !deprovisionUserId.trim()) return;
    setDeprovisionStatus(null);
    setDeprovisionError(null);
    try {
      const result = await ownerApi.deprovisionOrganizationMember(targetOrganizationId, deprovisionUserId.trim());
      const cleanupLabel = result.fluentcrm.strategy === "hard_delete"
        ? "cleanup completed: contacto eliminado en FluentCRM"
        : result.fluentcrm.strategy === "no_contact_found"
          ? "no CRM contact found"
          : result.fluentcrm.strategy === "dissociate_only"
            ? "dissociated only: se removieron asociaciones/listas/tags de esta organización"
            : result.fluentcrm.strategy;
      setDeprovisionStatus(`${result.status}; Logto membership: ${result.logto.membership}; CRM: ${cleanupLabel}. Roles globales mutados: ${result.logto.globalRolesMutated ? "sí" : "no"}.`);
      organizationsResource.retry();
    } catch (error) {
      setDeprovisionError(error instanceof Error ? error.message : "No se pudo dar de baja al usuario.");
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
                <dt>Estado sync</dt><dd><Badge bg={profile?.logtoSyncStatus === "bootstrapped" || profile?.logtoSyncStatus === "synced" ? "success" : requiresResume ? "danger" : "warning"}>{profile?.logtoSyncStatus ?? "local_profile_missing"}</Badge></dd>
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
            <PageCard title="Branding" subtitle="Alineado con la consola de organización: logos largos, marcas cortas y favicons separados por tema. Los logos cortos usan las claves lightMarkUrl y darkMarkUrl; no se reutiliza faviconUrl.">
              <Nav variant="tabs" activeKey={brandingTab} onSelect={(key) => setBrandingTab((key as BrandingTabKey) || "logos")} className="mb-3 small">
                <Nav.Item><Nav.Link eventKey="logos">Logos</Nav.Link></Nav.Item>
                <Nav.Item><Nav.Link eventKey="light">Tema claro</Nav.Link></Nav.Item>
                <Nav.Item><Nav.Link eventKey="dark">Tema oscuro</Nav.Link></Nav.Item>
              </Nav>
              {brandingTab === "logos" ? (
                <dl className="mb-0 small">
                  <dt>Logo largo light <code>lightLogoUrl</code></dt><dd className="text-break">{getBrandingValue(branding, "lightLogoUrl", "logoUrl")}</dd>
                  <dt>Logo largo dark <code>darkLogoUrl</code></dt><dd className="text-break">{getBrandingValue(branding, "darkLogoUrl")}</dd>
                  <dt>Logo corto/fingerprint light <code>lightMarkUrl</code></dt><dd className="text-break">{getBrandingValue(branding, "lightMarkUrl")}</dd>
                  <dt>Logo corto/fingerprint dark <code>darkMarkUrl</code></dt><dd className="text-break">{getBrandingValue(branding, "darkMarkUrl")}</dd>
                </dl>
              ) : brandingTab === "light" ? (
                <dl className="mb-0 small">
                  <dt>Logo largo light <code>lightLogoUrl</code></dt><dd className="text-break">{getBrandingValue(branding, "lightLogoUrl", "logoUrl")}</dd>
                  <dt>Logo corto/fingerprint light <code>lightMarkUrl</code></dt><dd className="text-break">{getBrandingValue(branding, "lightMarkUrl")}</dd>
                  <dt>Favicon light <code>lightFaviconUrl</code></dt><dd className="text-break">{getBrandingValue(branding, "lightFaviconUrl", "faviconUrl")}</dd>
                  <dt>Color primario light</dt><dd>{getBrandingValue(branding, "lightPrimaryColor", "primaryColor")}</dd>
                </dl>
              ) : (
                <dl className="mb-0 small">
                  <dt>Logo largo dark <code>darkLogoUrl</code></dt><dd className="text-break">{getBrandingValue(branding, "darkLogoUrl")}</dd>
                  <dt>Logo corto/fingerprint dark <code>darkMarkUrl</code></dt><dd className="text-break">{getBrandingValue(branding, "darkMarkUrl")}</dd>
                  <dt>Favicon dark <code>darkFaviconUrl</code></dt><dd className="text-break">{getBrandingValue(branding, "darkFaviconUrl")}</dd>
                  <dt>Color primario dark</dt><dd>{getBrandingValue(branding, "darkPrimaryColor", "primaryColorDark")}</dd>
                </dl>
              )}
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

              <Form onSubmit={handleCrmSubmit} className="mt-3 d-flex flex-column gap-2"><fieldset disabled={!canSyncCommercial} className="d-flex flex-column gap-2">
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
                </fieldset><Button type="submit" variant="outline-primary" disabled={!canSyncCommercial}>{canSyncCommercial ? "Crear o vincular Company en FluentCRM" : "Solo lectura"}</Button>
              </Form>
              <div className="mt-3 d-flex flex-column gap-2">
                <Button type="button" variant="outline-secondary" disabled={!canManageIntegrations} onClick={handleContactSync}>{canManageIntegrations ? "Sincronizar contactos por roles Logto" : "Solo lectura"}</Button>
                <small className="text-secondary">Las tags/lists CRM son segmentación de comunicación; los permisos siguen viniendo de roles organizacionales en Logto.</small>
                {contactSyncStatus ? <Alert variant="success" className="mb-0">{contactSyncStatus}</Alert> : null}
                {contactSyncError ? <Alert variant="danger" className="mb-0">{contactSyncError}</Alert> : null}
              </div>

            </PageCard>
          </div>
          <div className="col-12 col-lg-6">
            <PageCard title="Estado comercial y seats" subtitle="Estado operativo mínimo en Civitas: seats contratados, consumo y último evento aplicado. No replica el CRM completo.">
              {commercialResource.isLoading ? (
                <LoadingState title="Cargando estado comercial" description="Consultando seats Civitas y consumo de membresías Logto." />
              ) : commercialResource.error ? (
                <Alert variant="warning">{commercialResource.error}</Alert>
              ) : (
                <dl className="mb-0 small">
                  <dt>Plan / producto</dt><dd>{String(commercialResource.data?.commercial?.plan ?? commercialResource.data?.commercial?.product ?? "Sin evento comercial")}</dd>
                  <dt>Estado comercial</dt><dd><Badge bg={commercialResource.data?.commercial?.status === "active" ? "success" : commercialResource.data?.commercial?.status === "action_required" ? "warning" : "secondary"}>{String(commercialResource.data?.commercial?.status ?? "unknown")}</Badge></dd>
                  <dt>Acceso organizacional</dt><dd>{String(commercialResource.data?.commercial?.accessStatus ?? "unknown")}</dd>
                  <dt>Seats contratados</dt><dd>{commercialResource.data?.seatTotal ?? profile?.seatTotal ?? 0}</dd>
                  <dt>Seats consumidos</dt><dd>{commercialResource.data?.seatsConsumed ?? String(commercialResource.data?.commercial?.seatsConsumed ?? "No calculado")}</dd>
                  <dt>Seats disponibles</dt><dd>{commercialResource.data?.seatsAvailable ?? String(commercialResource.data?.commercial?.seatsAvailable ?? "No calculado")}</dd>
                  <dt>Último evento</dt><dd>{String(commercialResource.data?.commercial?.lastEventType ?? "Sin eventos")} / {String(commercialResource.data?.commercial?.lastEventId ?? "n/a")}</dd>
                  <dt>Último error</dt><dd className="text-break text-danger">{String(commercialResource.data?.commercial?.lastError ?? "Sin errores")}</dd>
                </dl>
              )}
            </PageCard>
          </div>
          <div className="col-12 col-lg-6">
            <PageCard title="Baja de usuario y limpieza CRM" subtitle="Acción explícita y auditable: Logto baja la membresía; FluentCRM recibe limpieza downstream sin convertirse en autoridad de permisos.">
              <Form onSubmit={handleDeprovisionSubmit} className="d-flex flex-column gap-2"><fieldset disabled={!canDeprovisionMember} className="d-flex flex-column gap-2">
                <Form.Group controlId="settingsDeprovisionLogtoUserId">
                  <Form.Label>Logto user id</Form.Label>
                  <Form.Control value={deprovisionUserId} onChange={(event) => setDeprovisionUserId(event.target.value)} placeholder="user_..." />
                  <Form.Text>La baja no muta roles globales como owner_global. Si FluentCRM solo permite disociar, Civitas no mostrará “datos eliminados”.</Form.Text>
                </Form.Group>
                </fieldset><Button type="submit" variant="outline-danger" disabled={!canDeprovisionMember || !deprovisionUserId.trim()}>{canDeprovisionMember ? "Dar de baja y limpiar CRM" : "Solo lectura"}</Button>
                {deprovisionStatus ? <Alert variant="success" className="mb-0">{deprovisionStatus}</Alert> : null}
                {deprovisionError ? <Alert variant="danger" className="mb-0">cleanup failed: {deprovisionError}</Alert> : null}
              </Form>
              <small className="text-secondary d-block mt-2">Estados posibles: cleanup completed, cleanup partial, cleanup failed, no CRM contact found, dissociated only.</small>
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
