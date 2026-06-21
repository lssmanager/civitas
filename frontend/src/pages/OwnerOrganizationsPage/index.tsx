import { useEffect, useMemo, useState } from "react";
import { Country, State } from "country-state-city";
import { Alert, Badge, Button, Form } from "react-bootstrap";
import { ApiRequestError } from "../../api/base";
import { useOwnerApi } from "../../api/owner";
import {
  ORGANIZATION_BOOTSTRAP_ADMIN_ROLE,
  ORGANIZATION_JIT_DEFAULT_ROLE,
} from "../../authLayers";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const FLUENTCRM_LIKELY_CAUSE_LABELS: Record<string, string> = {
  invalid_username:
    "El usuario no coincide con el username/API username entregado por FluentCRM.",
  duplicate_email:
    "FluentCRM reportó que ya existe un contacto con ese correo; revisa duplicados antes de sincronizar.",
  invalid_payload:
    "FluentCRM rechazó algún dato del contacto: revisa correo, nombres, apellidos, teléfono, cargo y rol/listas/tags.",
  invalid_company_id:
    "FluentCRM rechazó el company_id asociado; verifica que la compañía exista y esté vinculada correctamente.",
  invalid_tag:
    "FluentCRM rechazó uno o más tags; verifica que existan y que el nombre no tenga valores inválidos.",
  invalid_list:
    "FluentCRM rechazó una o más listas; verifica que existan y que el nombre no tenga valores inválidos.",
  invalid_application_password:
    "La Application Password es inválida, fue truncada o ya no corresponde al usuario elegido.",
  basic_auth_blocked:
    "El hosting o una capa de seguridad puede estar bloqueando el header Authorization de Basic Auth.",
  wrong_base_url_or_site:
    "FLUENTCRM_BASE_URL apunta al sitio equivocado o no es la base real de WordPress donde vive FluentCRM.",
  wordpress_user_lacks_fluentcrm_permissions:
    "El usuario autenticado no tiene permisos suficientes dentro de FluentCRM.",
  security_plugin_blocks_rest_api:
    "Algún plugin o regla de seguridad está bloqueando la REST API de WordPress o FluentCRM.",
  wrong_base_url:
    "La URL base configurada no coincide con la instalación real de WordPress.",
  fluentcrm_plugin_missing_or_inactive:
    "FluentCRM no está instalado, no está activo o su REST API no está disponible.",
  rest_route_unavailable:
    "La ruta /wp-json/fluent-crm/v2 no está respondiendo como debería.",
};

const getFriendlyFluentCrmHints = (likelyCauses: unknown): string[] => {
  if (!Array.isArray(likelyCauses)) return [];
  return likelyCauses
    .map((cause) =>
      typeof cause === "string"
        ? FLUENTCRM_LIKELY_CAUSE_LABELS[cause] || cause
        : null,
    )
    .filter((value): value is string => Boolean(value));
};

const getDiagnosticFromUnknown = (
  value: unknown,
): { code?: string; message?: string; likelyCauses?: string[] } | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    message:
      typeof candidate.message === "string" ? candidate.message : undefined,
    likelyCauses: Array.isArray(candidate.likelyCauses)
      ? candidate.likelyCauses.filter(
          (item): item is string => typeof item === "string",
        )
      : undefined,
  };
};

type WizardStep = 1 | 2 | 3;
type CrmField = keyof OwnerOrganizationFormData["crm"];
type AdministrativeContactKey = "director" | `responsible${number}`;
type AdministrativeContact = {
  key: AdministrativeContactKey;
  label: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneCountryCode: string;
  phoneNationalNumber: string;
  phoneExtension: string;
  position: string;
  organizationRoleName: string;
};

type OwnerOrganizationFormData = {
  name: string;
  slug: string;
  appSubdomain: string;
  adminDomain: string;
  baseAdminFirstName: string;
  baseAdminLastName: string;
  baseAdminName: string;
  baseAdminEmail: string;
  baseAdminPhoneCountryCode: string;
  baseAdminPhoneNationalNumber: string;
  baseAdminPhoneExtension: string;
  baseAdminPosition: string;
  adminRoleName: string;
  jitDefaultRoleName: string;
  crm: {
    companyName: string;
    companyEmail: string;
    companyPhoneCountryCode: string;
    companyPhoneNationalNumber: string;
    about: string;
    website: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
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

type DirtyState = {
  crm: {
    companyName: boolean;
    companyEmail: boolean;
    website: boolean;
    tags: boolean;
    lists: boolean;
  };
};

const initialFormData: OwnerOrganizationFormData = {
  name: "",
  slug: "",
  appSubdomain: "",
  adminDomain: "",
  baseAdminFirstName: "",
  baseAdminLastName: "",
  baseAdminName: "",
  baseAdminEmail: "",
  baseAdminPhoneCountryCode: "",
  baseAdminPhoneNationalNumber: "",
  baseAdminPhoneExtension: "",
  baseAdminPosition: "Admin base",
  adminRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE,
  jitDefaultRoleName: ORGANIZATION_JIT_DEFAULT_ROLE,
  crm: {
    companyName: "",
    companyEmail: "",
    companyPhoneCountryCode: "",
    companyPhoneNationalNumber: "",
    about: "",
    website: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
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
  administrativeContacts: [],
};

const initialDirty: DirtyState = {
  crm: {
    companyName: false,
    companyEmail: false,
    website: false,
    tags: false,
    lists: false,
  },
};
const wizardSteps: Array<{
  step: WizardStep;
  title: string;
  description: string;
}> = [
  {
    step: 1,
    title: "Paso 1. Nueva Organización",
    description: "Datos generales de la compañía",
  },
  {
    step: 2,
    title: "Paso 2. Creación de usuarios",
    description: "Usuarios y settings globales",
  },
  {
    step: 3,
    title: "Paso 3. Validación final",
    description: "Resumen antes de crear",
  },
];

const uniqueValues = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];
const deriveOrganizationTags = (organizationName: string) =>
  uniqueValues([organizationName]);
const deriveContactTag = (roleName: string) =>
  roleName && roleName !== "owner_global"
    ? roleName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    : null;
const displayValue = (value?: string | null) => value?.trim() || "—";
const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const buildLogtoUsernamePreview = (email: string) =>
  email
    .trim()
    .split("@")[0]
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^([^a-z_])/, "_$1")
    .replace(/^_+$/, "") || "—";
const normalizePhoneForSubmission = (phone: string, callingCode?: string) => {
  const raw = phone.trim();
  if (!raw) return "";
  const compact = raw.replace(/[\s().-]+/g, "");
  const withCode = compact.startsWith("+") ? compact : callingCode ? `+${callingCode.replace(/\D/g, "")}${compact.replace(/^0+/, "")}` : compact;
  return /^\+[1-9]\d{6,14}$/.test(withCode) ? withCode : "";
};

export function OwnerOrganizationsPage() {
  const ownerApi = useOwnerApi();
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [formData, setFormData] =
    useState<OwnerOrganizationFormData>(initialFormData);
  const [dirty, setDirty] = useState<DirtyState>(initialDirty);
  const [stepError, setStepError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [listInput, setListInput] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);
  const [submitHints, setSubmitHints] = useState<string[]>([]);
  const [createdCrmStatus, setCreatedCrmStatus] = useState<string | null>(null);
  const [crmHealthMessage, setCrmHealthMessage] = useState<string | null>(null);
  const [crmHealthHints, setCrmHealthHints] = useState<string[]>([]);
  const [crmHealthVariant, setCrmHealthVariant] = useState<
    "success" | "danger" | "warning" | null
  >(null);
  const [crmHealthChecking, setCrmHealthChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const templateResource = useStableResource({
    initialParams: {},
    load: ownerApi.getOrganizationTemplate,
    getKey: () => "owner-organization-template",
    getErrorMessage: (error) =>
      error instanceof Error
        ? error.message
        : "No se pudo cargar la plantilla de organización de Logto.",
  });
  const wordpressRolesResource = useStableResource({
    initialParams: {},
    load: ownerApi.getWordPressRoles,
    getKey: () => "owner-organization-wordpress-role-catalog",
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudo cargar catálogo WordPress.",
  });

  const roles = templateResource.data?.roles.filter((role) => role.name) ?? [];
  const wordpressRoles = wordpressRolesResource.data?.roles ?? [];
  const selectedAdminRole = roles.some(
    (role) => role.name === formData.adminRoleName,
  )
    ? formData.adminRoleName
    : ORGANIZATION_BOOTSTRAP_ADMIN_ROLE;
  const selectedJitRole = roles.some(
    (role) => role.name === formData.jitDefaultRoleName,
  )
    ? formData.jitDefaultRoleName
    : ORGANIZATION_JIT_DEFAULT_ROLE;
  const countries = useMemo(() => Country.getAllCountries(), []);
  const selectedCountry =
    countries.find(
      (country) =>
        country.name === formData.crm.country ||
        country.isoCode === formData.crm.country,
    ) || null;
  const countryStates = useMemo(
    () =>
      selectedCountry ? State.getStatesOfCountry(selectedCountry.isoCode) : [],
    [selectedCountry],
  );
  const defaultCallingCode = selectedCountry?.phonecode?.replace(/\D/g, "") || "";
  const getPhoneCountryCode = (value: string) => value.trim() || defaultCallingCode;
  const baseAdminFullName = [formData.baseAdminFirstName, formData.baseAdminLastName].map((value) => value.trim()).filter(Boolean).join(" ");
  const primaryHeadContact = formData.administrativeContacts.find((contact) => contact.key === "director" && [contact.firstName, contact.lastName].some((value) => value.trim())) || null;
  const effectiveCompanyOwner = primaryHeadContact ? [primaryHeadContact.firstName, primaryHeadContact.lastName].map((value) => value.trim()).filter(Boolean).join(" ") : baseAdminFullName || formData.crm.companyOwner.trim();

  useEffect(() => {
    setFormData((current) => ({
      ...current,
      adminRoleName: selectedAdminRole,
      jitDefaultRoleName: selectedJitRole,
      crm: {
        ...current.crm,
        companyName: dirty.crm.companyName
          ? current.crm.companyName
          : current.name,
        companyEmail: dirty.crm.companyEmail
          ? current.crm.companyEmail
          : current.baseAdminEmail,
        website: dirty.crm.website ? current.crm.website : current.adminDomain,
        companyOwner: current.crm.companyOwner || [current.baseAdminFirstName, current.baseAdminLastName].filter(Boolean).join(" "),
        tags: dirty.crm.tags
          ? current.crm.tags
          : deriveOrganizationTags(current.name),
        lists: dirty.crm.lists
          ? current.crm.lists
          : uniqueValues([current.name]),
      },
    }));
  }, [
    formData.name,
    formData.baseAdminEmail,
    formData.baseAdminFirstName,
    formData.baseAdminLastName,
    formData.adminDomain,
    selectedAdminRole,
    selectedJitRole,
    dirty.crm.companyName,
    dirty.crm.companyEmail,
    dirty.crm.website,
    dirty.crm.tags,
    dirty.crm.lists,
  ]);

  const updateField = (
    field: keyof Omit<OwnerOrganizationFormData, "crm">,
    value: string,
  ) => {
    setStepError(null);
    setFormData((current) => {
      const next = { ...current, [field]: value };
      if (field === "baseAdminFirstName" || field === "baseAdminLastName") {
        next.baseAdminName = [field === "baseAdminFirstName" ? value : current.baseAdminFirstName, field === "baseAdminLastName" ? value : current.baseAdminLastName].map((item) => item.trim()).filter(Boolean).join(" ");
      }
      return next;
    });
  };

  const updateCompanyName = (value: string) => {
    setStepError(null);
    setFormData((current) => ({
      ...current,
      name: value,
      slug: slugify(value),
      crm: { ...current.crm, companyName: value },
    }));
  };

  const updateCrmField = (
    field: Exclude<CrmField, "tags" | "lists">,
    value: string,
  ) => {
    setStepError(null);
    if (["companyName", "companyEmail", "website"].includes(field)) {
      setDirty((current) => ({
        ...current,
        crm: { ...current.crm, [field]: true },
      }));
    }
    setFormData((current) => {
      const selected = field === "country"
        ? countries.find((country) => country.name === value || country.isoCode === value)
        : null;
      const selectedCallingCode = selected?.phonecode?.replace(/\D/g, "") || "";
      return {
        ...current,
        ...(field === "country" && selectedCallingCode
          ? {
              baseAdminPhoneCountryCode:
                !current.baseAdminPhoneCountryCode || current.baseAdminPhoneCountryCode === defaultCallingCode
                  ? selectedCallingCode
                  : current.baseAdminPhoneCountryCode,
              administrativeContacts: current.administrativeContacts.map((contact) => ({
                ...contact,
                phoneCountryCode:
                  !contact.phoneCountryCode || contact.phoneCountryCode === defaultCallingCode
                    ? selectedCallingCode
                    : contact.phoneCountryCode,
              })),
            }
          : {}),
        crm: {
          ...current.crm,
          [field]: value,
          ...(field === "country"
            ? {
                state: "",
                city: "",
                companyPhoneCountryCode:
                  !current.crm.companyPhoneCountryCode || current.crm.companyPhoneCountryCode === defaultCallingCode
                    ? selectedCallingCode
                    : current.crm.companyPhoneCountryCode,
              }
            : {}),
        },
      };
    });
  };

  const getInstitutionalEmailSuffix = () =>
    formData.adminDomain.trim() ? `@${formData.adminDomain.trim()}` : "";
  const getEmailDomainExample = () =>
    formData.adminDomain.trim() || "ejemplo.com.co";
  const getAdministrativeEmailPlaceholder = (key: AdministrativeContactKey) =>
    `${key === "director" ? "director" : key.replace("responsible", "responsable")}@${getEmailDomainExample()}`;
  const isOnlyInstitutionalEmailSuffix = (email: string) =>
    Boolean(getInstitutionalEmailSuffix()) &&
    email.trim().toLowerCase() === getInstitutionalEmailSuffix().toLowerCase();
  const normalizeAdministrativeEmail = (email: string) =>
    isOnlyInstitutionalEmailSuffix(email) ? "" : email.trim();
  const normalizeAdministrativeContactForSubmission = (
    contact: AdministrativeContact,
  ): {
    value?: {
      kind: AdministrativeContactKey;
      name: string;
      email: string;
      phone?: string;
      position?: string;
      organizationRoleName: string;
    };
    error?: string;
  } | null => {
    const name = [contact.firstName, contact.lastName].map((value) => value.trim()).filter(Boolean).join(" ");
    const email = normalizeAdministrativeEmail(contact.email);
    const phone = normalizePhoneForSubmission(contact.phoneNationalNumber, getPhoneCountryCode(contact.phoneCountryCode));
    const position = contact.position.trim();
    const organizationRoleName = contact.organizationRoleName.trim();
    const hasAnyUserInput = Boolean(contact.firstName.trim() || contact.lastName.trim() || email || contact.phoneNationalNumber.trim() || position);
    if (!hasAnyUserInput) return null;
    if (!name || !email || !organizationRoleName)
      return {
        error: `${contact.label}: completa nombres, apellidos, correo real y rol Logto, o deja el bloque vacío.`,
      };
    return {
      value: {
        kind: contact.key,
        name,
        email,
        phone: phone || undefined,
        position: position || undefined,
        organizationRoleName,
      },
    };
  };

  const getNormalizedAdministrativeContacts = () =>
    formData.administrativeContacts.map(
      normalizeAdministrativeContactForSubmission,
    );
  const getAdministrativeContactValidationError = () => {
    const normalized = getNormalizedAdministrativeContacts();
    const fieldError = normalized.find((result) => result?.error)?.error;
    if (fieldError) return fieldError;
    for (const contact of formData.administrativeContacts) {
      if (contact.phoneNationalNumber.trim() && !normalizePhoneForSubmission(contact.phoneNationalNumber, getPhoneCountryCode(contact.phoneCountryCode))) return `Teléfono inválido para ${contact.email || contact.label}. Usa indicativo de país y número nacional válido.`;
    }

    const seen = new Map<string, { label: string; name: string; position: string; role: string }>();
    for (const result of normalized) {
      if (!result?.value) continue;
      const emailKey = result.value.email.trim().toLowerCase();
      const previous = seen.get(emailKey);
      if (previous) {
        const current = {
          label: String(result.value.kind),
          name: result.value.name.trim(),
          position: (result.value.position || "").trim(),
          role: result.value.organizationRoleName.trim(),
        };
        const differs = previous.name !== current.name || previous.position !== current.position || previous.role !== current.role;
        return differs
          ? `El correo ${result.value.email} está repetido con nombre, cargo o rol distinto. Usa un contacto administrativo único por correo antes de enviar.`
          : `El correo ${result.value.email} está repetido en contactos administrativos. Elimina el duplicado antes de enviar.`;
      }
      seen.set(emailKey, { label: String(result.value.kind), name: result.value.name.trim(), position: (result.value.position || "").trim(), role: result.value.organizationRoleName.trim() });
    }
    return null;
  };
  const getAdministrativeContactsPayload = () =>
    getNormalizedAdministrativeContacts()
      .map((result) => result?.value)
      .filter(
        (
          value,
        ): value is {
          kind: AdministrativeContactKey;
          name: string;
          email: string;
          phone?: string;
          position?: string;
          organizationRoleName: string;
        } => Boolean(value),
      );

  const addAdministrativeContact = () => {
    setStepError(null);
    setFormData((current) => {
      const nextResponsibleNumber = current.administrativeContacts.length + 1;
      return {
        ...current,
        administrativeContacts: [
          ...current.administrativeContacts,
          {
            key: `responsible${nextResponsibleNumber}`,
            label: `Usuario ${nextResponsibleNumber}`,
            firstName: "",
            lastName: "",
            email: "",
            phoneCountryCode: defaultCallingCode,
            phoneNationalNumber: "",
            phoneExtension: "",
            position: "",
            organizationRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE,
          },
        ],
      };
    });
  };

  const updateAdministrativeContact = (
    key: AdministrativeContactKey,
    field: "firstName" | "lastName" | "email" | "phoneCountryCode" | "phoneNationalNumber" | "phoneExtension" | "position" | "organizationRoleName",
    value: string,
  ) => {
    setStepError(null);
    setFormData((current) => ({
      ...current,
      administrativeContacts: current.administrativeContacts.map((contact) =>
        contact.key === key ? { ...contact, [field]: value } : contact,
      ),
    }));
  };

  const addCollectionValue = (collection: "tags" | "lists", value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setDirty((current) => ({
      ...current,
      crm: { ...current.crm, [collection]: true },
    }));
    setFormData((current) => ({
      ...current,
      crm: {
        ...current.crm,
        [collection]: uniqueValues([...current.crm[collection], normalized]),
      },
    }));
    if (collection === "tags") setTagInput("");
    if (collection === "lists") setListInput("");
  };

  const removeCollectionValue = (
    collection: "tags" | "lists",
    value: string,
  ) => {
    setDirty((current) => ({
      ...current,
      crm: { ...current.crm, [collection]: true },
    }));
    setFormData((current) => ({
      ...current,
      crm: {
        ...current.crm,
        [collection]: current.crm[collection].filter((item) => item !== value),
      },
    }));
  };

  const validateStepOne = (): string | null => {
    if (
      !formData.name.trim() ||
      !formData.slug.trim() ||
      !formData.appSubdomain.trim() ||
      !formData.adminDomain.trim()
    ) {
      return "Completa los datos generales obligatorios de la compañía antes de avanzar.";
    }
    if (!templateResource.data?.ready)
      return "Falta configurar la plantilla de Logto antes de continuar.";
    if (!formData.crm.country.trim()) return "Selecciona país antes de validar estado/departamento y teléfonos.";
    if (formData.crm.companyPhoneNationalNumber.trim() && !normalizePhoneForSubmission(formData.crm.companyPhoneNationalNumber, getPhoneCountryCode(formData.crm.companyPhoneCountryCode))) return "Teléfono de la compañía inválido: verifica indicativo de país y número nacional.";
    return null;
  };

  const validateStepTwo = (): string | null => {
    if (!formData.baseAdminFirstName.trim() || !formData.baseAdminLastName.trim() || !formData.baseAdminEmail.trim())
      return "Completa nombres, apellidos y correo del admin base antes de continuar.";
    if (formData.baseAdminPhoneNationalNumber.trim() && !normalizePhoneForSubmission(formData.baseAdminPhoneNationalNumber, getPhoneCountryCode(formData.baseAdminPhoneCountryCode))) return "Teléfono del admin base inválido; usa indicativo de país y número nacional válido.";
    const administrativeValidationError = getAdministrativeContactValidationError();
    if (administrativeValidationError) return administrativeValidationError;
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
    if (step > 2) {
      const validationError = validateStepTwo();
      if (validationError) {
        setCurrentStep(2);
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
    if (currentStep === 2) {
      const validationError = validateStepTwo();
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
      setCrmHealthMessage(
        `Conexión FluentCRM OK. Endpoint verificado: ${result.endpoint || result.baseUrl || "configurado"}.`,
      );
      setCrmHealthHints(
        result.timeoutMs ? [`Timeout activo: ${result.timeoutMs}ms.`] : [],
      );
    } catch (error) {
      const payload = error instanceof ApiRequestError ? error.payload : null;
      const diagnostic = getDiagnosticFromUnknown(payload?.diagnostic);
      setCrmHealthVariant(
        diagnostic?.code === "FLUENTCRM_AUTHENTICATION_FAILED"
          ? "warning"
          : "danger",
      );
      setCrmHealthMessage(
        error instanceof Error
          ? error.message
          : "No se pudo verificar la conexión con FluentCRM.",
      );
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

  const handleCreateOrganization = async () => {
    if (currentStep !== 3) return;
    const validationError = validateStepOne();
    if (validationError) {
      setStepError(validationError);
      setCurrentStep(1);
      return;
    }
    const administrativeValidationError = validateStepTwo();
    if (administrativeValidationError) {
      setStepError(administrativeValidationError);
      setCurrentStep(2);
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
          firstName: formData.baseAdminFirstName || undefined,
          lastName: formData.baseAdminLastName || undefined,
          name: baseAdminFullName || undefined,
          email: formData.baseAdminEmail || undefined,
          phone: normalizePhoneForSubmission(formData.baseAdminPhoneNationalNumber, getPhoneCountryCode(formData.baseAdminPhoneCountryCode)) || undefined,
          initialOrganizationRole: selectedAdminRole,
        },
        jitProvisioning: {
          domain: formData.adminDomain || undefined,
          defaultRoleNames: [selectedJitRole],
        },
        crm: {
          companyName: formData.crm.companyName || formData.name,
          companyEmail:
            formData.crm.companyEmail || formData.baseAdminEmail || undefined,
          companyPhone: normalizePhoneForSubmission(formData.crm.companyPhoneNationalNumber, getPhoneCountryCode(formData.crm.companyPhoneCountryCode)) || undefined,
          about: formData.crm.about || undefined,
          website: formData.crm.website || formData.adminDomain || undefined,
          addressLine1: formData.crm.addressLine1 || undefined,
          addressLine2: formData.crm.addressLine2 || undefined,
          city: formData.crm.city || undefined,
          state: formData.crm.state || undefined,
          postalCode: formData.crm.postalCode || undefined,
          country: formData.crm.country || undefined,
          numberOfEmployees: formData.crm.numberOfEmployees
            ? Number(formData.crm.numberOfEmployees)
            : undefined,
          industry: formData.crm.industry || undefined,
          type: formData.crm.type || undefined,
          companyOwner: effectiveCompanyOwner || undefined,
          description: formData.crm.description || undefined,
          nit: formData.crm.nit ? Number(formData.crm.nit) : undefined,
          verificationDigit: formData.crm.verificationDigit
            ? Number(formData.crm.verificationDigit)
            : undefined,
          tags: formData.crm.tags,
          lists: formData.crm.lists,
        },
        administrativeContacts: getAdministrativeContactsPayload(),
      });

      const fluentCrmStep = result.fluentcrm as
        | Record<string, unknown>
        | undefined;
      const diagnostic = getDiagnosticFromUnknown(fluentCrmStep?.diagnostic);
      const likelyCauseHints = [
        ...(diagnostic?.code === "FLUENTCRM_VALIDATION_FAILED" || diagnostic?.code === "FLUENTCRM_DUPLICATE_CONTACT"
          ? diagnostic?.message
            ? [diagnostic.message]
            : []
          : []),
        ...getFriendlyFluentCrmHints(diagnostic?.likelyCauses),
      ];

      setFormData(initialFormData);
      setDirty(initialDirty);
      setCurrentStep(1);
      setTagInput("");
      setListInput("");
      if (result.warning) {
        if (diagnostic?.code === "FLUENTCRM_AUTHENTICATION_FAILED") {
          setSubmitWarning(
            "La organización sí quedó creada en Logto, pero FluentCRM rechazó la autenticación del API key. Revisa las credenciales y permisos antes de reintentar la vinculación comercial.",
          );
        } else {
          setSubmitWarning(result.warning);
        }
      }
      setSubmitHints(likelyCauseHints);
      setCreatedCrmStatus(
        typeof result.fluentcrm?.status === "string"
          ? result.fluentcrm.status
          : null,
      );
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "No se pudo crear la organización.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderCollectionEditor = (
    collection: "tags" | "lists",
    values: string[],
    inputValue: string,
    setInputValue: (value: string) => void,
    label: string,
  ) => (
    <div className="d-flex flex-column gap-2">
      <Form.Label className="mb-0">{label}</Form.Label>
      <div className="d-flex gap-2">
        <Form.Control
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCollectionValue(collection, inputValue);
            }
          }}
        />
        <Button
          type="button"
          variant="outline-secondary"
          onClick={() => addCollectionValue(collection, inputValue)}
        >
          Agregar
        </Button>
      </div>
      <div className="d-flex flex-wrap gap-2">
        {values.length > 0 ? (
          values.map((value) => (
            <Badge
              key={value}
              bg="light"
              text="dark"
              className="border d-inline-flex align-items-center gap-2 py-2"
            >
              {value}
              <button
                type="button"
                className="btn-close btn-close-sm"
                aria-label={`Quitar ${value}`}
                onClick={() => removeCollectionValue(collection, value)}
              />
            </Badge>
          ))
        ) : (
          <span className="text-secondary small">
            Sin valores configurados.
          </span>
        )}
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
        <h3 className="h5 mb-0">Nueva Organización</h3>
        <p className="text-secondary mb-0">
          Datos generales de la compañía para Logto y FluentCRM.
        </p>
      </div>
      <Form.Group controlId="ownerOrganizationCompanyName">
        <Form.Label>Nombre organización</Form.Label>
        <Form.Control
          size="lg"
          value={formData.name}
          onChange={(event) => updateCompanyName(event.target.value)}
          placeholder="Colegio San José"
          required
        />
      </Form.Group>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmWebsite">
          <Form.Label>Website</Form.Label>
          <Form.Control
            value={formData.crm.website}
            onChange={(event) => updateCrmField("website", event.target.value)}
            placeholder={`https://${getEmailDomainExample()}`}
          />
        </Form.Group>
        <Form.Group className="col-12 col-xl-3" controlId="ownerOrganizationAppSubdomain">
          <Form.Label>Subdominio app</Form.Label>
          <Form.Control
            value={formData.appSubdomain}
            onChange={(event) => updateField("appSubdomain", event.target.value)}
            placeholder="sanjose"
            required
          />
        </Form.Group>
        <Form.Group className="col-12 col-xl-3" controlId="ownerOrganizationAdminDomain">
          <Form.Label>Dominio de aprovisionamiento</Form.Label>
          <Form.Control
            value={formData.adminDomain}
            onChange={(event) => updateField("adminDomain", event.target.value)}
            placeholder="ejemplo.com.co"
            required
          />
        </Form.Group>
      </div>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-3" controlId="ownerOrganizationCrmCountry">
          <Form.Label>País</Form.Label>
          <Form.Select value={formData.crm.country} onChange={(event) => updateCrmField("country", event.target.value)}>
            <option value="">Selecciona país primero</option>
            {countries.map((country) => (
              <option key={country.isoCode} value={country.name}>{country.name}</option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="col-12 col-xl-3" controlId="ownerOrganizationCrmState">
          <Form.Label>Departamento</Form.Label>
          {countryStates.length > 0 ? (
            <Form.Select value={formData.crm.state} disabled={!selectedCountry} onChange={(event) => updateCrmField("state", event.target.value)}>
              <option value="">Selecciona departamento</option>
              {countryStates.map((state) => <option key={state.isoCode} value={state.name}>{state.name}</option>)}
            </Form.Select>
          ) : (
            <Form.Control
              value={formData.crm.state}
              disabled={!selectedCountry}
              onChange={(event) => updateCrmField("state", event.target.value)}
              placeholder={selectedCountry ? "Ingresa región manualmente" : "Selecciona país primero"}
            />
          )}
        </Form.Group>
        <Form.Group className="col-12 col-xl-3" controlId="ownerOrganizationCrmCity">
          <Form.Label>Ciudad</Form.Label>
          <Form.Control value={formData.crm.city} onChange={(event) => updateCrmField("city", event.target.value)} placeholder="Ingresa ciudad" />
        </Form.Group>
        <Form.Group className="col-12 col-xl-3" controlId="ownerOrganizationCrmPostalCode">
          <Form.Label>Postal Code</Form.Label>
          <Form.Control value={formData.crm.postalCode} onChange={(event) => updateCrmField("postalCode", event.target.value)} placeholder="Ingresa código postal" />
        </Form.Group>
      </div>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmAddressLine1">
          <Form.Label>Dirección línea 1</Form.Label>
          <Form.Control value={formData.crm.addressLine1} onChange={(event) => updateCrmField("addressLine1", event.target.value)} placeholder="Ingresa dirección línea 1" />
        </Form.Group>
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmAddressLine2">
          <Form.Label>Dirección línea 2 (opcional)</Form.Label>
          <Form.Control value={formData.crm.addressLine2} onChange={(event) => updateCrmField("addressLine2", event.target.value)} placeholder="Ingresa dirección línea 2" />
        </Form.Group>
      </div>
      <div className="row g-3 align-items-end">
        <Form.Group className="col-12 col-xl-7" controlId="ownerOrganizationCrmCompanyEmail">
          <Form.Label>Company Email</Form.Label>
          <Form.Control type="email" value={formData.crm.companyEmail} onChange={(event) => updateCrmField("companyEmail", event.target.value)} placeholder={`contacto@${getEmailDomainExample()}`} />
        </Form.Group>
        <Form.Group className="col-4 col-xl-1" controlId="ownerOrganizationCrmCompanyPhoneCode">
          <Form.Label>Indicativo</Form.Label>
          <Form.Control inputMode="numeric" maxLength={4} value={formData.crm.companyPhoneCountryCode} onChange={(event) => updateCrmField("companyPhoneCountryCode", event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder={defaultCallingCode || "57"} />
        </Form.Group>
        <Form.Group className="col-8 col-xl-4" controlId="ownerOrganizationCrmCompanyPhoneNumber">
          <Form.Label>Teléfono compañía</Form.Label>
          <Form.Control inputMode="tel" value={formData.crm.companyPhoneNationalNumber} onChange={(event) => updateCrmField("companyPhoneNationalNumber", event.target.value)} placeholder="3001112233" />
        </Form.Group>
      </div>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationCrmEmployees">
          <Form.Label>Número de empleados</Form.Label>
          <Form.Control type="number" min="0" value={formData.crm.numberOfEmployees} onChange={(event) => updateCrmField("numberOfEmployees", event.target.value)} placeholder="Ingresa número de empleados" />
        </Form.Group>
        <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationCrmNit">
          <Form.Label>NIT</Form.Label>
          <Form.Control type="number" min="0" value={formData.crm.nit} onChange={(event) => updateCrmField("nit", event.target.value)} placeholder="Ingresa NIT" />
        </Form.Group>
        <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationCrmVerificationDigit">
          <Form.Label>Dígito de verificación (un carácter)</Form.Label>
          <Form.Control type="number" min="0" maxLength={1} value={formData.crm.verificationDigit} onChange={(event) => updateCrmField("verificationDigit", event.target.value.slice(0, 1))} placeholder="0" />
        </Form.Group>
      </div>
      <Form.Group controlId="ownerOrganizationCrmAbout">
        <Form.Label>About this company</Form.Label>
        <Form.Control as="textarea" rows={2} value={formData.crm.about} onChange={(event) => updateCrmField("about", event.target.value)} placeholder="Describe la compañía" />
      </Form.Group>
      <div className="row g-3">
        <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmIndustry">
          <Form.Label>Industria</Form.Label>
          <Form.Control value={formData.crm.industry} onChange={(event) => updateCrmField("industry", event.target.value)} placeholder="Ingresa industria" />
        </Form.Group>
        <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmType">
          <Form.Label>Tipo</Form.Label>
          <Form.Control value={formData.crm.type} onChange={(event) => updateCrmField("type", event.target.value)} placeholder="Ingresa tipo" />
        </Form.Group>
        <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmOwner">
          <Form.Label>Responsable interno</Form.Label>
          <Form.Control value={formData.crm.companyOwner} onChange={(event) => updateCrmField("companyOwner", event.target.value)} placeholder="Ingresa responsable de la compañía" />
        </Form.Group>
      </div>
      <Form.Group controlId="ownerOrganizationCrmDescription">
        <Form.Label>Descripción adicional</Form.Label>
        <Form.Control as="textarea" rows={2} value={formData.crm.description} onChange={(event) => updateCrmField("description", event.target.value)} placeholder="Ingresa descripción" />
      </Form.Group>
    </section>
  );

  const renderStepTwo = () => (
    <section className="border rounded-3 p-3 p-lg-4 d-flex flex-column gap-3">
      <div className="d-flex flex-column flex-xl-row justify-content-between align-items-xl-start gap-3">
        <div className="d-flex flex-column gap-1">
          <h3 className="h5 mb-0">Creación de usuarios</h3>
          <p className="text-secondary mb-0">
            Usuarios reales en Logto y sincronización downstream al CRM.
          </p>
        </div>
        <div className="d-flex flex-column align-items-xl-end gap-2">
          <Button
            type="button"
            variant="outline-primary"
            onClick={handleCrmHealthCheck}
            disabled={crmHealthChecking}
          >
            {crmHealthChecking
              ? "Verificando conexión..."
              : "Verificar conexión CRM"}
          </Button>
          <small className="text-secondary text-xl-end">
            Comprueba credenciales, endpoint y permisos antes de crear la
            compañía.
          </small>
        </div>
      </div>
      {crmHealthMessage ? (
        <Alert variant={crmHealthVariant || "info"} className="mb-0">
          <div className="fw-semibold mb-1">Diagnóstico FluentCRM</div>
          <div>{crmHealthMessage}</div>
          {crmHealthHints.length > 0 ? (
            <ul className="mt-2 mb-0 ps-3 d-flex flex-column gap-1">
              {crmHealthHints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      <div className="border rounded-3 p-3 d-flex flex-column gap-3 bg-light bg-opacity-50">
        <h4 className="h6 mb-0">Creación de roles</h4>
        <div className="row g-3">
          <Form.Group
            className="col-12 col-xl-3"
            controlId="ownerOrganizationBaseAdminFirstName"
          >
            <Form.Label>Nombres</Form.Label>
            <Form.Control
              value={formData.baseAdminFirstName}
              onChange={(event) => updateField("baseAdminFirstName", event.target.value)}
              placeholder="Mario"
              required
            />
          </Form.Group>
          <Form.Group
            className="col-12 col-xl-3"
            controlId="ownerOrganizationBaseAdminLastName"
          >
            <Form.Label>Apellidos</Form.Label>
            <Form.Control
              value={formData.baseAdminLastName}
              onChange={(event) => updateField("baseAdminLastName", event.target.value)}
              placeholder="Baracus"
              required
            />
          </Form.Group>
          <Form.Group
            className="col-12 col-xl-3"
            controlId="ownerOrganizationBaseAdminEmail"
          >
            <Form.Label>Correo</Form.Label>
            <Form.Control
              type="email"
              value={formData.baseAdminEmail}
              onChange={(event) =>
                updateField("baseAdminEmail", event.target.value)
              }
              placeholder={`admin@${getEmailDomainExample()}`}
              required
            />
          </Form.Group>
          <Form.Group className="col-12 col-xl-2" controlId="ownerOrganizationBaseAdminPhoneCode">
            <Form.Label>Indicativo</Form.Label>
            <Form.Control
              type="tel"
              inputMode="numeric"
              maxLength={4}
              value={formData.baseAdminPhoneCountryCode}
              onChange={(event) => updateField("baseAdminPhoneCountryCode", event.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder={defaultCallingCode || "57"}
            />
          </Form.Group>
          <Form.Group className="col-12 col-xl-2" controlId="ownerOrganizationBaseAdminPhoneNumber">
            <Form.Label>Teléfono</Form.Label>
            <Form.Control
              type="tel"
              value={formData.baseAdminPhoneNationalNumber}
              onChange={(event) => updateField("baseAdminPhoneNationalNumber", event.target.value)}
              placeholder="3001112233"
            />
          </Form.Group>
          <Form.Group className="col-12 col-xl-1" controlId="ownerOrganizationBaseAdminPhoneExtension">
            <Form.Label>Ext.</Form.Label>
            <Form.Control
              value={formData.baseAdminPhoneExtension}
              onChange={(event) => updateField("baseAdminPhoneExtension", event.target.value)}
              placeholder="101"
            />
          </Form.Group>
          <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationBaseAdminPosition">
            <Form.Label>Cargo</Form.Label>
            <Form.Control
              value={formData.baseAdminPosition}
              onChange={(event) => updateField("baseAdminPosition", event.target.value)}
              placeholder="Admin base"
            />
          </Form.Group>
          <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationBaseAdminRole">
            <Form.Label>Rol Logto</Form.Label>
            <Form.Select
              value={selectedAdminRole}
              onChange={(event) => updateField("adminRoleName", event.target.value)}
              disabled={roles.length === 0}
            >
              {!roles.some((role) => role.name === selectedAdminRole) ? (
                <option value={selectedAdminRole}>{selectedAdminRole}</option>
              ) : null}
              {roles.map((role) => (
                <option value={role.name} key={`base-admin-${role.id}`}>
                  {role.name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </div>
        <div className="d-flex flex-wrap gap-3 small text-secondary">
          <span>Username Logto: <Badge bg="light" text="primary" className="border ms-1">{buildLogtoUsernamePreview(formData.baseAdminEmail)}</Badge></span>
          <span>Tag por contacto: <Badge bg="light" text="dark" className="border ms-1">{deriveContactTag(selectedAdminRole) || "—"}</Badge></span>
        </div>
      </div>
      <div className="border rounded-3 p-3 d-flex flex-column gap-3 bg-light bg-opacity-50">
        <div className="d-flex flex-column flex-md-row justify-content-between gap-2">
          <h4 className="h6 mb-0">Roles y usuarios adicionales</h4>
        </div>
        <div className="d-flex flex-column gap-3">
          {formData.administrativeContacts.length === 0 ? (
            <div className="text-secondary small border rounded-3 p-3 bg-white">
              Usa “+” solo si necesitas más roles o usuarios administrativos.
            </div>
          ) : null}
          {formData.administrativeContacts.map((contact) => {
            const previewTag = deriveContactTag(contact.organizationRoleName);
            return (
              <div
                key={contact.key}
                className="border rounded-3 p-3 bg-white d-flex flex-column gap-3"
              >
                <div className="d-flex flex-column flex-lg-row justify-content-between gap-2">
                  <h5 className="h6 mb-0">{contact.label}</h5>
                  <div className="d-flex flex-wrap gap-3 small text-secondary">
                    <span>Username Logto: <Badge bg="light" text="primary" className="border ms-1">{buildLogtoUsernamePreview(contact.email)}</Badge></span>
                    <span>Tag por contacto: {previewTag ? (
                      <Badge bg="light" text="dark" className="border ms-1">
                        {previewTag}
                      </Badge>
                    ) : (
                      "—"
                    )}</span>
                  </div>
                </div>
                <div className="row g-3">
                  <Form.Group
                    className="col-12 col-xl-3"
                    controlId={`ownerOrganizationAdminContactFirstName-${contact.key}`}
                  >
                    <Form.Label>Nombres</Form.Label>
                    <Form.Control
                      value={contact.firstName}
                      onChange={(event) =>
                        updateAdministrativeContact(
                          contact.key,
                          "firstName",
                          event.target.value,
                        )
                      }
                      placeholder="Nombres"
                    />
                  </Form.Group>
                  <Form.Group
                    className="col-12 col-xl-3"
                    controlId={`ownerOrganizationAdminContactLastName-${contact.key}`}
                  >
                    <Form.Label>Apellidos</Form.Label>
                    <Form.Control
                      value={contact.lastName}
                      onChange={(event) =>
                        updateAdministrativeContact(
                          contact.key,
                          "lastName",
                          event.target.value,
                        )
                      }
                      placeholder="Apellidos"
                    />
                  </Form.Group>
                  <Form.Group
                    className="col-12 col-xl-6"
                    controlId={`ownerOrganizationAdminContactEmail-${contact.key}`}
                  >
                    <Form.Label>Correo</Form.Label>
                    <Form.Control
                      type="email"
                      value={contact.email}
                      onChange={(event) =>
                        updateAdministrativeContact(
                          contact.key,
                          "email",
                          event.target.value,
                        )
                      }
                      placeholder={getAdministrativeEmailPlaceholder(
                        contact.key,
                      )}
                    />
                  </Form.Group>
                  <Form.Group
                    className="col-12 col-xl-2"
                    controlId={`ownerOrganizationAdminContactPhoneCode-${contact.key}`}
                  >
                    <Form.Label>Indicativo</Form.Label>
                    <Form.Control
                      type="tel"
                      inputMode="numeric"
                      maxLength={4}
                      value={contact.phoneCountryCode}
                      onChange={(event) =>
                        updateAdministrativeContact(
                          contact.key,
                          "phoneCountryCode",
                          event.target.value.replace(/\D/g, "").slice(0, 4),
                        )
                      }
                      placeholder={defaultCallingCode || "57"}
                    />
                  </Form.Group>
                  <Form.Group
                    className="col-12 col-xl-2"
                    controlId={`ownerOrganizationAdminContactPhoneNumber-${contact.key}`}
                  >
                    <Form.Label>Teléfono</Form.Label>
                    <Form.Control
                      type="tel"
                      value={contact.phoneNationalNumber}
                      onChange={(event) =>
                        updateAdministrativeContact(
                          contact.key,
                          "phoneNationalNumber",
                          event.target.value,
                        )
                      }
                      placeholder="3001112233"
                    />
                  </Form.Group>
                  <Form.Group
                    className="col-12 col-xl-1"
                    controlId={`ownerOrganizationAdminContactPhoneExtension-${contact.key}`}
                  >
                    <Form.Label>Ext.</Form.Label>
                    <Form.Control
                      value={contact.phoneExtension}
                      onChange={(event) =>
                        updateAdministrativeContact(
                          contact.key,
                          "phoneExtension",
                          event.target.value,
                        )
                      }
                      placeholder="101"
                    />
                  </Form.Group>
                  <Form.Group
                    className="col-12 col-xl-3"
                    controlId={`ownerOrganizationAdminContactPosition-${contact.key}`}
                  >
                    <Form.Label>Cargo</Form.Label>
                    <Form.Control
                      value={contact.position}
                      onChange={(event) =>
                        updateAdministrativeContact(
                          contact.key,
                          "position",
                          event.target.value,
                        )
                      }
                      placeholder={contact.label}
                    />
                  </Form.Group>
                  <Form.Group
                    className="col-12 col-xl-4"
                    controlId={`ownerOrganizationAdminContactRole-${contact.key}`}
                  >
                    <Form.Label>Rol Logto</Form.Label>
                    <Form.Select
                      value={contact.organizationRoleName}
                      onChange={(event) =>
                        updateAdministrativeContact(
                          contact.key,
                          "organizationRoleName",
                          event.target.value,
                        )
                      }
                      disabled={roles.length === 0}
                    >
                      {!roles.some(
                        (role) => role.name === contact.organizationRoleName,
                      ) ? (
                        <option value={contact.organizationRoleName}>
                          {contact.organizationRoleName}
                        </option>
                      ) : null}
                      {roles.map((role) => (
                        <option
                          value={role.name}
                          key={`${contact.key}-${role.id}`}
                        >
                          {role.name}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </div>
              </div>
            );
          })}
          <div className="d-flex justify-content-end">
            <Button type="button" variant="outline-primary" size="sm" onClick={addAdministrativeContact} aria-label="Añadir rol">
              +
            </Button>
          </div>
        </div>
      </div>
      <div className="border rounded-3 p-3 d-flex flex-column gap-3 bg-light bg-opacity-50">
        <h4 className="h6 mb-0">Settings globales</h4>
        <div className="row g-3">
          <Form.Group
            className="col-12 col-xl-4"
            controlId="ownerOrganizationJitDefaultRole"
          >
            <Form.Label>Rol predeterminado para JIT</Form.Label>
            <Form.Select
              value={selectedJitRole}
              onChange={(event) =>
                updateField("jitDefaultRoleName", event.target.value)
              }
              disabled={roles.length === 0}
            >
              {roles
                .filter((role) => role.name === ORGANIZATION_JIT_DEFAULT_ROLE)
                .map((role) => (
                  <option value={role.name} key={role.id}>
                    {role.name}
                  </option>
                ))}
            </Form.Select>
          </Form.Group>
          <div className="col-12 col-xl-4">
            {renderCollectionEditor(
              "tags",
              formData.crm.tags,
              tagInput,
              setTagInput,
              "Tags CRM globales de organización",
            )}
          </div>
          <div className="col-12 col-xl-4">
            {renderCollectionEditor(
              "lists",
              formData.crm.lists,
              listInput,
              setListInput,
              "Lists CRM global",
            )}
          </div>
        </div>
      </div>
    </section>
  );

  const renderStepThree = () => (
    <section className="border rounded-3 p-3 p-lg-4 d-flex flex-column gap-3">
      <div className="d-flex flex-column gap-1">
        <h3 className="h5 mb-0">Paso 3. Validación final</h3>
        <p className="text-secondary mb-0">
          Revisa y corrige antes del submit final. La creación solo se ejecuta
          desde este paso.
        </p>
      </div>
      <div className="row g-3">
        <div className="col-12 col-xl-6">
          <div className="border rounded-3 p-3 h-100 d-flex flex-column gap-2">
            <div className="d-flex justify-content-between gap-2">
              <h4 className="h6 mb-0">Nueva Organización</h4>
              <Button
                type="button"
                size="sm"
                variant="outline-secondary"
                onClick={() => goToStep(1)}
              >
                Editar
              </Button>
            </div>
            {summaryRow("Nombre organización", formData.name)}
            {summaryRow("Slug", formData.slug)}
            {summaryRow("Subdominio app", formData.appSubdomain)}
            {summaryRow("Dominio de aprovisionamiento", formData.adminDomain)}
          </div>
        </div>
        <div className="col-12 col-xl-6">
          <div className="border rounded-3 p-3 h-100 d-flex flex-column gap-2">
            <div className="d-flex justify-content-between gap-2">
              <h4 className="h6 mb-0">Datos CRM</h4>
              <Button
                type="button"
                size="sm"
                variant="outline-secondary"
                onClick={() => goToStep(2)}
              >
                Editar
              </Button>
            </div>
            {summaryRow("Company Email", formData.crm.companyEmail)}
            {summaryRow("Teléfono de la compañía", normalizePhoneForSubmission(formData.crm.companyPhoneNationalNumber, getPhoneCountryCode(formData.crm.companyPhoneCountryCode)) || formData.crm.companyPhoneNationalNumber)}
            {summaryRow("Website", formData.crm.website)}
            {summaryRow("Dirección línea 1", formData.crm.addressLine1)}
            {summaryRow("Dirección línea 2", formData.crm.addressLine2)}
            {summaryRow("Ciudad", formData.crm.city)}
            {summaryRow("Departamento", formData.crm.state)}
            {summaryRow("Postal Code", formData.crm.postalCode)}
            {summaryRow("País", formData.crm.country)}
            {summaryRow("Número de empleados", formData.crm.numberOfEmployees)}
            {summaryRow("Industria", formData.crm.industry)}
            {summaryRow("Tipo", formData.crm.type)}
            {summaryRow("Responsable interno", effectiveCompanyOwner)}
            {summaryRow("NIT", formData.crm.nit)}
            {summaryRow(
              "Dígito de verificación (un carácter)",
              formData.crm.verificationDigit,
            )}
          </div>
        </div>
        <div className="col-12 col-xl-6">
          <div className="border rounded-3 p-3 h-100 d-flex flex-column gap-2">
            <h4 className="h6 mb-0">Perfil de usuario / Logto</h4>
            {summaryRow("Nombres", formData.baseAdminFirstName)}
            {summaryRow("Apellidos", formData.baseAdminLastName)}
            {summaryRow("Email admin base", formData.baseAdminEmail)}
            {summaryRow("Teléfono admin base normalizado", normalizePhoneForSubmission(formData.baseAdminPhoneNationalNumber, getPhoneCountryCode(formData.baseAdminPhoneCountryCode)) || formData.baseAdminPhoneNationalNumber)}
            {summaryRow("Cargo", formData.baseAdminPosition)}
            {summaryRow("Rol Logto", selectedAdminRole)}
            <div className="small text-secondary">Payload custom del perfil: {JSON.stringify({ phone: normalizePhoneForSubmission(formData.baseAdminPhoneNationalNumber, getPhoneCountryCode(formData.baseAdminPhoneCountryCode)) || undefined, companyOwner: effectiveCompanyOwner })}</div>
            <h4 className="h6 mb-0 mt-2">Creación de usuarios</h4>
            {formData.administrativeContacts.map((contact) => (
              <div
                key={`summary-${contact.key}`}
                className="border-bottom pb-2"
              >
                <div className="fw-semibold">{contact.label}</div>
                <div className="small text-secondary">
                  {displayValue([contact.firstName, contact.lastName].map((value) => value.trim()).filter(Boolean).join(" "))} · {displayValue(contact.email)} ·{" "}
                  {displayValue(normalizePhoneForSubmission(contact.phoneNationalNumber, getPhoneCountryCode(contact.phoneCountryCode)) || contact.phoneNationalNumber)} ·{" "}
                  {displayValue(contact.position)}
                </div>
                <div className="small">
                  Rol Logto: {displayValue(contact.organizationRoleName)}
                </div>
                <div className="small">
                  Tag por contacto:{" "}
                  {deriveContactTag(contact.organizationRoleName) || "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="col-12 col-xl-6">
          <div className="border rounded-3 p-3 h-100 d-flex flex-column gap-3">
            <h4 className="h6 mb-0">Settings globales</h4>
            <h4 className="h6 mb-0">Tags CRM globales de organización</h4>
            <div className="d-flex flex-wrap gap-2">
              {formData.crm.tags.length ? (
                formData.crm.tags.map((tag) => (
                  <Badge key={tag} bg="light" text="dark" className="border">
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-secondary small">Sin tags.</span>
              )}
            </div>
            <h4 className="h6 mb-0">Lists CRM global</h4>
            <div className="d-flex flex-wrap gap-2">
              {formData.crm.lists.length ? (
                formData.crm.lists.map((list) => (
                  <Badge key={list} bg="light" text="dark" className="border">
                    {list}
                  </Badge>
                ))
              ) : (
                <span className="text-secondary small">Sin lists.</span>
              )}
            </div>
            <h4 className="h6 mb-0">Catálogo WordPress/BuddyBoss/bbPress</h4>
            <div className="d-flex flex-wrap gap-2">
              {wordpressRoles.length ? wordpressRoles.slice(0, 12).map((role) => <Badge key={role.slug} bg="light" text="dark" className="border">{role.name} ({role.slug})</Badge>) : <span className="text-secondary small">Catálogo no cargado o no disponible.</span>}
            </div>
            <h4 className="h6 mb-0">Descripción adicional / About</h4>
            {summaryRow("About this company", formData.crm.about)}
            {summaryRow("Descripción adicional", formData.crm.description)}
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <PageShell
      eyebrow="Owner / Organizaciones"
      title="Crear organización"
      description="Flujo Logto-first: la organización nace canónicamente en Logto; Civitas no crea una pre-organización local ni checkpoints pending para validar el alta."
      actions={<Badge bg="success">organizations:create</Badge>}
    >
      <div className="row g-4">
        <div className="col-12">
          <PageCard
            title="Nueva organización"
            subtitle="Logto es la fuente canónica; la base local queda fuera del camino obligatorio de creación."
          >
            {templateResource.isLoading ? (
              <LoadingState
                title="Cargando plantilla"
                description="Consultando roles de la organization template de Logto."
              />
            ) : templateResource.error ? (
              <ErrorState
                title="No se pudo cargar la plantilla"
                message={templateResource.error}
                action={
                  <Button onClick={templateResource.retry}>Reintentar</Button>
                }
              />
            ) : (
              <Form
                onSubmit={(event) => event.preventDefault()}
                className="d-flex flex-column gap-4"
              >
                <div className="d-flex flex-column flex-lg-row gap-2">
                  {wizardSteps.map((item) => (
                    <button
                      key={item.step}
                      type="button"
                      className={`btn flex-fill text-start border ${currentStep === item.step ? "btn-primary" : "btn-light"}`}
                      onClick={() => goToStep(item.step)}
                    >
                      <span className="d-block fw-semibold">{item.title}</span>
                      <span
                        className={
                          currentStep === item.step
                            ? "small text-white-50"
                            : "small text-secondary"
                        }
                      >
                        {item.description}
                      </span>
                    </button>
                  ))}
                </div>
                {stepError ? (
                  <Alert variant="warning" className="mb-0">
                    {stepError}
                  </Alert>
                ) : null}
                {templateResource.data && !templateResource.data.ready ? (
                  <Alert variant="danger" className="mb-0">
                    Falta configurar la plantilla de Logto. Roles requeridos
                    ausentes:{" "}
                    {templateResource.data.missingRoleNames.join(", ") ||
                      ORGANIZATION_BOOTSTRAP_ADMIN_ROLE}
                    .
                  </Alert>
                ) : null}
                {currentStep === 1 ? renderStepOne() : null}
                {currentStep === 2 ? renderStepTwo() : null}
                {currentStep === 3 ? renderStepThree() : null}
                {submitError && (
                  <Alert variant="danger" className="mb-0">
                    {submitError}
                  </Alert>
                )}
                {submitWarning ? (
                  <Alert variant="warning" className="mb-0">
                    <div className="fw-semibold mb-1">
                      Atención en el paso FluentCRM
                    </div>
                    <div>{submitWarning}</div>
                    {submitHints.length > 0 ? (
                      <ul className="mt-2 mb-0 ps-3 d-flex flex-column gap-1">
                        {submitHints.map((hint) => (
                          <li key={hint}>{hint}</li>
                        ))}
                      </ul>
                    ) : null}
                  </Alert>
                ) : null}
                {createdCrmStatus && (
                  <Alert variant="success" className="mb-0">
                    Estado FluentCRM: {createdCrmStatus}. La organización
                    canónica y permisos siguen en Logto.
                  </Alert>
                )}
                <div className="d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-3">
                  <small className="text-secondary">
                    Si FluentCRM falla, la organización igual queda creada
                    canónicamente en Logto y podrás volver a intentar la
                    vinculación comercial después.
                  </small>
                  <div className="d-flex flex-wrap gap-2 align-self-sm-end">
                    {currentStep > 1 ? (
                      <Button
                        type="button"
                        variant="outline-secondary"
                        onClick={() =>
                          setCurrentStep(
                            (step) => Math.max(1, step - 1) as WizardStep,
                          )
                        }
                      >
                        Anterior
                      </Button>
                    ) : null}
                    {currentStep < 3 ? (
                      <Button type="button" onClick={goNext}>
                        Siguiente
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={handleCreateOrganization}
                        disabled={isSubmitting}
                        className="px-4"
                      >
                        {isSubmitting ? "Creando..." : "Crear organización"}
                      </Button>
                    )}
                  </div>
                </div>
              </Form>
            )}
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}
