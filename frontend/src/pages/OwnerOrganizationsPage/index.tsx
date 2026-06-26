import { useEffect, useMemo, useRef, useState } from "react";
import { Country, State } from "country-state-city";
import { Alert, Badge, Button, Form } from "react-bootstrap";
import { useOwnerApi } from "../../api/owner";
import { useAuthorization } from "../../authz/useAuthorization";
import {
  ORGANIZATION_BOOTSTRAP_ADMIN_ROLE,
  ORGANIZATION_JIT_DEFAULT_ROLE,
} from "../../authLayers";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

const OWNER_ORGANIZATION_DRAFT_KEY = "civitas.owner.organization.create.draft.v3";
const APP_BASE_DOMAINS = ["didaxus.com", "socialstudies.cloud", "learnsocialstudies.com"] as const;

type WizardStep = 1 | 2 | 3;
type CrmField = keyof OwnerOrganizationFormData["crm"];
type AdministrativeContactKey = `responsible${number}`;

type AdministrativeContact = {
  key: AdministrativeContactKey;
  label: string;
  primerNombre: string;
  segundoNombre: string;
  primerApellido: string;
  segundoApellido: string;
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
  appBaseDomain: string;
  adminDomain: string;
  adminRoleName: string;
  jitDefaultRoleName: string;
  crm: {
    companyName: string;
    companyEmail: string;
    companyPhoneCountryCode: string;
    companyPhoneNationalNumber: string;
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
    about: string;
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

type DraftSnapshot = {
  formData: OwnerOrganizationFormData;
  dirty: DirtyState;
  currentStep: WizardStep;
  savedAt: string;
};

const FLUENTCRM_LIKELY_CAUSE_LABELS: Record<string, string> = {
  invalid_username:
    "El usuario no coincide con el username/API username entregado por FluentCRM.",
  duplicate_email:
    "FluentCRM reportó que ya existe un contacto con ese correo; revisa duplicados antes de sincronizar.",
  invalid_payload:
    "FluentCRM rechazó algún dato del contacto: revisa correo, nombres, apellidos, teléfono, cargo y rol/listas/tags.",
  invalid_company_id:
    "FluentCRM rechazó el company_id asociado; verifica la compañía vinculada.",
  invalid_tag:
    "FluentCRM rechazó uno o más tags; valida que existan.",
  invalid_list:
    "FluentCRM rechazó una o más lists; valida que existan.",
  invalid_application_password:
    "La Application Password es inválida o ya no corresponde al usuario elegido.",
  basic_auth_blocked:
    "Alguna capa de seguridad podría estar bloqueando Basic Auth.",
  wrong_base_url_or_site:
    "FLUENTCRM_BASE_URL apunta al sitio equivocado o no es la raíz real de WordPress.",
  wordpress_user_lacks_fluentcrm_permissions:
    "El usuario autenticado no tiene permisos suficientes dentro de FluentCRM.",
  security_plugin_blocks_rest_api:
    "Algún plugin o regla de seguridad está bloqueando la REST API.",
  wrong_base_url:
    "La URL base configurada no coincide con la instalación real de WordPress.",
  fluentcrm_plugin_missing_or_inactive:
    "FluentCRM no está instalado, no está activo o su API no está disponible.",
  rest_route_unavailable:
    "La ruta /wp-json/fluent-crm/v2 no está respondiendo como debería.",
};

const createAdministrativeContact = (index: number, phoneCountryCode = ""): AdministrativeContact => ({
  key: `responsible${index}` as AdministrativeContactKey,
  label: `Usuario ${index}`,
  primerNombre: "",
  segundoNombre: "",
  primerApellido: "",
  segundoApellido: "",
  email: "",
  phoneCountryCode,
  phoneNationalNumber: "",
  phoneExtension: "",
  position: "",
  organizationRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE,
});

const ensureMinimumAdministrativeContact = (
  contacts: AdministrativeContact[],
  phoneCountryCode = "",
) => {
  const source = contacts.length ? contacts : [createAdministrativeContact(1, phoneCountryCode)];
  return source.map((contact, index) => {
    const legacy = contact as unknown as { firstName?: string; lastName?: string };
    return {
      ...createAdministrativeContact(index + 1, phoneCountryCode),
      ...contact,
      key: `responsible${index + 1}` as AdministrativeContactKey,
      label: `Usuario ${index + 1}`,
      primerNombre: contact.primerNombre ?? legacy.firstName ?? "",
      segundoNombre: contact.segundoNombre ?? "",
      primerApellido: contact.primerApellido ?? legacy.lastName ?? "",
      segundoApellido: contact.segundoApellido ?? "",
    };
  });
};

const getAdministrativeContactFullName = (contact?: AdministrativeContact | null) =>
  [contact?.primerNombre, contact?.segundoNombre, contact?.primerApellido, contact?.segundoApellido]
    .map((value) => value?.trim() || "")
    .filter(Boolean)
    .join(" ");

const getPrimaryAdministrativeContact = (contacts: AdministrativeContact[]) =>
  contacts.find((contact) => contact.email.trim() || getAdministrativeContactFullName(contact)) || contacts[0] || null;

const initialFormData: OwnerOrganizationFormData = {
  name: "",
  slug: "",
  appSubdomain: "",
  appBaseDomain: "didaxus.com",
  adminDomain: "",
  adminRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE,
  jitDefaultRoleName: ORGANIZATION_JIT_DEFAULT_ROLE,
  crm: {
    companyName: "",
    companyEmail: "",
    companyPhoneCountryCode: "",
    companyPhoneNationalNumber: "",
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
    about: "",
    description: "",
    nit: "",
    verificationDigit: "",
    tags: [],
    lists: [],
  },
  administrativeContacts: [createAdministrativeContact(1)],
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
    title: "Paso 1. Nueva organización",
    description: "Datos generales de la compañía",
  },
  {
    step: 2,
    title: "Paso 2. Roles y settings",
    description: "Roles, contactos y settings globales",
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

const displayValue = (value?: string | null) => value?.trim() || "—";

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
  const withCode = compact.startsWith("+")
    ? compact
    : callingCode
      ? `+${callingCode.replace(/\D/g, "")}${compact.replace(/^0+/, "")}`
      : compact;
  return /^\+[1-9]\d{6,14}$/.test(withCode) ? withCode : "";
};

const deriveContactTag = (roleName: string) =>
  roleName && roleName !== "owner_global"
    ? roleName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    : null;

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

export function OwnerOrganizationsPage() {
  const ownerApi = useOwnerApi();
  const { canExecute } = useAuthorization();
  const canCreateOrganization = canExecute("owner.organization.create");
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [formData, setFormData] =
    useState<OwnerOrganizationFormData>(initialFormData);
  const [dirty, setDirty] = useState<DirtyState>(initialDirty);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);
  const [submitHints, setSubmitHints] = useState<string[]>([]);
  const [createdCrmStatus, setCreatedCrmStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [listInput, setListInput] = useState("");
  const [draftSnapshot, setDraftSnapshot] = useState<DraftSnapshot | null>(null);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const hasHydratedDraftRef = useRef(false);

  const templateResource = useStableResource({
    initialParams: {},
    load: ownerApi.getOrganizationTemplate,
    getKey: () => "owner-organization-template",
    getErrorMessage: (error) =>
      error instanceof Error
        ? error.message
        : "No se pudo cargar la plantilla de organización de Logto.",
  });

  const roles = templateResource.data?.roles.filter((role) => role.name) ?? [];
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
  const defaultCallingCode =
    selectedCountry?.phonecode?.replace(/\D/g, "") || "";

  const primaryAdministrativeContact = getPrimaryAdministrativeContact(formData.administrativeContacts);
  const effectiveCompanyOwner =
    formData.crm.companyOwner.trim() || getAdministrativeContactFullName(primaryAdministrativeContact);
  const effectiveCompanyEmail = formData.crm.companyEmail.trim() || primaryAdministrativeContact?.email.trim() || "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(OWNER_ORGANIZATION_DRAFT_KEY);
      if (raw) {
        setDraftSnapshot(JSON.parse(raw) as DraftSnapshot);
      }
    } catch {
      window.localStorage.removeItem(OWNER_ORGANIZATION_DRAFT_KEY);
    } finally {
      hasHydratedDraftRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (
      !hasHydratedDraftRef.current ||
      typeof window === "undefined" ||
      isSubmitting
    ) {
      return;
    }
    const snapshot: DraftSnapshot = {
      formData,
      dirty,
      currentStep,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(
      OWNER_ORGANIZATION_DRAFT_KEY,
      JSON.stringify(snapshot),
    );
  }, [formData, dirty, currentStep, isSubmitting]);

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
          : getPrimaryAdministrativeContact(current.administrativeContacts)?.email.trim() || "",
        website: dirty.crm.website ? current.crm.website : current.adminDomain,
        tags: dirty.crm.tags
          ? current.crm.tags
          : uniqueValues([current.name]),
        lists: dirty.crm.lists
          ? current.crm.lists
          : uniqueValues([current.name]),
      },
    }));
  }, [
    formData.name,
    formData.administrativeContacts,
    formData.adminDomain,
    selectedAdminRole,
    selectedJitRole,
    dirty.crm.companyName,
    dirty.crm.companyEmail,
    dirty.crm.website,
    dirty.crm.tags,
    dirty.crm.lists,
  ]);

  const restoreDraft = () => {
    if (!draftSnapshot) return;
    setFormData({
      ...draftSnapshot.formData,
      administrativeContacts: ensureMinimumAdministrativeContact(
        draftSnapshot.formData.administrativeContacts,
        defaultCallingCode,
      ),
    });
    setDirty(draftSnapshot.dirty);
    setCurrentStep(draftSnapshot.currentStep);
    setDraftSnapshot(null);
    setDraftMessage(
      `Borrador restaurado (${new Date(draftSnapshot.savedAt).toLocaleString()}).`,
    );
  };

  const discardDraft = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(OWNER_ORGANIZATION_DRAFT_KEY);
    }
    setDraftSnapshot(null);
    setDraftMessage("Borrador descartado.");
  };

  const getPhoneCountryCode = (value: string) => value.trim() || defaultCallingCode;

  const updateField = (
    field: keyof Omit<OwnerOrganizationFormData, "crm" | "administrativeContacts">,
    value: string,
  ) => {
    setStepError(null);
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const updateCompanyName = (value: string) => {
    setStepError(null);
    setFormData((current) => ({
      ...current,
      name: value,
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
      const next = {
        ...current,
        crm: {
          ...current.crm,
          [field]: value,
          ...(field === "country" ? { state: "" } : {}),
        },
      };
      if (field !== "country") return next;
      const selected = countries.find(
        (country) => country.name === value || country.isoCode === value,
      );
      const selectedCallingCode = selected?.phonecode?.replace(/\D/g, "") || "";
      return {
        ...next,
        crm: {
          ...next.crm,
          companyPhoneCountryCode:
            !current.crm.companyPhoneCountryCode ||
            current.crm.companyPhoneCountryCode === defaultCallingCode
              ? selectedCallingCode
              : current.crm.companyPhoneCountryCode,
        },
        administrativeContacts: current.administrativeContacts.map((contact) => ({
          ...contact,
          phoneCountryCode:
            !contact.phoneCountryCode ||
            contact.phoneCountryCode === defaultCallingCode
              ? selectedCallingCode
              : contact.phoneCountryCode,
        })),
      };
    });
  };

  const updateAdministrativeContact = (
    key: AdministrativeContactKey,
    field:
      | "primerNombre"
      | "segundoNombre"
      | "primerApellido"
      | "segundoApellido"
      | "email"
      | "phoneCountryCode"
      | "phoneNationalNumber"
      | "phoneExtension"
      | "position"
      | "organizationRoleName",
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

  const addAdministrativeContact = () => {
    setStepError(null);
    setFormData((current) => {
      const nextIndex = current.administrativeContacts.length + 1;
      return {
        ...current,
        administrativeContacts: [
          ...current.administrativeContacts,
          createAdministrativeContact(nextIndex, defaultCallingCode),
        ],
      };
    });
  };

  const removeAdministrativeContact = (key: AdministrativeContactKey) => {
    setStepError(null);
    setFormData((current) => ({
      ...current,
      administrativeContacts: ensureMinimumAdministrativeContact(
        current.administrativeContacts.filter((contact) => contact.key !== key),
        defaultCallingCode,
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
      !formData.appSubdomain.trim() ||
      !formData.appBaseDomain.trim() ||
      !formData.adminDomain.trim()
    ) {
      return "Completa los datos obligatorios de la organización antes de avanzar.";
    }
    if (!templateResource.data?.ready) {
      return "Falta configurar la plantilla de Logto antes de continuar.";
    }
    if (!formData.crm.country.trim()) {
      return "Selecciona país antes de continuar.";
    }
    if (
      formData.crm.companyPhoneNationalNumber.trim() &&
      !normalizePhoneForSubmission(
        formData.crm.companyPhoneNationalNumber,
        getPhoneCountryCode(formData.crm.companyPhoneCountryCode),
      )
    ) {
      return "El teléfono de la compañía no tiene un formato válido.";
    }
    return null;
  };

  const getAdministrativeContactValidationError = () => {
    const seen = new Map<string, { name: string; role: string; position: string }>();
    let completeContacts = 0;
    for (const contact of formData.administrativeContacts) {
      const fullName = [contact.primerNombre, contact.segundoNombre, contact.primerApellido, contact.segundoApellido]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" ");
      const email = contact.email.trim().toLowerCase();
      const hasAnyInput = Boolean(
        contact.primerNombre.trim() ||
          contact.segundoNombre.trim() ||
          contact.primerApellido.trim() ||
          contact.segundoApellido.trim() ||
          contact.email.trim() ||
          contact.phoneNationalNumber.trim() ||
          contact.position.trim(),
      );
      if (!hasAnyInput) continue;
      if (!contact.primerNombre.trim() || !contact.primerApellido.trim() || !email || !contact.organizationRoleName.trim()) {
        return `${contact.label}: completa Nombre 1, Apellido 1, correo y rol Logto.`;
      }
      completeContacts += 1;
      if (
        contact.phoneNationalNumber.trim() &&
        !normalizePhoneForSubmission(
          contact.phoneNationalNumber,
          getPhoneCountryCode(contact.phoneCountryCode),
        )
      ) {
        return `${contact.label}: el teléfono no tiene un formato válido.`;
      }
      const current = {
        name: fullName,
        role: contact.organizationRoleName.trim(),
        position: contact.position.trim(),
      };
      const previous = seen.get(email);
      if (previous) {
        return previous.name !== current.name ||
          previous.role !== current.role ||
          previous.position !== current.position
          ? `El correo ${contact.email} está repetido con nombre, cargo o rol distinto.`
          : `El correo ${contact.email} está repetido en contactos administrativos.`;
      }
      seen.set(email, current);
    }
    if (completeContacts === 0) {
      return "Crea al menos 1 usuario con Nombre 1, Apellido 1, correo y rol Logto antes de continuar.";
    }
    return null;
  };

  const validateStepTwo = (): string | null => getAdministrativeContactValidationError();

  const goToStep = (step: WizardStep) => {
    if (step > 1) {
      const error = validateStepOne();
      if (error) {
        setCurrentStep(1);
        setStepError(error);
        return;
      }
    }
    if (step > 2) {
      const error = validateStepTwo();
      if (error) {
        setCurrentStep(2);
        setStepError(error);
        return;
      }
    }
    setStepError(null);
    setCurrentStep(step);
  };

  const goNext = () => {
    const error = currentStep === 1 ? validateStepOne() : validateStepTwo();
    if (error) {
      setStepError(error);
      return;
    }
    setStepError(null);
    setCurrentStep((step) => Math.min(3, step + 1) as WizardStep);
  };



  const getAdministrativeContactsPayload = () =>
    formData.administrativeContacts
      .map((contact) => {
        const fullName = [contact.primerNombre, contact.segundoNombre, contact.primerApellido, contact.segundoApellido]
          .map((value) => value.trim())
          .filter(Boolean)
          .join(" ");
        const email = contact.email.trim();
        const hasAnyInput = Boolean(
          fullName || email || contact.phoneNationalNumber.trim() || contact.phoneExtension.trim() || contact.position.trim(),
        );
        if (!hasAnyInput) return null;
        return {
          kind: contact.key,
          firstName: contact.primerNombre.trim() || undefined,
          middleName: contact.segundoNombre.trim() || undefined,
          firstSurname: contact.primerApellido.trim() || undefined,
          secondSurname: contact.segundoApellido.trim() || undefined,
          primerNombre: contact.primerNombre.trim() || undefined,
          segundoNombre: contact.segundoNombre.trim() || undefined,
          primerApellido: contact.primerApellido.trim() || undefined,
          segundoApellido: contact.segundoApellido.trim() || undefined,
          name: fullName,
          email,
          phone:
            normalizePhoneForSubmission(
              contact.phoneNationalNumber,
              getPhoneCountryCode(contact.phoneCountryCode),
            ) || undefined,
          phoneExtension: contact.phoneExtension.trim() || undefined,
          position: contact.position.trim() || undefined,
          organizationRoleName: contact.organizationRoleName.trim(),
        };
      })
      .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));

  const resetForm = () => {
    setFormData(initialFormData);
    setDirty(initialDirty);
    setCurrentStep(1);
    setTagInput("");
    setListInput("");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(OWNER_ORGANIZATION_DRAFT_KEY);
    }
    setDraftSnapshot(null);
  };

  const handleCreateOrganization = async () => {
    if (!canCreateOrganization) {
      setSubmitError("Tu token owner es de solo lectura. Solicita a Logto un token con owner:write para crear organizaciones.");
      return;
    }

    const stepOneError = validateStepOne();
    if (stepOneError) {
      setCurrentStep(1);
      setStepError(stepOneError);
      return;
    }
    const stepTwoError = validateStepTwo();
    if (stepTwoError) {
      setCurrentStep(2);
      setStepError(stepTwoError);
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
        slug: formData.slug || undefined,
        appSubdomain: formData.appSubdomain,
        appBaseDomain: formData.appBaseDomain,
        adminDomain: formData.adminDomain || undefined,
        jitProvisioning: {
          domain: formData.adminDomain || undefined,
          defaultRoleNames: [selectedJitRole],
        },
        crm: {
          companyName: formData.crm.companyName || formData.name,
          companyEmail:
            effectiveCompanyEmail || undefined,
          companyPhone:
            normalizePhoneForSubmission(
              formData.crm.companyPhoneNationalNumber,
              getPhoneCountryCode(formData.crm.companyPhoneCountryCode),
            ) || undefined,
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
          about: formData.crm.about || undefined,
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
        ...((diagnostic?.code === "FLUENTCRM_VALIDATION_FAILED" ||
          diagnostic?.code === "FLUENTCRM_DUPLICATE_CONTACT") &&
        diagnostic?.message
          ? [diagnostic.message]
          : []),
        ...getFriendlyFluentCrmHints(diagnostic?.likelyCauses),
      ];

      if (result.status === "queued" || result.operationId) {
        setSubmitWarning(result.message || "Solicitud enviada: el bootstrap canónico sigue en curso en segundo plano.");
        setSubmitHints([`Operación: ${result.operationId || "pendiente"}`, "No se limpia el borrador hasta que la operación termine; puedes rehidratarlo con el payloadSnapshot del estado operativo."]);
        setCreatedCrmStatus(result.downstreamStatus || null);
        setDraftMessage("Solicitud encolada. Borrador preservado para reanudar si hay fallo parcial.");
        return;
      }

      resetForm();
      if (result.warning) {
        setSubmitWarning(result.warning);
      }
      setSubmitHints(likelyCauseHints);
      setCreatedCrmStatus(
        typeof result.fluentcrm?.status === "string"
          ? result.fluentcrm.status
          : null,
      );
      setDraftMessage("Organización creada y borrador limpiado.");
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
        {values.length ? (
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
          <span className="text-secondary small">Sin valores configurados.</span>
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
        <h3 className="h5 mb-0">Nueva organización</h3>
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
            placeholder={`https://${formData.adminDomain.trim() || "ejemplo.com.co"}`}
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
        <Form.Group className="col-12 col-xl-3" controlId="ownerOrganizationAppBaseDomain">
          <Form.Label>Dominio base app</Form.Label>
          <Form.Select
            value={formData.appBaseDomain}
            onChange={(event) => updateField("appBaseDomain", event.target.value)}
            required
          >
            {APP_BASE_DOMAINS.map((domain) => (
              <option key={domain} value={domain}>{domain}</option>
            ))}
          </Form.Select>
          <Form.Text className="text-secondary">URL final: https://{formData.appSubdomain || "subdominio"}.{formData.appBaseDomain}</Form.Text>
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
          <Form.Select
            value={formData.crm.country}
            onChange={(event) => updateCrmField("country", event.target.value)}
          >
            <option value="">Selecciona país primero</option>
            {countries.map((country) => (
              <option key={country.isoCode} value={country.name}>
                {country.name}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="col-12 col-xl-3" controlId="ownerOrganizationCrmState">
          <Form.Label>Departamento</Form.Label>
          {countryStates.length ? (
            <Form.Select
              value={formData.crm.state}
              disabled={!selectedCountry}
              onChange={(event) => updateCrmField("state", event.target.value)}
            >
              <option value="">Selecciona departamento</option>
              {countryStates.map((state) => (
                <option key={state.isoCode} value={state.name}>
                  {state.name}
                </option>
              ))}
            </Form.Select>
          ) : (
            <Form.Control
              value={formData.crm.state}
              disabled={!selectedCountry}
              onChange={(event) => updateCrmField("state", event.target.value)}
              placeholder={selectedCountry ? "Ingresa región" : "Selecciona país primero"}
            />
          )}
        </Form.Group>
        <Form.Group className="col-12 col-xl-3" controlId="ownerOrganizationCrmCity">
          <Form.Label>Ciudad</Form.Label>
          <Form.Control
            value={formData.crm.city}
            onChange={(event) => updateCrmField("city", event.target.value)}
            placeholder="Ingresa ciudad"
          />
        </Form.Group>
        <Form.Group className="col-12 col-xl-3" controlId="ownerOrganizationCrmPostalCode">
          <Form.Label>Postal Code</Form.Label>
          <Form.Control
            value={formData.crm.postalCode}
            onChange={(event) => updateCrmField("postalCode", event.target.value)}
            placeholder="Ingresa código postal"
          />
        </Form.Group>
      </div>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmAddressLine1">
          <Form.Label>Dirección línea 1</Form.Label>
          <Form.Control
            value={formData.crm.addressLine1}
            onChange={(event) => updateCrmField("addressLine1", event.target.value)}
            placeholder="Dirección principal"
          />
        </Form.Group>
        <Form.Group className="col-12 col-xl-6" controlId="ownerOrganizationCrmAddressLine2">
          <Form.Label>Dirección línea 2</Form.Label>
          <Form.Control
            value={formData.crm.addressLine2}
            onChange={(event) => updateCrmField("addressLine2", event.target.value)}
            placeholder="Complemento o sede"
          />
        </Form.Group>
      </div>
      <div className="row g-3 align-items-end">
        <Form.Group className="col-12 col-xl-7" controlId="ownerOrganizationCrmCompanyEmail">
          <Form.Label>Company Email</Form.Label>
          <Form.Control
            type="email"
            value={formData.crm.companyEmail}
            onChange={(event) => updateCrmField("companyEmail", event.target.value)}
            placeholder={`contacto@${formData.adminDomain.trim() || "ejemplo.com.co"}`}
          />
        </Form.Group>
        <Form.Group className="col-4 col-xl-1" controlId="ownerOrganizationCrmCompanyPhoneCode">
          <Form.Label>Indicativo</Form.Label>
          <Form.Control
            inputMode="numeric"
            maxLength={4}
            value={formData.crm.companyPhoneCountryCode}
            onChange={(event) =>
              updateCrmField(
                "companyPhoneCountryCode",
                event.target.value.replace(/\D/g, "").slice(0, 4),
              )
            }
            placeholder={defaultCallingCode || "57"}
          />
        </Form.Group>
        <Form.Group className="col-8 col-xl-4" controlId="ownerOrganizationCrmCompanyPhoneNumber">
          <Form.Label>Teléfono compañía</Form.Label>
          <Form.Control
            value={formData.crm.companyPhoneNationalNumber}
            onChange={(event) =>
              updateCrmField("companyPhoneNationalNumber", event.target.value)
            }
            placeholder="3001112233"
          />
        </Form.Group>
      </div>
      <div className="row g-3">
        <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationCrmEmployees">
          <Form.Label>Número de empleados</Form.Label>
          <Form.Control
            type="number"
            min="0"
            value={formData.crm.numberOfEmployees}
            onChange={(event) => updateCrmField("numberOfEmployees", event.target.value)}
          />
        </Form.Group>
        <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationCrmNit">
          <Form.Label>NIT</Form.Label>
          <Form.Control
            type="number"
            min="0"
            value={formData.crm.nit}
            onChange={(event) => updateCrmField("nit", event.target.value)}
          />
        </Form.Group>
        <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationCrmVerificationDigit">
          <Form.Label>Dígito de verificación</Form.Label>
          <Form.Control
            type="number"
            min="0"
            value={formData.crm.verificationDigit}
            onChange={(event) =>
              updateCrmField("verificationDigit", event.target.value.slice(0, 1))
            }
          />
        </Form.Group>
      </div>
      <div className="row g-3">
        <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmIndustry">
          <Form.Label>Industria</Form.Label>
          <Form.Control
            value={formData.crm.industry}
            onChange={(event) => updateCrmField("industry", event.target.value)}
          />
        </Form.Group>
        <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmType">
          <Form.Label>Tipo</Form.Label>
          <Form.Control
            value={formData.crm.type}
            onChange={(event) => updateCrmField("type", event.target.value)}
          />
        </Form.Group>
        <Form.Group className="col-12 col-lg-4" controlId="ownerOrganizationCrmOwner">
          <Form.Label>Responsable interno</Form.Label>
          <Form.Control
            value={formData.crm.companyOwner}
            onChange={(event) => updateCrmField("companyOwner", event.target.value)}
          />
        </Form.Group>
      </div>
      <Form.Group controlId="ownerOrganizationCrmAbout">
        <Form.Label>About this company</Form.Label>
        <Form.Control
          as="textarea"
          rows={2}
          value={formData.crm.about}
          onChange={(event) => updateCrmField("about", event.target.value)}
        />
      </Form.Group>
      <Form.Group controlId="ownerOrganizationCrmDescription">
        <Form.Label>Descripción adicional</Form.Label>
        <Form.Control
          as="textarea"
          rows={2}
          value={formData.crm.description}
          onChange={(event) => updateCrmField("description", event.target.value)}
        />
      </Form.Group>
    </section>
  );

  const renderStepTwo = () => (
    <section className="border rounded-3 p-3 p-lg-4 d-flex flex-column gap-3">
      <div className="d-flex flex-column flex-xl-row justify-content-between align-items-xl-start gap-3">
        <div className="d-flex flex-column gap-1">
          <h3 className="h5 mb-0">Roles y contactos</h3>
          <p className="text-secondary mb-0">
            Contactos adicionales y settings globales. El primer usuario es obligatorio; los demás se agregan al final del último card.
          </p>
        </div>
        <div className="small text-secondary text-xl-end">
          Los checks permanentes de CRM, WordPress, Redis, Logto y Moodle están en Owner / Sistema.
        </div>
      </div>
      <div className="border rounded-3 p-3 d-flex flex-column gap-3 bg-light bg-opacity-50">
        <div>
          <h4 className="h6 mb-0">Creación de usuarios</h4>
          <div className="small text-secondary">Mínimo 1 usuario requerido; agrega los siguientes desde el último card y elimina cualquier adicional con la papelera.</div>
        </div>
        <div className="d-flex flex-column gap-3">
          {formData.administrativeContacts.length === 0 ? (
            <div className="small text-secondary">
              Debes crear al menos 1 usuario. Usa el botón + para añadir más usuarios.
            </div>
          ) : null}
          {formData.administrativeContacts.map((contact, index) => {
            const previewTag = deriveContactTag(contact.organizationRoleName);
            const isLastContact = index === formData.administrativeContacts.length - 1;
            const canRemoveContact = index > 0;
            return (
              <div key={contact.key} className="border rounded-3 p-3 bg-white d-flex flex-column gap-3">
                <div className="d-flex flex-column flex-lg-row justify-content-between gap-2">
                  <div className="d-flex align-items-center gap-2">
                    <h5 className="h6 mb-0">{contact.label}</h5>
                    {canRemoveContact ? (
                      <button
                        type="button"
                        className="btn p-0 border-0 bg-transparent text-secondary d-inline-flex align-items-center justify-content-center"
                        style={{ width: 18, height: 18 }}
                        onClick={() => removeAdministrativeContact(contact.key)}
                        aria-label={`Eliminar ${contact.label}`}
                        title={`Eliminar ${contact.label}`}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 16 16"
                          width="16"
                          height="16"
                          fill="none"
                        >
                          <path
                            d="M2.5 4H13.5"
                            stroke="currentColor"
                            strokeWidth="1.25"
                            strokeLinecap="round"
                          />
                          <path
                            d="M6.5 2.5H9.5"
                            stroke="currentColor"
                            strokeWidth="1.25"
                            strokeLinecap="round"
                          />
                          <path
                            d="M4.5 4L5 12.5C5.03 13.05 5.49 13.5 6.04 13.5H9.96C10.51 13.5 10.97 13.05 11 12.5L11.5 4"
                            stroke="currentColor"
                            strokeWidth="1.25"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M6.5 6.5V11"
                            stroke="currentColor"
                            strokeWidth="1.25"
                            strokeLinecap="round"
                          />
                          <path
                            d="M9.5 6.5V11"
                            stroke="currentColor"
                            strokeWidth="1.25"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                  <div className="d-flex flex-wrap gap-3 small text-secondary">
                    <span>
                      Username Logto:
                      <Badge bg="light" text="primary" className="border ms-1">
                        {buildLogtoUsernamePreview(contact.email)}
                      </Badge>
                    </span>
                    <span>
                      Tag por contacto:{" "}
                      {previewTag ? (
                        <Badge bg="light" text="dark" className="border ms-1">
                          {previewTag}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                </div>
                <div className="row g-3">
                  <Form.Group className="col-12 col-xl-3">
                    <Form.Label>Nombre 1</Form.Label>
                    <Form.Control
                      value={contact.primerNombre}
                      onChange={(event) =>
                        updateAdministrativeContact(contact.key, "primerNombre", event.target.value)
                      }
                    />
                  </Form.Group>
                  <Form.Group className="col-12 col-xl-3">
                    <Form.Label>Nombre 2</Form.Label>
                    <Form.Control
                      value={contact.segundoNombre}
                      onChange={(event) =>
                        updateAdministrativeContact(contact.key, "segundoNombre", event.target.value)
                      }
                    />
                  </Form.Group>
                  <Form.Group className="col-12 col-xl-3">
                    <Form.Label>Apellido 1</Form.Label>
                    <Form.Control
                      value={contact.primerApellido}
                      onChange={(event) =>
                        updateAdministrativeContact(contact.key, "primerApellido", event.target.value)
                      }
                    />
                  </Form.Group>
                  <Form.Group className="col-12 col-xl-3">
                    <Form.Label>Apellido 2</Form.Label>
                    <Form.Control
                      value={contact.segundoApellido}
                      onChange={(event) =>
                        updateAdministrativeContact(contact.key, "segundoApellido", event.target.value)
                      }
                    />
                  </Form.Group>
                  <Form.Group className="col-12 col-xl-6">
                    <Form.Label>Correo</Form.Label>
                    <Form.Control
                      type="email"
                      value={contact.email}
                      onChange={(event) =>
                        updateAdministrativeContact(contact.key, "email", event.target.value)
                      }
                    />
                  </Form.Group>
                  <Form.Group className="col-12 col-xl-2">
                    <Form.Label>Indicativo</Form.Label>
                    <Form.Control
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
                  <Form.Group className="col-12 col-xl-2">
                    <Form.Label>Teléfono</Form.Label>
                    <Form.Control
                      value={contact.phoneNationalNumber}
                      onChange={(event) =>
                        updateAdministrativeContact(contact.key, "phoneNationalNumber", event.target.value)
                      }
                    />
                  </Form.Group>
                  <Form.Group className="col-12 col-xl-1">
                    <Form.Label>Ext.</Form.Label>
                    <Form.Control
                      value={contact.phoneExtension}
                      onChange={(event) =>
                        updateAdministrativeContact(contact.key, "phoneExtension", event.target.value)
                      }
                    />
                  </Form.Group>
                  <Form.Group className="col-12 col-xl-3">
                    <Form.Label>Cargo</Form.Label>
                    <Form.Control
                      value={contact.position}
                      onChange={(event) =>
                        updateAdministrativeContact(contact.key, "position", event.target.value)
                      }
                    />
                  </Form.Group>
                  <Form.Group className="col-12 col-xl-4">
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
                      {!roles.some((role) => role.name === contact.organizationRoleName) ? (
                        <option value={contact.organizationRoleName}>
                          {contact.organizationRoleName}
                        </option>
                      ) : null}
                      {roles.map((role) => (
                        <option value={role.name} key={`${contact.key}-${role.id}`}>
                          {role.name}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </div>
                {isLastContact ? (
                  <div className="d-flex justify-content-end">
                    <Button
                      type="button"
                      variant="outline-primary"
                      size="sm"
                      className="rounded-circle d-inline-flex align-items-center justify-content-center"
                      style={{ width: 40, height: 40 }}
                      onClick={addAdministrativeContact}
                      aria-label="Añadir otro usuario"
                      title="Añadir otro usuario"
                    >
                      +
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="border rounded-3 p-3 d-flex flex-column gap-3 bg-light bg-opacity-50">
        <h4 className="h6 mb-0">Settings globales</h4>
        <div className="row g-3">
          <Form.Group className="col-12 col-xl-4" controlId="ownerOrganizationJitDefaultRole">
            <Form.Label>Rol predeterminado para JIT</Form.Label>
            <Form.Select
              value={selectedJitRole}
              onChange={(event) => updateField("jitDefaultRoleName", event.target.value)}
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
          Revisa y corrige antes del envío final.
        </p>
      </div>
      <div className="row g-3">
        <div className="col-12 col-xl-6">
          <div className="border rounded-3 p-3 h-100 d-flex flex-column gap-2">
            <div className="d-flex justify-content-between gap-2">
              <h4 className="h6 mb-0">Nueva organización</h4>
              <Button type="button" size="sm" variant="outline-secondary" onClick={() => goToStep(1)}>
                Editar
              </Button>
            </div>
            {summaryRow("Nombre organización", formData.name)}
            {summaryRow("Subdominio app", formData.appSubdomain)}
            {summaryRow("Dominio base app", formData.appBaseDomain)}
            {summaryRow("URL de entrada", formData.appSubdomain && formData.appBaseDomain ? `https://${formData.appSubdomain}.${formData.appBaseDomain}` : "")}
            {summaryRow("Dominio de aprovisionamiento", formData.adminDomain)}
            {summaryRow("País", formData.crm.country)}
            {summaryRow("Ciudad", formData.crm.city)}
          </div>
        </div>
        <div className="col-12 col-xl-6">
          <div className="border rounded-3 p-3 h-100 d-flex flex-column gap-2">
            <div className="d-flex justify-content-between gap-2">
              <h4 className="h6 mb-0">Datos CRM</h4>
              <Button type="button" size="sm" variant="outline-secondary" onClick={() => goToStep(1)}>
                Editar
              </Button>
            </div>
            {summaryRow("Company Email", formData.crm.companyEmail)}
            {summaryRow(
              "Teléfono de la compañía",
              normalizePhoneForSubmission(
                formData.crm.companyPhoneNationalNumber,
                getPhoneCountryCode(formData.crm.companyPhoneCountryCode),
              ) || formData.crm.companyPhoneNationalNumber,
            )}
            {summaryRow("Website", formData.crm.website)}
            {summaryRow("Responsable interno", effectiveCompanyOwner)}
            {summaryRow("NIT", formData.crm.nit)}
          </div>
        </div>
        <div className="col-12 col-xl-6">
          <div className="border rounded-3 p-3 h-100 d-flex flex-column gap-2">
            <h4 className="h6 mb-0">Miembros</h4>
            <p className="small text-secondary mb-0">La organización se crea sin usuarios automáticos. Usa “Añadir usuario” en la consola para crear o vincular miembros y seleccionar Admin-org u otro rol.</p>
          </div>
        </div>
        <div className="col-12 col-xl-6">
          <div className="border rounded-3 p-3 h-100 d-flex flex-column gap-3">
            <h4 className="h6 mb-0">Usuarios adicionales y settings</h4>
            <div className="d-flex flex-column gap-2">
              {formData.administrativeContacts.length ? (
                formData.administrativeContacts.map((contact) => (
                  <div key={`summary-${contact.key}`} className="border-bottom pb-2 small">
                    <div className="fw-semibold">{contact.label}</div>
                    <div className="text-secondary">
                      {displayValue(
                        [contact.primerNombre, contact.segundoNombre, contact.primerApellido, contact.segundoApellido]
                          .map((value) => value.trim())
                          .filter(Boolean)
                          .join(" "),
                      )} · {displayValue(contact.email)} · {displayValue(contact.position)}
                    </div>
                    <div>Rol Logto: {displayValue(contact.organizationRoleName)}</div>
                  </div>
                ))
              ) : (
                <div className="small text-secondary">Sin usuarios adicionales.</div>
              )}
            </div>
            <div>
              <div className="small text-secondary mb-1">Tags CRM globales</div>
              <div className="d-flex flex-wrap gap-2">
                {formData.crm.tags.length ? (
                  formData.crm.tags.map((tag) => (
                    <Badge key={tag} bg="light" text="dark" className="border">
                      {tag}
                    </Badge>
                  ))
                ) : (
                  <span className="small text-secondary">Sin tags.</span>
                )}
              </div>
            </div>
            <div>
              <div className="small text-secondary mb-1">Lists CRM global</div>
              <div className="d-flex flex-wrap gap-2">
                {formData.crm.lists.length ? (
                  formData.crm.lists.map((list) => (
                    <Badge key={list} bg="light" text="dark" className="border">
                      {list}
                    </Badge>
                  ))
                ) : (
                  <span className="small text-secondary">Sin lists.</span>
                )}
              </div>
            </div>
            {summaryRow("Rol predeterminado para JIT", selectedJitRole)}
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <PageShell
      eyebrow="Owner / Organizaciones"
      title="Crear organización"
      description="Flujo Logto-first: la organización nace canónicamente en Logto y el formulario queda enfocado en alta, roles y datos comerciales básicos."
      actions={<Badge bg={canCreateOrganization ? "success" : "secondary"}>{canCreateOrganization ? "write habilitado" : "solo lectura"}</Badge>}
    >
      <div className="row g-4">
        <div className="col-12">
          <PageCard
            title="Nueva organización"
            subtitle="Rescate limpio del formulario con enfoque en Logto y datos de CRM."
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
                action={<Button onClick={templateResource.retry}>Reintentar</Button>}
              />
            ) : (
              <Form onSubmit={(event) => event.preventDefault()} className="d-flex flex-column gap-4">
                <div className="d-flex flex-column flex-lg-row gap-2">
                  {wizardSteps.map((item) => (
                    <button
                      key={item.step}
                      type="button"
                      className={`btn flex-fill text-start border ${currentStep === item.step ? "btn-primary" : "btn-light"}`}
                      onClick={() => goToStep(item.step)}
                    >
                      <span className="d-block fw-semibold">{item.title}</span>
                      <span className={currentStep === item.step ? "small text-white-50" : "small text-secondary"}>
                        {item.description}
                      </span>
                    </button>
                  ))}
                </div>
                {draftSnapshot ? (
                  <Alert variant="info" className="mb-0 d-flex flex-column flex-lg-row justify-content-between gap-3">
                    <div>
                      <div className="fw-semibold">Hay un borrador guardado automáticamente.</div>
                      <div className="small">
                        Guardado: {new Date(draftSnapshot.savedAt).toLocaleString()}.
                      </div>
                    </div>
                    <div className="d-flex gap-2 align-self-lg-center">
                      <Button type="button" size="sm" onClick={restoreDraft}>
                        Restaurar
                      </Button>
                      <Button type="button" size="sm" variant="outline-secondary" onClick={discardDraft}>
                        Descartar
                      </Button>
                    </div>
                  </Alert>
                ) : null}
                {draftMessage ? <Alert variant="secondary" className="mb-0">{draftMessage}</Alert> : null}
                {stepError ? <Alert variant="warning" className="mb-0">{stepError}</Alert> : null}
                {!canCreateOrganization ? (
                  <Alert variant="info" className="mb-0">
                    Tu sesión owner tiene permiso de lectura. Puedes revisar la plantilla y el formulario, pero las acciones de creación requieren owner:write emitido por Logto.
                  </Alert>
                ) : null}
                {templateResource.data && !templateResource.data.ready ? (
                  <Alert variant="danger" className="mb-0">
                    Falta configurar la plantilla de Logto. Roles requeridos ausentes: {templateResource.data.missingRoleNames.join(", ") || ORGANIZATION_BOOTSTRAP_ADMIN_ROLE}.
                  </Alert>
                ) : null}
                <fieldset disabled={!canCreateOrganization}>
                  {currentStep === 1 ? renderStepOne() : null}
                  {currentStep === 2 ? renderStepTwo() : null}
                  {currentStep === 3 ? renderStepThree() : null}
                </fieldset>
                {submitError ? <Alert variant="danger" className="mb-0">{submitError}</Alert> : null}
                {submitWarning ? (
                  <Alert variant="warning" className="mb-0">
                    <div className="fw-semibold mb-1">Atención en FluentCRM</div>
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
                {createdCrmStatus ? (
                  <Alert variant="success" className="mb-0">
                    Estado FluentCRM: {createdCrmStatus}. La organización y permisos siguen siendo canónicos en Logto.
                  </Alert>
                ) : null}
                <div className="d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-3">
                  <small className="text-secondary">
                    Si FluentCRM falla, la organización igual queda creada canónicamente en Logto.
                  </small>
                  <div className="d-flex flex-wrap gap-2 align-self-sm-end">
                    {currentStep > 1 ? (
                      <Button
                        type="button"
                        variant="outline-secondary"
                        onClick={() => setCurrentStep((step) => Math.max(1, step - 1) as WizardStep)}
                      >
                        Anterior
                      </Button>
                    ) : null}
                    {currentStep < 3 ? (
                      <Button type="button" onClick={goNext}>
                        Siguiente
                      </Button>
                    ) : (
                      <Button type="button" onClick={handleCreateOrganization} disabled={isSubmitting || !canCreateOrganization} className="px-4">
                        {isSubmitting ? "Creando..." : canCreateOrganization ? "Crear organización" : "Solo lectura"}
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
