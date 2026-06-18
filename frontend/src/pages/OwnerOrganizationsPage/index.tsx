import { useState } from "react";
import { Alert, Badge, Button, Collapse, Form } from "react-bootstrap";
import { ApiRequestError } from "../../api/base";
import { useOwnerApi } from "../../api/owner";
import { ORGANIZATION_BOOTSTRAP_ADMIN_ROLE, ORGANIZATION_JIT_DEFAULT_ROLE } from "../../authLayers";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const FLUENTCRM_LIKELY_CAUSE_LABELS: Record<string, string> = {
  invalid_username: "El usuario no coincide con el username/API username entregado por FluentCRM.",
  invalid_application_password: "La Application Password es inválida, fue truncada o ya no corresponde al usuario elegido.",
  basic_auth_blocked: "El hosting o una capa de seguridad puede estar bloqueando el header Authorization de Basic Auth.",
  wrong_base_url_or_site: "FLUENTCRM_BASE_URL apunta al sitio equivocado o no es la base real de WordPress donde vive FluentCRM.",
  wordpress_user_lacks_fluentcrm_permissions: "El usuario autenticado no tiene permisos suficientes dentro de FluentCRM.",
  security_plugin_blocks_rest_api: "Algún plugin o regla de seguridad está bloqueando la REST API de WordPress o FluentCRM.",
  wrong_base_url: "La URL base configurada no coincide con la instalación real de WordPress.",
  fluentcrm_plugin_missing_or_inactive: "FluentCRM no está instalado, no está activo o su REST API no está disponible.",
  rest_route_unavailable: "La ruta /wp-json/fluent-crm/v2 no está respondiendo como debería.",
};

const getFriendlyFluentCrmHints = (likelyCauses: unknown): string[] => {
  if (!Array.isArray(likelyCauses)) return [];
  return likelyCauses
    .map((cause) => typeof cause === "string" ? FLUENTCRM_LIKELY_CAUSE_LABELS[cause] || cause : null)
    .filter((value): value is string => Boolean(value));
};

const getDiagnosticFromUnknown = (value: unknown): { code?: string; message?: string; likelyCauses?: string[] } | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    message: typeof candidate.message === "string" ? candidate.message : undefined,
    likelyCauses: Array.isArray(candidate.likelyCauses) ? candidate.likelyCauses.filter((item): item is string => typeof item === "string") : undefined,
  };
};

export function OwnerOrganizationsPage() {
  const ownerApi = useOwnerApi();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [appSubdomain, setAppSubdomain] = useState("");
  const [adminDomain, setAdminDomain] = useState("");
  const [baseAdminName, setBaseAdminName] = useState("");
  const [baseAdminEmail, setBaseAdminEmail] = useState("");
  const [baseAdminLogtoUserId, setBaseAdminLogtoUserId] = useState("");
  const [adminRoleName, setAdminRoleName] = useState<string>(ORGANIZATION_BOOTSTRAP_ADMIN_ROLE);
  const [jitDefaultRoleName, setJitDefaultRoleName] = useState<string>(ORGANIZATION_JIT_DEFAULT_ROLE);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);
  const [submitHints, setSubmitHints] = useState<string[]>([]);
  const [createdCrmStatus, setCreatedCrmStatus] = useState<string | null>(null);
  const [crmCompanyName, setCrmCompanyName] = useState("");
  const [crmCompanyEmail, setCrmCompanyEmail] = useState("");
  const [crmCompanyPhone, setCrmCompanyPhone] = useState("");
  const [crmAbout, setCrmAbout] = useState("");
  const [crmWebsite, setCrmWebsite] = useState("");
  const [crmEmployees, setCrmEmployees] = useState("");
  const [crmIndustry, setCrmIndustry] = useState("");
  const [crmType, setCrmType] = useState("");
  const [crmOwner, setCrmOwner] = useState("");
  const [crmDescription, setCrmDescription] = useState("");
  const [crmNit, setCrmNit] = useState("");
  const [crmVerificationDigit, setCrmVerificationDigit] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [crmHealthMessage, setCrmHealthMessage] = useState<string | null>(null);
  const [crmHealthHints, setCrmHealthHints] = useState<string[]>([]);
  const [crmHealthVariant, setCrmHealthVariant] = useState<"success" | "danger" | "warning" | null>(null);
  const [crmHealthChecking, setCrmHealthChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const templateResource = useStableResource({
    initialParams: {},
    load: ownerApi.getOrganizationTemplate,
    getKey: () => "owner-organization-template",
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudo cargar la plantilla de organización de Logto.",
  });

  const roles = templateResource.data?.roles.filter((role) => role.name) ?? [];
  const selectedAdminRole = roles.some((role) => role.name === adminRoleName) ? adminRoleName : ORGANIZATION_BOOTSTRAP_ADMIN_ROLE;
  const selectedJitRole = roles.some((role) => role.name === jitDefaultRoleName) ? jitDefaultRoleName : ORGANIZATION_JIT_DEFAULT_ROLE;
  const logtoUserIdLooksLikeRole = [ORGANIZATION_BOOTSTRAP_ADMIN_ROLE, ORGANIZATION_JIT_DEFAULT_ROLE].includes(baseAdminLogtoUserId.trim() as typeof ORGANIZATION_BOOTSTRAP_ADMIN_ROLE | typeof ORGANIZATION_JIT_DEFAULT_ROLE);

  const handleCrmHealthCheck = async () => {
    setCrmHealthChecking(true);
    setCrmHealthMessage(null);
    setCrmHealthHints([]);
    setCrmHealthVariant(null);
    try {
      const result = await ownerApi.getFluentCrmHealth();
      setCrmHealthVariant("success");
      setCrmHealthMessage(`Conexión FluentCRM OK. Endpoint verificado: ${result.endpoint || result.baseUrl || "configurado"}.`);
      setCrmHealthHints(result.timeoutMs ? [`Timeout activo: ${result.timeoutMs}ms.`] : []);
    } catch (error) {
      const payload = error instanceof ApiRequestError ? error.payload : null;
      const diagnostic = getDiagnosticFromUnknown(payload?.diagnostic);
      setCrmHealthVariant(diagnostic?.code === "FLUENTCRM_AUTHENTICATION_FAILED" ? "warning" : "danger");
      setCrmHealthMessage(error instanceof Error ? error.message : "No se pudo verificar la conexión con FluentCRM.");
      setCrmHealthHints([
        ...getFriendlyFluentCrmHints(diagnostic?.likelyCauses),
        ...(diagnostic?.code === "FLUENTCRM_AUTHENTICATION_FAILED"
          ? [
              "Verifica que el API key haya sido generado desde FluentCRM > Settings > Rest API para un manager válido.",
              "Confirma que FLUENTCRM_BASE_URL sea la raíz del WordPress correcto, sin añadir /wp-json manualmente.",
            ]
          : []),
      ]);
    } finally {
      setCrmHealthChecking(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setSubmitWarning(null);
    setSubmitHints([]);
    setCreatedCrmStatus(null);
    setIsSubmitting(true);

    try {
      const result = await ownerApi.createOrganization({
        name,
        slug,
        subdomain: appSubdomain,
        adminDomain: adminDomain || undefined,
        baseAdmin: {
          name: baseAdminName || undefined,
          email: baseAdminEmail || undefined,
          logtoUserId: baseAdminLogtoUserId || undefined,
          initialOrganizationRole: selectedAdminRole,
        },
        jitProvisioning: {
          domain: adminDomain || undefined,
          defaultRoleNames: [selectedJitRole],
        },
        crm: {
          companyName: crmCompanyName || name,
          companyEmail: crmCompanyEmail || baseAdminEmail || undefined,
          companyPhone: crmCompanyPhone || undefined,
          about: crmAbout || undefined,
          website: crmWebsite || adminDomain || undefined,
          numberOfEmployees: crmEmployees ? Number(crmEmployees) : undefined,
          industry: crmIndustry || undefined,
          type: crmType || undefined,
          companyOwner: crmOwner || undefined,
          description: crmDescription || undefined,
          nit: crmNit ? Number(crmNit) : undefined,
          verificationDigit: crmVerificationDigit ? Number(crmVerificationDigit) : undefined,
        },
      });

      const fluentCrmStep = result.fluentcrm as Record<string, unknown> | undefined;
      const diagnostic = getDiagnosticFromUnknown(fluentCrmStep?.diagnostic);
      const likelyCauseHints = getFriendlyFluentCrmHints(diagnostic?.likelyCauses);

      setName("");
      setSlug("");
      setAppSubdomain("");
      setAdminDomain("");
      setBaseAdminName("");
      setBaseAdminEmail("");
      setBaseAdminLogtoUserId("");
      setCrmCompanyName("");
      setCrmCompanyEmail("");
      setCrmCompanyPhone("");
      setCrmAbout("");
      setCrmWebsite("");
      setCrmEmployees("");
      setCrmIndustry("");
      setCrmType("");
      setCrmOwner("");
      setCrmDescription("");
      setCrmNit("");
      setCrmVerificationDigit("");
      if (result.warning) {
        if (diagnostic?.code === "FLUENTCRM_AUTHENTICATION_FAILED") {
          setSubmitWarning("La organización sí quedó creada en Logto, pero FluentCRM rechazó la autenticación del API key. Revisa las credenciales y permisos antes de reintentar la vinculación comercial.");
        } else {
          setSubmitWarning(result.warning);
        }
      }
      setSubmitHints(likelyCauseHints);
      setCreatedCrmStatus(typeof result.fluentcrm?.status === "string" ? result.fluentcrm.status : null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo crear la organización.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageShell
      eyebrow="Owner / Organizaciones"
      title="Crear organización"
      description="Flujo Logto-first: la organización nace canónicamente en Logto; Civitas no crea una pre-organización local ni checkpoints pending para validar el alta."
      actions={<Badge bg="success">organizations:create</Badge>}
    >
      <div className="row g-4">
        <div className="col-12">
          <PageCard title="Nueva organización" subtitle="Logto es la fuente canónica; la base local queda fuera del camino obligatorio de creación.">
            {templateResource.isLoading ? (
              <LoadingState title="Cargando plantilla" description="Consultando roles de la organization template de Logto." />
            ) : templateResource.error ? (
              <ErrorState title="No se pudo cargar la plantilla" message={templateResource.error} action={<Button onClick={templateResource.retry}>Reintentar</Button>} />
            ) : (
              <Form onSubmit={handleSubmit} className="d-flex flex-column gap-4">
                <div className="d-flex flex-column gap-3">
                  <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3">
                    <div>
                      <h3 className="h6 text-uppercase text-secondary mb-1">Asistente de creación</h3>
                      <p className="text-secondary mb-0">Primero se crea la organización y su bootstrap en Logto. Después se enlaza la capa comercial en FluentCRM sin reescribir identidad ni permisos.</p>
                    </div>
                    <Button type="button" variant={showHelp ? "secondary" : "outline-secondary"} onClick={() => setShowHelp((value) => !value)} aria-expanded={showHelp} className="align-self-start">
                      {showHelp ? "Ocultar ayuda" : "Mostrar ayuda"}
                    </Button>
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    <Badge bg="light" text="dark" className="border">Paso 1: Logto canónico</Badge>
                    <Badge bg="light" text="dark" className="border">Paso 2: CRM downstream</Badge>
                    <Badge bg="light" text="dark" className="border">Sin retyping cuando el dato ya existe</Badge>
                  </div>
                  <Collapse in={showHelp}>
                    <div>
                      <Alert variant="light" className="mb-0 border">
                        <ol className="text-secondary mb-0 d-flex flex-column gap-2 ps-3">
                          <li>Crear o reconciliar primero la organización canónica en Logto.</li>
                          <li>Enviar <code>customData</code> derivado de slug, subdominio y dominio directamente a Logto.</li>
                          <li>Persistir <code>organization_profiles</code> solo después de Logto para referencias externas, sync y auditoría.</li>
                          <li>Crear o resolver el admin base por <code>logtoUserId</code> o por correo y nombre.</li>
                          <li>Agregarlo como miembro y asignarle <code>{ORGANIZATION_BOOTSTRAP_ADMIN_ROLE}</code> sin usar al owner global como sustituto.</li>
                          <li>Configurar JIT real en Logto con el dominio institucional y el rol por defecto <code>{ORGANIZATION_JIT_DEFAULT_ROLE}</code>.</li>
                          <li>Si dejas campos CRM vacíos, Civitas reutiliza datos del paso 1 para evitar retyping.</li>
                        </ol>
                      </Alert>
                    </div>
                  </Collapse>
                </div>

                {templateResource.data && !templateResource.data.ready ? (
                  <Alert variant="danger" className="mb-0">
                    Falta configurar la plantilla de Logto. Roles requeridos ausentes: {templateResource.data.missingRoleNames.join(", ") || ORGANIZATION_BOOTSTRAP_ADMIN_ROLE}.
                  </Alert>
                ) : null}

                <section className="border rounded-3 p-3 p-lg-4 d-flex flex-column gap-3">
                  <div className="d-flex flex-column gap-1">
                    <h3 className="h5 mb-0">Paso 1. Identidad y bootstrap</h3>
                    <p className="text-secondary mb-0">Todo lo que define organización, membresía y permisos nace en Logto.</p>
                  </div>

                  <Form.Group controlId="ownerOrganizationName"><Form.Label>Nombre de organización</Form.Label><Form.Control size="lg" value={name} onChange={(event) => setName(event.target.value)} placeholder="Colegio San José" required /></Form.Group>
                  <Form.Group controlId="ownerOrganizationSlug"><Form.Label>Slug</Form.Label><Form.Control value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="colegio-san-jose" required /><Form.Text>Identificador interno legible para rutas y operación owner; usa minúsculas, números y guiones.</Form.Text></Form.Group>

                  <div className="row g-3">
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationAppSubdomain"><Form.Label>Subdominio app</Form.Label><Form.Control value={appSubdomain} onChange={(event) => setAppSubdomain(event.target.value)} placeholder="sanjose" required /><Form.Text>Solo el prefijo operativo de la app. Genera automáticamente <code>https://{appSubdomain || "sanjose"}.learnsocialstudies.com/callback</code>.</Form.Text></Form.Group>
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationAdminDomain"><Form.Label>Dominio institucional de aprovisionamiento</Form.Label><Form.Control value={adminDomain} onChange={(event) => setAdminDomain(event.target.value)} placeholder="colegiosanjose.edu.co" required /><Form.Text>Dominio real de correo o identidad institucional; no es el subdominio app.</Form.Text></Form.Group>
                  </div>

                  <div className="row g-3">
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationBaseAdminName"><Form.Label>Nombre admin base</Form.Label><Form.Control value={baseAdminName} onChange={(event) => setBaseAdminName(event.target.value)} placeholder="María Admin" required /></Form.Group>
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationBaseAdminEmail"><Form.Label>Correo admin base</Form.Label><Form.Control type="email" value={baseAdminEmail} onChange={(event) => setBaseAdminEmail(event.target.value)} placeholder="admin@colegio1.edu.co" required /></Form.Group>
                  </div>

                  <Form.Group controlId="ownerOrganizationBaseAdminLogtoId"><Form.Label>Logto user id admin base existente</Form.Label><Form.Control isInvalid={logtoUserIdLooksLikeRole} value={baseAdminLogtoUserId} onChange={(event) => setBaseAdminLogtoUserId(event.target.value)} placeholder="Opcional: user id real de Logto, no un nombre de rol" /><Form.Control.Feedback type="invalid">Admin-org y Student-org son roles, no user ids de Logto.</Form.Control.Feedback><Form.Text>Si se omite, Civitas crea o resuelve el usuario por correo y nombre en Logto antes de agregarlo como miembro.</Form.Text></Form.Group>

                  <div className="row g-3">
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationAdminRole"><Form.Label>Rol organizacional del admin base</Form.Label><Form.Select value={selectedAdminRole} onChange={(event) => setAdminRoleName(event.target.value)} disabled={roles.length === 0}>{roles.filter((role) => role.name === ORGANIZATION_BOOTSTRAP_ADMIN_ROLE).map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</Form.Select><Form.Text>Se asigna al usuario admin base después de hacerlo miembro.</Form.Text></Form.Group>
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationJitDefaultRole"><Form.Label>Rol predeterminado para JIT</Form.Label><Form.Select value={selectedJitRole} onChange={(event) => setJitDefaultRoleName(event.target.value)} disabled={roles.length === 0}>{roles.filter((role) => role.name === ORGANIZATION_JIT_DEFAULT_ROLE).map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</Form.Select><Form.Text>Se configura en Logto para nuevos usuarios del dominio institucional.</Form.Text></Form.Group>
                  </div>
                </section>

                <section className="border rounded-3 p-3 p-lg-4 d-flex flex-column gap-3">
                  <div className="d-flex flex-column flex-xl-row justify-content-between align-items-xl-start gap-3">
                    <div className="d-flex flex-column gap-1">
                      <h3 className="h5 mb-0">Paso 2. FluentCRM</h3>
                      <p className="text-secondary mb-0">Datos comerciales downstream. Si dejas campos vacíos, el wizard reutiliza datos del paso 1 para que el flujo sea más fluido.</p>
                    </div>
                    <div className="d-flex flex-column align-items-xl-end gap-2">
                      <Button type="button" variant="outline-primary" onClick={handleCrmHealthCheck} disabled={crmHealthChecking}>
                        {crmHealthChecking ? "Verificando conexión..." : "Verificar conexión CRM"}
                      </Button>
                      <small className="text-secondary text-xl-end">Comprueba credenciales, endpoint y permisos antes de crear la Company.</small>
                    </div>
                  </div>

                  {crmHealthMessage ? (
                    <Alert variant={crmHealthVariant || "info"} className="mb-0">
                      <div className="fw-semibold mb-1">Diagnóstico FluentCRM</div>
                      <div>{crmHealthMessage}</div>
                      {crmHealthHints.length > 0 ? (
                        <ul className="mt-2 mb-0 ps-3 d-flex flex-column gap-1">
                          {crmHealthHints.map((hint) => <li key={hint}>{hint}</li>)}
                        </ul>
                      ) : null}
                    </Alert>
                  ) : null}

                  <Form.Group controlId="ownerOrganizationCrmCompanyName"><Form.Label>Company Name</Form.Label><Form.Control size="lg" value={crmCompanyName} onChange={(event) => setCrmCompanyName(event.target.value)} placeholder={name || "Colegio San José"} /></Form.Group>

                  <div className="row g-3">
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmCompanyEmail"><Form.Label>Company Email</Form.Label><Form.Control type="email" value={crmCompanyEmail} onChange={(event) => setCrmCompanyEmail(event.target.value)} placeholder={baseAdminEmail || "contacto@colegio.edu"} /></Form.Group>
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmCompanyPhone"><Form.Label>Company Phone Number</Form.Label><Form.Control value={crmCompanyPhone} onChange={(event) => setCrmCompanyPhone(event.target.value)} placeholder="+1 555 555 5555" /></Form.Group>
                  </div>

                  <Form.Group controlId="ownerOrganizationCrmAbout"><Form.Label>About this company</Form.Label><Form.Control as="textarea" rows={2} value={crmAbout} onChange={(event) => setCrmAbout(event.target.value)} /></Form.Group>

                  <div className="row g-3">
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmWebsite"><Form.Label>Website</Form.Label><Form.Control value={crmWebsite} onChange={(event) => setCrmWebsite(event.target.value)} placeholder={adminDomain || "colegio.edu"} /></Form.Group>
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmEmployees"><Form.Label>Number of Employees</Form.Label><Form.Control type="number" min="0" value={crmEmployees} onChange={(event) => setCrmEmployees(event.target.value)} /></Form.Group>
                  </div>

                  <div className="row g-3">
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmNit"><Form.Label>NIT</Form.Label><Form.Control type="number" min="0" value={crmNit} onChange={(event) => setCrmNit(event.target.value)} placeholder="900123456" /><Form.Text>Campo comercial downstream en FluentCRM: <code>nit</code>.</Form.Text></Form.Group>
                    <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmVerificationDigit"><Form.Label>Digito de Verificación</Form.Label><Form.Control type="number" min="0" value={crmVerificationDigit} onChange={(event) => setCrmVerificationDigit(event.target.value)} placeholder="7" /><Form.Text>Campo comercial downstream en FluentCRM: <code>digito_de_verificación</code>.</Form.Text></Form.Group>
                  </div>

                  <div className="row g-3">
                    <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmIndustry"><Form.Label>Industry</Form.Label><Form.Control value={crmIndustry} onChange={(event) => setCrmIndustry(event.target.value)} placeholder="Education" /></Form.Group>
                    <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmType"><Form.Label>Type</Form.Label><Form.Control value={crmType} onChange={(event) => setCrmType(event.target.value)} placeholder="School" /></Form.Group>
                    <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmOwner"><Form.Label>Company Owner</Form.Label><Form.Control value={crmOwner} onChange={(event) => setCrmOwner(event.target.value)} /></Form.Group>
                  </div>

                  <Form.Group controlId="ownerOrganizationCrmDescription"><Form.Label>Description</Form.Label><Form.Control as="textarea" rows={2} value={crmDescription} onChange={(event) => setCrmDescription(event.target.value)} /></Form.Group>
                </section>

                <Alert variant="info" className="mb-0">
                  El alta crea o reconcilia la organización en Logto, crea o resuelve el admin base en Logto, lo agrega como miembro, le asigna Admin-org y configura en la API de Logto el dominio institucional con Student-org como rol JIT predeterminado. <code>customData</code> queda solo como metadata auxiliar.
                </Alert>
                {submitError && <Alert variant="danger" className="mb-0">{submitError}</Alert>}
                {submitWarning ? (
                  <Alert variant="warning" className="mb-0">
                    <div className="fw-semibold mb-1">Atención en el paso FluentCRM</div>
                    <div>{submitWarning}</div>
                    {submitHints.length > 0 ? (
                      <ul className="mt-2 mb-0 ps-3 d-flex flex-column gap-1">
                        {submitHints.map((hint) => <li key={hint}>{hint}</li>)}
                      </ul>
                    ) : null}
                  </Alert>
                ) : null}
                {createdCrmStatus && <Alert variant="success" className="mb-0">Estado FluentCRM: {createdCrmStatus}. La organización canónica y permisos siguen en Logto.</Alert>}
                <div className="d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-3">
                  <small className="text-secondary">Si FluentCRM falla, la organización igual queda creada canónicamente en Logto y podrás volver a intentar la vinculación comercial después.</small>
                  <Button type="submit" disabled={isSubmitting || !name.trim() || !slug.trim() || !appSubdomain.trim() || !adminDomain.trim() || !baseAdminName.trim() || !baseAdminEmail.trim() || logtoUserIdLooksLikeRole || !templateResource.data?.ready} className="px-4 align-self-sm-end">
                    {isSubmitting ? "Creando..." : "Crear organización"}
                  </Button>
                </div>
              </Form>
            )}
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}