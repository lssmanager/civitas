import { useEffect, useState } from "react";
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

type WizardStep = 1 | 2 | 3;
type CrmField = keyof OwnerOrganizationFormData["crm"];
type AdministrativeContactKey = "rector" | "coordinator1" | "coordinator2" | "coordinator3";
type AdministrativeContact = { key: AdministrativeContactKey; label: string; name: string; email: string; organizationRoleName: string };

type OwnerOrganizationFormData = {
  name: string;
  slug: string;
  appSubdomain: string;
  adminDomain: string;
  baseAdminName: string;
  baseAdminEmail: string;
  baseAdminLogtoUserId: string;
  adminRoleName: string;
  jitDefaultRoleName: string;
  crm: {
    companyName: string;
    companyEmail: string;
    companyPhone: string;
    about: string;
    website: string;
    address: string;
    numberOfEmployees: string;
    industry: string;
    type: string;
    companyOwner: string;
    description: string;
    nit: string;
    verificationDigit: string;
    tags: string[];
    lists: string[];
  };
  administrativeContacts: AdministrativeContact[];
};

type DirtyState = { crm: { companyName: boolean; companyEmail: boolean; website: boolean; tags: boolean; lists: boolean } };

const initialFormData: OwnerOrganizationFormData = {
  name: "",
  slug: "",
  appSubdomain: "",
  adminDomain: "",
  baseAdminName: "",
  baseAdminEmail: "",
  baseAdminLogtoUserId: "",
  adminRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE,
  jitDefaultRoleName: ORGANIZATION_JIT_DEFAULT_ROLE,
  crm: {
    companyName: "",
    companyEmail: "",
    companyPhone: "",
    about: "",
    website: "",
    address: "",
    numberOfEmployees: "",
    industry: "",
    type: "",
    companyOwner: "",
    description: "",
    nit: "",
    verificationDigit: "",
    tags: [],
    lists: [],
  },
  administrativeContacts: [
    { key: "rector", label: "Rector", name: "", email: "", organizationRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE },
    { key: "coordinator1", label: "Coordinador 1", name: "", email: "", organizationRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE },
    { key: "coordinator2", label: "Coordinador 2", name: "", email: "", organizationRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE },
    { key: "coordinator3", label: "Coordinador 3", name: "", email: "", organizationRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE },
  ],
};

const initialDirty: DirtyState = { crm: { companyName: false, companyEmail: false, website: false, tags: false, lists: false } };
const wizardSteps: Array<{ step: WizardStep; title: string; description: string }> = [
  { step: 1, title: "Paso 1. Identidad y bootstrap", description: "Logto canónico" },
  { step: 2, title: "Paso 2. FluentCRM", description: "CRM y administrativos" },
  { step: 3, title: "Paso 3. Validación final", description: "Resumen antes de crear" },
];

const uniqueValues = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const deriveTags = (adminRoleName: string, jitDefaultRoleName: string) => uniqueValues([adminRoleName, jitDefaultRoleName].filter((role) => role !== "owner_global"));
const deriveContactTag = (roleName: string) => roleName && roleName !== "owner_global" ? `civitas-role-${roleName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : null;
const displayValue = (value?: string | null) => value?.trim() || "—";

export function OwnerOrganizationsPage() {
  const ownerApi = useOwnerApi();
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [formData, setFormData] = useState<OwnerOrganizationFormData>(initialFormData);
  const [dirty, setDirty] = useState<DirtyState>(initialDirty);
  const [stepError, setStepError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [listInput, setListInput] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);
  const [submitHints, setSubmitHints] = useState<string[]>([]);
  const [createdCrmStatus, setCreatedCrmStatus] = useState<string | null>(null);
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
  const selectedAdminRole = roles.some((role) => role.name === formData.adminRoleName) ? formData.adminRoleName : ORGANIZATION_BOOTSTRAP_ADMIN_ROLE;
  const selectedJitRole = roles.some((role) => role.name === formData.jitDefaultRoleName) ? formData.jitDefaultRoleName : ORGANIZATION_JIT_DEFAULT_ROLE;
  const logtoUserIdLooksLikeRole = [ORGANIZATION_BOOTSTRAP_ADMIN_ROLE, ORGANIZATION_JIT_DEFAULT_ROLE].includes(formData.baseAdminLogtoUserId.trim() as typeof ORGANIZATION_BOOTSTRAP_ADMIN_ROLE | typeof ORGANIZATION_JIT_DEFAULT_ROLE);

  useEffect(() => {
    setFormData((current) => ({
      ...current,
      adminRoleName: selectedAdminRole,
      jitDefaultRoleName: selectedJitRole,
      crm: {
        ...current.crm,
        companyName: dirty.crm.companyName ? current.crm.companyName : current.name,
        companyEmail: dirty.crm.companyEmail ? current.crm.companyEmail : current.baseAdminEmail,
        website: dirty.crm.website ? current.crm.website : current.adminDomain,
        tags: dirty.crm.tags ? current.crm.tags : deriveTags(selectedAdminRole, selectedJitRole),
        lists: dirty.crm.lists ? current.crm.lists : uniqueValues([current.name]),
      },
    }));
  }, [formData.name, formData.baseAdminEmail, formData.adminDomain, selectedAdminRole, selectedJitRole, dirty.crm.companyName, dirty.crm.companyEmail, dirty.crm.website, dirty.crm.tags, dirty.crm.lists]);

  const updateField = (field: keyof Omit<OwnerOrganizationFormData, "crm">, value: string) => {
    setStepError(null);
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const updateCrmField = (field: Exclude<CrmField, "tags" | "lists">, value: string) => {
    setStepError(null);
    if (["companyName", "companyEmail", "website"].includes(field)) {
      setDirty((current) => ({ ...current, crm: { ...current.crm, [field]: true } }));
    }
    setFormData((current) => ({ ...current, crm: { ...current.crm, [field]: value } }));
  };

  const updateAdministrativeContact = (key: AdministrativeContactKey, field: "name" | "email" | "organizationRoleName", value: string) => {
    setStepError(null);
    setFormData((current) => ({
      ...current,
      administrativeContacts: current.administrativeContacts.map((contact) => contact.key === key ? { ...contact, [field]: value } : contact),
    }));
  };

  const activeAdministrativeContacts = formData.administrativeContacts.filter((contact) => contact.name.trim() || contact.email.trim());

  const addCollectionValue = (collection: "tags" | "lists", value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setDirty((current) => ({ ...current, crm: { ...current.crm, [collection]: true } }));
    setFormData((current) => ({ ...current, crm: { ...current.crm, [collection]: uniqueValues([...current.crm[collection], normalized]) } }));
    if (collection === "tags") setTagInput("");
    if (collection === "lists") setListInput("");
  };

  const removeCollectionValue = (collection: "tags" | "lists", value: string) => {
    setDirty((current) => ({ ...current, crm: { ...current.crm, [collection]: true } }));
    setFormData((current) => ({ ...current, crm: { ...current.crm, [collection]: current.crm[collection].filter((item) => item !== value) } }));
  };

  const validateStepOne = () => {
    if (!formData.name.trim() || !formData.slug.trim() || !formData.appSubdomain.trim() || !formData.adminDomain.trim() || !formData.baseAdminName.trim() || !formData.baseAdminEmail.trim()) {
      return "Completa los campos obligatorios de identidad y bootstrap antes de avanzar.";
    }
    if (!templateResource.data?.ready) return "Falta configurar la plantilla de Logto antes de continuar.";
    if (logtoUserIdLooksLikeRole) return "Admin-org y Student-org son roles, no user ids de Logto.";
    return null;
  };

  const goToStep = (step: WizardStep) => {
    if (step > 1) {
      const validationError = validateStepOne();
      if (validationError) {
        setCurrentStep(1);
        setStepError(validationError);
        return;
      }
    }
    setStepError(null);
    setCurrentStep(step);
  };

  const goNext = () => {
    if (currentStep === 1) {
      const validationError = validateStepOne();
      if (validationError) {
        setStepError(validationError);
        return;
      }
    }
    setStepError(null);
    setCurrentStep((step) => Math.min(3, step + 1) as WizardStep);
  };

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
    if (currentStep !== 3) {
      goNext();
      return;
    }
    const validationError = validateStepOne();
    if (validationError) {
      setStepError(validationError);
      setCurrentStep(1);
      return;
    }
    setSubmitError(null);
    setSubmitWarning(null);
    setSubmitHints([]);
    setCreatedCrmStatus(null);
    setIsSubmitting(true);

    try {
      const result = await ownerApi.createOrganization({
        name: formData.name,
        slug: formData.slug,
        subdomain: formData.appSubdomain,
        adminDomain: formData.adminDomain || undefined,
        baseAdmin: {
          name: formData.baseAdminName || undefined,
          email: formData.baseAdminEmail || undefined,
          logtoUserId: formData.baseAdminLogtoUserId || undefined,
          initialOrganizationRole: selectedAdminRole,
        },
        jitProvisioning: {
          domain: formData.adminDomain || undefined,
          defaultRoleNames: [selectedJitRole],
        },
        crm: {
          companyName: formData.crm.companyName || formData.name,
          companyEmail: formData.crm.companyEmail || formData.baseAdminEmail || undefined,
          companyPhone: formData.crm.companyPhone || undefined,
          about: formData.crm.about || undefined,
          website: formData.crm.website || formData.adminDomain || undefined,
          address: formData.crm.address || undefined,
          numberOfEmployees: formData.crm.numberOfEmployees ? Number(formData.crm.numberOfEmployees) : undefined,
          industry: formData.crm.industry || undefined,
          type: formData.crm.type || undefined,
          companyOwner: formData.crm.companyOwner || undefined,
          description: formData.crm.description || undefined,
          nit: formData.crm.nit ? Number(formData.crm.nit) : undefined,
          verificationDigit: formData.crm.verificationDigit ? Number(formData.crm.verificationDigit) : undefined,
          tags: formData.crm.tags,
          lists: formData.crm.lists,
        },
        administrativeContacts: activeAdministrativeContacts.map(({ name, email, organizationRoleName }) => ({ name, email, organizationRoleName })),
      });

      const fluentCrmStep = result.fluentcrm as Record<string, unknown> | undefined;
      const diagnostic = getDiagnosticFromUnknown(fluentCrmStep?.diagnostic);
      const likelyCauseHints = getFriendlyFluentCrmHints(diagnostic?.likelyCauses);

      setFormData(initialFormData);
      setDirty(initialDirty);
      setCurrentStep(1);
      setTagInput("");
      setListInput("");
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

  const renderCollectionEditor = (collection: "tags" | "lists", values: string[], inputValue: string, setInputValue: (value: string) => void, label: string) => (
    <div className="d-flex flex-column gap-2">
      <Form.Label className="mb-0">{label}</Form.Label>
      <div className="d-flex gap-2">
        <Form.Control value={inputValue} onChange={(event) => setInputValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCollectionValue(collection, inputValue); } }} />
        <Button type="button" variant="outline-secondary" onClick={() => addCollectionValue(collection, inputValue)}>Agregar</Button>
      </div>
      <div className="d-flex flex-wrap gap-2">
        {values.length > 0 ? values.map((value) => (
          <Badge key={value} bg="light" text="dark" className="border d-inline-flex align-items-center gap-2 py-2">
            {value}
            <button type="button" className="btn-close btn-close-sm" aria-label={`Quitar ${value}`} onClick={() => removeCollectionValue(collection, value)} />
          </Badge>
        )) : <span className="text-secondary small">Sin valores configurados.</span>}
      </div>
    </div>
  );

  const summaryRow = (label: string, value?: string | null) => (
    <div className="d-flex flex-column gap-1 border-bottom pb-2">
      <span className="small text-secondary">{label}</span>
      <span className="fw-semibold">{displayValue(value)}</span>
    </div>
  );

  const renderStepOne = () => (
    <section className="border rounded-3 p-3 p-lg-4 d-flex flex-column gap-3">
      <div className="d-flex flex-column gap-1">
        <h3 className="h5 mb-0">Paso 1. Identidad y bootstrap</h3>
        <p className="text-secondary mb-0">Todo lo que define organización, membresía y permisos nace en Logto.</p>
      </div>
      <Form.Group controlId="ownerOrganizationName"><Form.Label>Nombre de organización</Form.Label><Form.Control size="lg" value={formData.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Colegio San José" required /></Form.Group>
      <Form.Group controlId="ownerOrganizationSlug"><Form.Label>Slug</Form.Label><Form.Control value={formData.slug} onChange={(event) => updateField("slug", event.target.value)} placeholder="colegio-san-jose" required /><Form.Text>Identificador interno legible para rutas y operación owner; usa minúsculas, números y guiones.</Form.Text></Form.Group>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationAppSubdomain"><Form.Label>Subdominio app</Form.Label><Form.Control value={formData.appSubdomain} onChange={(event) => updateField("appSubdomain", event.target.value)} placeholder="sanjose" required /><Form.Text>Solo el prefijo operativo de la app. Genera automáticamente <code>https://{formData.appSubdomain || "sanjose"}.learnsocialstudies.com/callback</code>.</Form.Text></Form.Group>
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationAdminDomain"><Form.Label>Dominio institucional de aprovisionamiento</Form.Label><Form.Control value={formData.adminDomain} onChange={(event) => updateField("adminDomain", event.target.value)} placeholder="colegiosanjose.edu.co" required /><Form.Text>Dominio real de correo o identidad institucional; no es el subdominio app.</Form.Text></Form.Group>
      </div>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationBaseAdminName"><Form.Label>Nombre admin base</Form.Label><Form.Control value={formData.baseAdminName} onChange={(event) => updateField("baseAdminName", event.target.value)} placeholder="María Admin" required /></Form.Group>
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationBaseAdminEmail"><Form.Label>Correo admin base</Form.Label><Form.Control type="email" value={formData.baseAdminEmail} onChange={(event) => updateField("baseAdminEmail", event.target.value)} placeholder="admin@colegio1.edu.co" required /></Form.Group>
      </div>
      <Form.Group controlId="ownerOrganizationBaseAdminLogtoId"><Form.Label>Logto user id admin base existente</Form.Label><Form.Control isInvalid={logtoUserIdLooksLikeRole} value={formData.baseAdminLogtoUserId} onChange={(event) => updateField("baseAdminLogtoUserId", event.target.value)} placeholder="Opcional: user id real de Logto, no un nombre de rol" /><Form.Control.Feedback type="invalid">Admin-org y Student-org son roles, no user ids de Logto.</Form.Control.Feedback><Form.Text>Si se omite, Civitas crea o resuelve el usuario por correo y nombre en Logto antes de agregarlo como miembro.</Form.Text></Form.Group>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationAdminRole"><Form.Label>Rol organizacional del admin base</Form.Label><Form.Select value={selectedAdminRole} onChange={(event) => updateField("adminRoleName", event.target.value)} disabled={roles.length === 0}>{roles.filter((role) => role.name === ORGANIZATION_BOOTSTRAP_ADMIN_ROLE).map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</Form.Select><Form.Text>Se asigna al usuario admin base después de hacerlo miembro.</Form.Text></Form.Group>
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationJitDefaultRole"><Form.Label>Rol predeterminado para JIT</Form.Label><Form.Select value={selectedJitRole} onChange={(event) => updateField("jitDefaultRoleName", event.target.value)} disabled={roles.length === 0}>{roles.filter((role) => role.name === ORGANIZATION_JIT_DEFAULT_ROLE).map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</Form.Select><Form.Text>Se configura en Logto para nuevos usuarios del dominio institucional.</Form.Text></Form.Group>
      </div>
    </section>
  );

  const renderStepTwo = () => (
    <section className="border rounded-3 p-3 p-lg-4 d-flex flex-column gap-3">
      <div className="d-flex flex-column flex-xl-row justify-content-between align-items-xl-start gap-3">
        <div className="d-flex flex-column gap-1">
          <h3 className="h5 mb-0">Paso 2. FluentCRM</h3>
          <p className="text-secondary mb-0">Datos comerciales downstream prellenados desde el paso 1 mientras no los edites manualmente.</p>
        </div>
        <div className="d-flex flex-column align-items-xl-end gap-2">
          <Button type="button" variant="outline-primary" onClick={handleCrmHealthCheck} disabled={crmHealthChecking}>{crmHealthChecking ? "Verificando conexión..." : "Verificar conexión CRM"}</Button>
          <small className="text-secondary text-xl-end">Comprueba credenciales, endpoint y permisos antes de crear la Company.</small>
        </div>
      </div>
      {crmHealthMessage ? (
        <Alert variant={crmHealthVariant || "info"} className="mb-0">
          <div className="fw-semibold mb-1">Diagnóstico FluentCRM</div>
          <div>{crmHealthMessage}</div>
          {crmHealthHints.length > 0 ? <ul className="mt-2 mb-0 ps-3 d-flex flex-column gap-1">{crmHealthHints.map((hint) => <li key={hint}>{hint}</li>)}</ul> : null}
        </Alert>
      ) : null}
      <Form.Group controlId="ownerOrganizationCrmCompanyName"><Form.Label>Company Name</Form.Label><Form.Control size="lg" value={formData.crm.companyName} onChange={(event) => updateCrmField("companyName", event.target.value)} /></Form.Group>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmCompanyEmail"><Form.Label>Company Email</Form.Label><Form.Control type="email" value={formData.crm.companyEmail} onChange={(event) => updateCrmField("companyEmail", event.target.value)} /></Form.Group>
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmCompanyPhone"><Form.Label>Company Phone Number</Form.Label><Form.Control value={formData.crm.companyPhone} onChange={(event) => updateCrmField("companyPhone", event.target.value)} placeholder="+1 555 555 5555" /></Form.Group>
      </div>
      <Form.Group controlId="ownerOrganizationCrmAbout"><Form.Label>About this company</Form.Label><Form.Control as="textarea" rows={2} value={formData.crm.about} onChange={(event) => updateCrmField("about", event.target.value)} /></Form.Group>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationCrmWebsite"><Form.Label>Website</Form.Label><Form.Control value={formData.crm.website} onChange={(event) => updateCrmField("website", event.target.value)} /></Form.Group>
        <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationCrmAddress"><Form.Label>Address</Form.Label><Form.Control type="text" value={formData.crm.address} onChange={(event) => updateCrmField("address", event.target.value)} /></Form.Group>
        <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationCrmEmployees"><Form.Label>Number of Employees</Form.Label><Form.Control type="number" min="0" value={formData.crm.numberOfEmployees} onChange={(event) => updateCrmField("numberOfEmployees", event.target.value)} /></Form.Group>
      </div>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmNit"><Form.Label>NIT</Form.Label><Form.Control type="number" min="0" value={formData.crm.nit} onChange={(event) => updateCrmField("nit", event.target.value)} placeholder="900123456" /><Form.Text>Campo comercial downstream en FluentCRM: <code>nit</code>.</Form.Text></Form.Group>
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmVerificationDigit"><Form.Label>Digito de Verificación</Form.Label><Form.Control type="number" min="0" value={formData.crm.verificationDigit} onChange={(event) => updateCrmField("verificationDigit", event.target.value)} placeholder="7" /><Form.Text>Campo comercial downstream en FluentCRM: <code>digito_de_verificación</code>.</Form.Text></Form.Group>
      </div>
      <div className="row g-3">
        <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmIndustry"><Form.Label>Industry</Form.Label><Form.Control value={formData.crm.industry} onChange={(event) => updateCrmField("industry", event.target.value)} placeholder="Education" /></Form.Group>
        <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmType"><Form.Label>Type</Form.Label><Form.Control value={formData.crm.type} onChange={(event) => updateCrmField("type", event.target.value)} placeholder="School" /></Form.Group>
        <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmOwner"><Form.Label>Company Owner</Form.Label><Form.Control value={formData.crm.companyOwner} onChange={(event) => updateCrmField("companyOwner", event.target.value)} /></Form.Group>
      </div>
      <Form.Group controlId="ownerOrganizationCrmDescription"><Form.Label>Description</Form.Label><Form.Control as="textarea" rows={2} value={formData.crm.description} onChange={(event) => updateCrmField("description", event.target.value)} /></Form.Group>

      <div className="border rounded-3 p-3 d-flex flex-column gap-3 bg-light bg-opacity-50">
        <div><h4 className="h6 mb-1">Administrativos</h4><p className="text-secondary mb-0 small">Personas reales: se crearán/resolverán en Logto, quedarán como miembros de la organización y se sincronizarán como contactos CRM downstream.</p></div>
        <div className="d-flex flex-column gap-3">
          {formData.administrativeContacts.map((contact) => {
            const previewTag = deriveContactTag(contact.organizationRoleName);
            return (
              <div key={contact.key} className="border rounded-3 p-3 bg-white d-flex flex-column gap-3">
                <div className="d-flex flex-column flex-lg-row justify-content-between gap-2">
                  <h5 className="h6 mb-0">{contact.label}</h5>
                  <span className="small text-secondary">Tag por contacto: {previewTag ? <Badge bg="light" text="dark" className="border ms-1">{previewTag}</Badge> : "—"}</span>
                </div>
                <div className="row g-3">
                  <Form.Group className="col-12 col-xl-4" controlId={`ownerOrganizationAdminContactName-${contact.key}`}><Form.Label>{contact.label} nombre</Form.Label><Form.Control value={contact.name} onChange={(event) => updateAdministrativeContact(contact.key, "name", event.target.value)} /></Form.Group>
                  <Form.Group className="col-12 col-xl-4" controlId={`ownerOrganizationAdminContactEmail-${contact.key}`}><Form.Label>{contact.label} email</Form.Label><Form.Control type="email" value={contact.email} onChange={(event) => updateAdministrativeContact(contact.key, "email", event.target.value)} /></Form.Group>
                  <Form.Group className="col-12 col-xl-4" controlId={`ownerOrganizationAdminContactRole-${contact.key}`}><Form.Label>{contact.label} rol Logto</Form.Label><Form.Select value={contact.organizationRoleName} onChange={(event) => updateAdministrativeContact(contact.key, "organizationRoleName", event.target.value)} disabled={roles.length === 0}>{roles.map((role) => <option value={role.name} key={`${contact.key}-${role.id}`}>{role.name}</option>)}</Form.Select><Form.Text>Rol organizacional real de Logto; tags CRM son solo segmentación.</Form.Text></Form.Group>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="row g-3">
        <div className="col-12 col-xl-6">{renderCollectionEditor("tags", formData.crm.tags, tagInput, setTagInput, "Tags CRM")}</div>
        <div className="col-12 col-xl-6">{renderCollectionEditor("lists", formData.crm.lists, listInput, setListInput, "Lists CRM")}</div>
      </div>
    </section>
  );

  const renderStepThree = () => (
    <section className="border rounded-3 p-3 p-lg-4 d-flex flex-column gap-3">
      <div className="d-flex flex-column gap-1">
        <h3 className="h5 mb-0">Paso 3. Validación final</h3>
        <p className="text-secondary mb-0">Revisa y corrige antes del submit final. La creación solo se ejecuta desde este paso.</p>
      </div>
      <div className="row g-3">
        <div className="col-12 col-xl-6"><div className="border rounded-3 p-3 h-100 d-flex flex-column gap-2"><div className="d-flex justify-content-between gap-2"><h4 className="h6 mb-0">Identidad y bootstrap</h4><Button type="button" size="sm" variant="outline-secondary" onClick={() => goToStep(1)}>Editar</Button></div>{summaryRow("Organización", formData.name)}{summaryRow("Slug", formData.slug)}{summaryRow("Subdominio app", formData.appSubdomain)}{summaryRow("Dominio institucional", formData.adminDomain)}{summaryRow("Admin base", formData.baseAdminName)}{summaryRow("Correo admin base", formData.baseAdminEmail)}{summaryRow("Logto user id", formData.baseAdminLogtoUserId)}{summaryRow("Rol admin", selectedAdminRole)}{summaryRow("Rol JIT", selectedJitRole)}</div></div>
        <div className="col-12 col-xl-6"><div className="border rounded-3 p-3 h-100 d-flex flex-column gap-2"><div className="d-flex justify-content-between gap-2"><h4 className="h6 mb-0">Datos CRM</h4><Button type="button" size="sm" variant="outline-secondary" onClick={() => goToStep(2)}>Editar</Button></div>{summaryRow("Company Name", formData.crm.companyName)}{summaryRow("Company Email", formData.crm.companyEmail)}{summaryRow("Company Phone Number", formData.crm.companyPhone)}{summaryRow("Website", formData.crm.website)}{summaryRow("Address", formData.crm.address)}{summaryRow("Number of Employees", formData.crm.numberOfEmployees)}{summaryRow("Industry", formData.crm.industry)}{summaryRow("Type", formData.crm.type)}{summaryRow("Company Owner", formData.crm.companyOwner)}{summaryRow("NIT", formData.crm.nit)}{summaryRow("Digito de Verificación", formData.crm.verificationDigit)}</div></div>
        <div className="col-12 col-xl-6"><div className="border rounded-3 p-3 h-100 d-flex flex-column gap-2"><h4 className="h6 mb-0">Administrativos</h4>{formData.administrativeContacts.map((contact) => <div key={`summary-${contact.key}`} className="border-bottom pb-2"><div className="fw-semibold">{contact.label}</div><div className="small text-secondary">{displayValue(contact.name)} · {displayValue(contact.email)}</div><div className="small">Rol Logto: {displayValue(contact.organizationRoleName)}</div><div className="small">Tag por contacto: {deriveContactTag(contact.organizationRoleName) || "—"}</div></div>)}</div></div>
        <div className="col-12 col-xl-6"><div className="border rounded-3 p-3 h-100 d-flex flex-column gap-3"><h4 className="h6 mb-0">Tags CRM</h4><div className="d-flex flex-wrap gap-2">{formData.crm.tags.length ? formData.crm.tags.map((tag) => <Badge key={tag} bg="light" text="dark" className="border">{tag}</Badge>) : <span className="text-secondary small">Sin tags.</span>}</div><h4 className="h6 mb-0">Lists CRM</h4><div className="d-flex flex-wrap gap-2">{formData.crm.lists.length ? formData.crm.lists.map((list) => <Badge key={list} bg="light" text="dark" className="border">{list}</Badge>) : <span className="text-secondary small">Sin lists.</span>}</div><h4 className="h6 mb-0">Descripción / About</h4>{summaryRow("About this company", formData.crm.about)}{summaryRow("Description", formData.crm.description)}</div></div>
      </div>
    </section>
  );

  return (
    <PageShell eyebrow="Owner / Organizaciones" title="Crear organización" description="Flujo Logto-first: la organización nace canónicamente en Logto; Civitas no crea una pre-organización local ni checkpoints pending para validar el alta." actions={<Badge bg="success">organizations:create</Badge>}>
      <div className="row g-4"><div className="col-12"><PageCard title="Nueva organización" subtitle="Logto es la fuente canónica; la base local queda fuera del camino obligatorio de creación.">
        {templateResource.isLoading ? <LoadingState title="Cargando plantilla" description="Consultando roles de la organization template de Logto." /> : templateResource.error ? <ErrorState title="No se pudo cargar la plantilla" message={templateResource.error} action={<Button onClick={templateResource.retry}>Reintentar</Button>} /> : (
          <Form onSubmit={handleSubmit} className="d-flex flex-column gap-4">
            <div className="d-flex flex-column gap-2">
              <div className="d-flex flex-column gap-2">
                <div className="d-inline-flex align-items-center gap-2"><Form.Check type="switch" id="ownerOrganizationHelpToggle" label="help" checked={showHelp} onChange={(event) => setShowHelp(event.target.checked)} /></div>
                <div><h3 className="h6 text-uppercase text-secondary mb-1">Asistente de creación</h3><p className="text-secondary mb-0">Primero se crea la organización y su bootstrap en Logto. Después se enlaza la capa comercial en FluentCRM sin reescribir identidad ni permisos.</p></div>
              </div>
              <Collapse in={showHelp}><div className="d-flex flex-column gap-3"><div className="d-flex flex-wrap gap-2"><Badge bg="light" text="dark" className="border">Paso 1: Logto canónico</Badge><Badge bg="light" text="dark" className="border">Paso 2: CRM downstream</Badge><Badge bg="light" text="dark" className="border">Sin retyping cuando el dato ya existe</Badge></div><Alert variant="light" className="mb-0 border"><ol className="text-secondary mb-0 d-flex flex-column gap-2 ps-3"><li>Crear o reconciliar primero la organización canónica en Logto.</li><li>Enviar <code>customData</code> derivado de slug, subdominio y dominio directamente a Logto.</li><li>Persistir <code>organization_profiles</code> solo después de Logto para referencias externas, sync y auditoría.</li><li>Crear o resolver el admin base por <code>logtoUserId</code> o por correo y nombre.</li><li>Agregarlo como miembro y asignarle <code>{ORGANIZATION_BOOTSTRAP_ADMIN_ROLE}</code> sin usar al owner global como sustituto.</li><li>Configurar JIT real en Logto con el dominio institucional y el rol por defecto <code>{ORGANIZATION_JIT_DEFAULT_ROLE}</code>.</li><li>Si dejas campos CRM vacíos, Civitas reutiliza datos del paso 1 para evitar retyping.</li></ol></Alert></div></Collapse>
            </div>
            <div className="d-flex flex-column flex-lg-row gap-2">
              {wizardSteps.map((item) => <button key={item.step} type="button" className={`btn flex-fill text-start border ${currentStep === item.step ? "btn-primary" : "btn-light"}`} onClick={() => goToStep(item.step)}><span className="d-block fw-semibold">{item.title}</span><span className={currentStep === item.step ? "small text-white-50" : "small text-secondary"}>{item.description}</span></button>)}
            </div>
            {stepError ? <Alert variant="warning" className="mb-0">{stepError}</Alert> : null}
            {templateResource.data && !templateResource.data.ready ? <Alert variant="danger" className="mb-0">Falta configurar la plantilla de Logto. Roles requeridos ausentes: {templateResource.data.missingRoleNames.join(", ") || ORGANIZATION_BOOTSTRAP_ADMIN_ROLE}.</Alert> : null}
            {currentStep === 1 ? renderStepOne() : null}
            {currentStep === 2 ? renderStepTwo() : null}
            {currentStep === 3 ? renderStepThree() : null}
            <Alert variant="info" className="mb-0">El alta crea o reconcilia la organización en Logto, crea o resuelve el admin base en Logto, lo agrega como miembro, le asigna Admin-org y configura en la API de Logto el dominio institucional con Student-org como rol JIT predeterminado. <code>customData</code> queda solo como metadata auxiliar.</Alert>
            {submitError && <Alert variant="danger" className="mb-0">{submitError}</Alert>}
            {submitWarning ? <Alert variant="warning" className="mb-0"><div className="fw-semibold mb-1">Atención en el paso FluentCRM</div><div>{submitWarning}</div>{submitHints.length > 0 ? <ul className="mt-2 mb-0 ps-3 d-flex flex-column gap-1">{submitHints.map((hint) => <li key={hint}>{hint}</li>)}</ul> : null}</Alert> : null}
            {createdCrmStatus && <Alert variant="success" className="mb-0">Estado FluentCRM: {createdCrmStatus}. La organización canónica y permisos siguen en Logto.</Alert>}
            <div className="d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-3">
              <small className="text-secondary">Si FluentCRM falla, la organización igual queda creada canónicamente en Logto y podrás volver a intentar la vinculación comercial después.</small>
              <div className="d-flex flex-wrap gap-2 align-self-sm-end">
                {currentStep > 1 ? <Button type="button" variant="outline-secondary" onClick={() => setCurrentStep((step) => Math.max(1, step - 1) as WizardStep)}>Anterior</Button> : null}
                {currentStep < 3 ? <Button type="button" onClick={goNext}>Siguiente</Button> : <Button type="submit" disabled={isSubmitting} className="px-4">{isSubmitting ? "Creando..." : "Crear organización"}</Button>}
              </div>
            </div>
          </Form>
        )}
      </PageCard></div></div>
    </PageShell>
  );
}
