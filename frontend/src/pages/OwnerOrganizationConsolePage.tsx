import { useEffect, useState } from "react";
import { Badge, Button, Card, Form, Nav, Table } from "react-bootstrap";
const APP_BASE_DOMAINS = ["didaxus.com", "socialstudies.cloud", "learnsocialstudies.com"] as const;
import { Link, useParams } from "react-router-dom";
import { useOwnerApi, type OwnerOrganizationProfileResponse } from "../api/owner";
import { useAuthorization } from "../authz/useAuthorization";
import { ORGANIZATION_BOOTSTRAP_ADMIN_ROLE } from "../authLayers";
import { useStableResource } from "../shared/hooks/useStableResource";
import { EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

type TabKey = "profile" | "branding" | "members";

type MemberIdentityDraft = { primerNombre: string; segundoNombre: string; primerApellido: string; segundoApellido: string; email: string; phone: string; previousEmail: string };

const getGivenNames = (identity: { primerNombre?: string | null; segundoNombre?: string | null }) =>
  [identity.primerNombre, identity.segundoNombre].map((value) => value?.trim() || "").filter(Boolean).join(" ");

const getSurnames = (identity: { primerApellido?: string | null; segundoApellido?: string | null }) =>
  [identity.primerApellido, identity.segundoApellido].map((value) => value?.trim() || "").filter(Boolean).join(" ");

const buildDisplayName = (identity: { primerNombre?: string | null; segundoNombre?: string | null; primerApellido?: string | null; segundoApellido?: string | null; name?: string | null }) =>
  [getGivenNames(identity), getSurnames(identity)].filter(Boolean).join(" ") || identity.name || "No disponible";

const splitLegacyDisplayName = (name?: string | null) => {
  const parts = name?.split(/\s+/).map((value) => value.trim()).filter(Boolean) ?? [];
  if (parts.length === 0) return { primerNombre: "", segundoNombre: "", primerApellido: "", segundoApellido: "" };
  if (parts.length === 1) return { primerNombre: parts[0], segundoNombre: "", primerApellido: "", segundoApellido: "" };
  if (parts.length === 2) return { primerNombre: parts[0], segundoNombre: "", primerApellido: parts[1], segundoApellido: "" };
  if (parts.length === 3) return { primerNombre: parts[0], segundoNombre: "", primerApellido: parts[1], segundoApellido: parts[2] };
  return { primerNombre: parts[0], segundoNombre: parts.slice(1, -2).join(" "), primerApellido: parts[parts.length - 2], segundoApellido: parts[parts.length - 1] };
};

const buildMemberDraft = (identity: { primerNombre?: string | null; segundoNombre?: string | null; primerApellido?: string | null; segundoApellido?: string | null; email?: string | null; phone?: string | null; name?: string | null }): MemberIdentityDraft => {
  const fallback = !identity.primerNombre && !identity.primerApellido ? splitLegacyDisplayName(identity.name) : splitLegacyDisplayName(null);
  return {
    primerNombre: identity.primerNombre ?? fallback.primerNombre,
    segundoNombre: identity.segundoNombre ?? fallback.segundoNombre,
    primerApellido: identity.primerApellido ?? fallback.primerApellido,
    segundoApellido: identity.segundoApellido ?? fallback.segundoApellido,
    email: identity.email ?? "",
    previousEmail: identity.email ?? "",
    phone: identity.phone ?? "",
  };
};

const cleanMessage = (message?: string | null) => !message ? "Sin detalle funcional." : /failed query|organization_bootstrap_micro_requests|select |insert |update |delete |sql/i.test(message) ? "Hay un pendiente operativo; el detalle técnico quedó registrado para soporte." : message;


const formatValue = (value: unknown) => value === null || value === undefined || value === "" ? "No disponible" : String(value);
const formatJobAge = (seconds?: number | null) => typeof seconds === "number" ? `${seconds}s` : "No disponible";
const statusVariant = (value?: string | null) => {
  if (!value) return "secondary";
  if (["completed", "synced", "linked", "ok", "all_ok", "alive"].includes(value)) return "success";
  if (["queued", "running", "pending", "stuck_in_queue", "worker_heartbeat_stale"].includes(value)) return "warning";
  return "danger";
};

function OperationalStatusCard({ data }: { data: OwnerOrganizationProfileResponse }) {
  const summary = data.sync.summary;
  const provider = data.sync.pending.find((item) => item.operationType === "provider_verification");
  const contactsNotStarted = [...data.sync.pending, ...data.sync.events].find((item) => item.stepName === "contacts_not_started");
  const contactProgress = [...data.sync.pending, ...data.sync.events].find((item) => item.stepName?.includes("fluentcrm_contacts.contact_"));
  const workerState = summary?.workerHeartbeatState || provider?.workerHeartbeatState || "worker_offline";
  const queueStatus = summary?.queueStatus || provider?.queueStatus || provider?.retryState || "not_queued";
  const executionSource = summary?.executionSource || provider?.executionSource || "local_projection";
  const liveLabel = provider?.providerStatus === "all_ok"
    ? "Verificación live exitosa"
    : provider?.providerStatus === "missing_fluentcrm_company"
      ? "FluentCRM Company no existe"
      : provider?.providerStatus === "missing_fluentcrm_contact"
        ? "FluentCRM Contact no existe"
        : provider?.providerStatus === "awaiting_first_wordpress_login"
          ? "Falta usuario WordPress; esperando primer login"
          : provider?.humanMessage || "Sin verificación live completada";
  const nextAction = provider?.suggestedAction || (provider?.providerStatus === "missing_fluentcrm_company" ? "retry_company" : provider?.providerStatus === "missing_fluentcrm_contact" ? "retry_contacts" : provider?.providerStatus === "awaiting_first_wordpress_login" ? "esperar primer login" : "verify_provider");
  const rows = [
    { label: "Canonical status (Logto)", value: summary?.logto || data.organization.profile?.logtoSyncStatus || "No disponible" },
    { label: "Downstream status (FluentCRM)", value: summary?.fluentcrmCompany || data.organization.profile?.fluentcrmSyncStatus || "No disponible" },
    { label: "Worker status", value: workerState },
    { label: "Queue status", value: queueStatus },
    { label: "Fuente de ejecución", value: executionSource },
    { label: "Edad del job", value: formatJobAge(summary?.jobAgeSeconds ?? provider?.jobAgeSeconds) },
    { label: "Última verificación live", value: liveLabel },
    { label: "Contactos", value: contactsNotStarted?.humanMessage || contactProgress?.humanMessage || summary?.fluentcrmContact || "Sin conflicto visible" },
    { label: "Siguiente acción", value: nextAction },
  ];
  return (
    <PageCard title="Estado operativo y worker" subtitle="Distingue Logto canónico, downstream FluentCRM, cola, heartbeat y verificación live real.">
      <div className="d-flex flex-wrap gap-2 mb-3">
        <Badge bg={statusVariant(workerState)}>{workerState}</Badge>
        <Badge bg={statusVariant(queueStatus)}>{queueStatus}</Badge>
        <Badge bg={executionSource === "bullmq" ? "success" : executionSource === "db_poll_fallback" ? "warning" : "secondary"}>{executionSource}</Badge>
      </div>
      <dl className="row mb-0 small">
        {rows.map((row) => (
          <div className="col-12 col-lg-6 mb-3" key={row.label}>
            <dt className="text-secondary">{row.label}</dt>
            <dd className="fw-semibold mb-0 text-break">{formatValue(row.value)}</dd>
          </div>
        ))}
      </dl>
    </PageCard>
  );
}


const getTerritorialState = (business: Record<string, string | null | undefined>) => business.state ?? business.department ?? "";

function getCivitasProfile(data?: OwnerOrganizationProfileResponse | null) {
  const customData = data?.canonical.customData ?? {};
  const civitasProfile = (customData.civitasProfile && typeof customData.civitasProfile === "object" ? customData.civitasProfile : {}) as Record<string, Record<string, string>>;
  return {
    business: civitasProfile.business ?? {},
    contact: civitasProfile.contact ?? {},
    branding: civitasProfile.branding ?? {},
    downstream: civitasProfile.downstream ?? {},
  };
}

function OrganizationSnapshotCard({
  name,
  business,
  contact,
  logoUrl,
}: {
  name: string;
  business: Record<string, string | null>;
  contact: Record<string, string | null>;
  logoUrl?: string | null;
}) {
  const entryUrl = business.entryUrl || (business.appSubdomain && business.appBaseDomain ? `https://${business.appSubdomain}.${business.appBaseDomain}` : null);
  const entryHost = entryUrl ? entryUrl.replace(/^https?:\/\//, "") : null;
  const website = business.website || business.institutionalDomain || null;
  const addressLine = [business.addressLine1, business.addressLine2].filter(Boolean).join(", ");
  const locationLine = [business.city, getTerritorialState(business), business.country, business.postalCode].filter(Boolean).join(" · ");
  const identityLine = [business.nit, business.verificationDigit].filter(Boolean).join(" · ") || entryHost || "Identificación pendiente";

  return (
    <Card className="border shadow-sm overflow-hidden w-100 civitas-organization-card civitas-organization-card--snapshot">
      <div className="p-4 civitas-organization-card__hero">
        <div className="civitas-organization-card__identity">
          <div className="civitas-select-card__logo civitas-organization-card__logo border rounded-3 d-flex flex-column align-items-center justify-content-center text-secondary">
            {logoUrl ? (
              <img src={logoUrl} alt={`Logo de ${name}`} className="img-fluid p-3" />
            ) : (
              <>
                <span className="fs-2">⌂</span>
                <span className="small">Logo</span>
              </>
            )}
          </div>
          <div className="civitas-organization-card__copy">
            <span className="civitas-select-card__eyebrow">▦ Institución educativa</span>
            <h2 className="h3 fw-bold mb-1">{name || "Organización sin nombre"}</h2>
            <p className="mb-0">{identityLine}</p>
          </div>
        </div>
      </div>
      <Card.Body className="civitas-select-card__body p-4">
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
      </Card.Body>
      <Card.Footer className="civitas-select-card__footer bg-white p-3">
        <div className="row g-3">
          <div className="col-12 col-md-6">
            {entryUrl ? (
              <a className="btn btn-outline-primary w-100 rounded-3 fw-semibold civitas-select-card__footer-action" href={entryUrl} target="_blank" rel="noreferrer">
                Sitio web
              </a>
            ) : (
              <button className="btn btn-outline-secondary w-100 rounded-3 fw-semibold civitas-select-card__footer-action" disabled>
                URL pendiente
              </button>
            )}
          </div>
          <div className="col-12 col-md-6">
            {website ? (
              <a className="btn btn-primary w-100 rounded-3 fw-semibold civitas-select-card__footer-action" href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noreferrer">
                Abrir sitio
              </a>
            ) : (
              <button className="btn btn-outline-secondary w-100 rounded-3 fw-semibold civitas-select-card__footer-action" disabled>
                Sitio web pendiente
              </button>
            )}
          </div>
        </div>
      </Card.Footer>
    </Card>
  );
}


function ProfileTab({ data, organizationId, onSaved }: { data: OwnerOrganizationProfileResponse; organizationId: string; onSaved: () => void }) {
  const ownerApi = useOwnerApi();
  const { canExecute } = useAuthorization();
  const canUpdateProfile = canExecute("owner.organization.profile.update");
  const civitas = getCivitasProfile(data);
  const [name, setName] = useState(data.organization.name ?? "");
  const savedBusiness = data.readModel?.business ?? civitas.business;
  const savedContact = data.readModel?.contact ?? civitas.contact;
  const [business, setBusiness] = useState({ slug: savedBusiness.slug ?? data.organization.profile?.slug ?? "", appSubdomain: savedBusiness.appSubdomain ?? savedBusiness.subdomain ?? data.organization.profile?.subdomain ?? "", appBaseDomain: savedBusiness.appBaseDomain ?? "didaxus.com", entryUrl: savedBusiness.entryUrl ?? "", website: savedBusiness.website ?? "", institutionalDomain: savedBusiness.institutionalDomain ?? data.organization.profile?.adminDomain ?? "", nit: savedBusiness.nit ?? "", verificationDigit: savedBusiness.verificationDigit ?? "", country: savedBusiness.country ?? "", state: getTerritorialState(savedBusiness), city: savedBusiness.city ?? "", postalCode: savedBusiness.postalCode ?? "", addressLine1: savedBusiness.addressLine1 ?? "", addressLine2: savedBusiness.addressLine2 ?? "" });
  const [contact, setContact] = useState({ owner: savedContact.owner ?? "", email: savedContact.email ?? "", phone: savedContact.phone ?? "" });
  const [saving, setSaving] = useState(false);
  const save = async () => { if (!canUpdateProfile) return; setSaving(true); try { await ownerApi.updateOrganizationProfile(organizationId, { name, customData: { business: { ...business, state: getTerritorialState(business) }, contact, downstream: { propagateTo: ["fluentcrm"] } } }); onSaved(); } finally { setSaving(false); } };
  return <div className="d-flex flex-column gap-4"><OrganizationSnapshotCard name={name} business={business} contact={contact} logoUrl={data.readModel?.branding?.lightLogoUrl ?? data.readModel?.branding?.logoUrl ?? data.organization.profile?.branding?.logoUrl ?? null} /><OperationalStatusCard data={data} /><PageCard title="Editar datos de la organización" subtitle="Formulario completo de lado a lado. Se precarga desde Logto y CRM; al guardar se actualiza Logto y se encola downstream sync."><Form className="d-flex flex-column gap-4"><fieldset disabled={!canUpdateProfile} className="d-flex flex-column gap-4"><Card className="border-0 bg-light"><Card.Body><h3 className="h6 mb-3">• Identidad y puertas de entrada</h3><div className="row g-3"><Form.Group className="col-12 col-lg-4"><Form.Label>Nombre canónico Logto</Form.Label><Form.Control value={name} onChange={(e) => setName(e.target.value)} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Subdominio app</Form.Label><Form.Control value={business.appSubdomain} onChange={(e) => setBusiness({ ...business, appSubdomain: e.target.value, entryUrl: e.target.value && business.appBaseDomain ? `https://${e.target.value}.${business.appBaseDomain}` : "" })} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Dominio base app</Form.Label><Form.Select value={business.appBaseDomain} onChange={(e) => setBusiness({ ...business, appBaseDomain: e.target.value, entryUrl: business.appSubdomain && e.target.value ? `https://${business.appSubdomain}.${e.target.value}` : "" })}>{APP_BASE_DOMAINS.map((domain) => <option key={domain} value={domain}>{domain}</option>)}</Form.Select><Form.Text className="text-secondary">URL final: {business.appSubdomain && business.appBaseDomain ? `https://${business.appSubdomain}.${business.appBaseDomain}` : "pendiente"}</Form.Text></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Sitio web</Form.Label><Form.Control value={business.website} onChange={(e) => setBusiness({ ...business, website: e.target.value })} /></Form.Group><Form.Group className="col-12"><Form.Label>Dominio institucional de aprovisionamiento</Form.Label><Form.Control value={business.institutionalDomain} onChange={(e) => setBusiness({ ...business, institutionalDomain: e.target.value })} /></Form.Group></div></Card.Body></Card><Card className="border-0 bg-light"><Card.Body><h3 className="h6 mb-3">• Identificación fiscal</h3><div className="row g-3"><Form.Group className="col-12 col-md-6"><Form.Label>NIT</Form.Label><Form.Control value={business.nit} onChange={(e) => setBusiness({ ...business, nit: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-6"><Form.Label>Dígito de verificación</Form.Label><Form.Control value={business.verificationDigit} onChange={(e) => setBusiness({ ...business, verificationDigit: e.target.value })} /></Form.Group></div></Card.Body></Card><Card className="border-0 bg-light"><Card.Body><h3 className="h6 mb-3">• Ubicación</h3><div className="row g-3"><Form.Group className="col-12 col-md-6 col-xl-3"><Form.Label>País</Form.Label><Form.Control value={business.country} onChange={(e) => setBusiness({ ...business, country: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-6 col-xl-3"><Form.Label>Departamento</Form.Label><Form.Control value={business.state} onChange={(e) => setBusiness({ ...business, state: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-6 col-xl-3"><Form.Label>Ciudad</Form.Label><Form.Control value={business.city} onChange={(e) => setBusiness({ ...business, city: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-6 col-xl-3"><Form.Label>Postal Code</Form.Label><Form.Control value={business.postalCode} onChange={(e) => setBusiness({ ...business, postalCode: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-6"><Form.Label>Address Line 1</Form.Label><Form.Control value={business.addressLine1} onChange={(e) => setBusiness({ ...business, addressLine1: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-6"><Form.Label>Address Line 2</Form.Label><Form.Control value={business.addressLine2} onChange={(e) => setBusiness({ ...business, addressLine2: e.target.value })} /></Form.Group></div></Card.Body></Card><Card className="border-0 bg-light"><Card.Body><h3 className="h6 mb-3">• Contacto administrativo</h3><div className="row g-3"><Form.Group className="col-12 col-lg-4"><Form.Label>Responsable</Form.Label><Form.Control value={contact.owner} onChange={(e) => setContact({ ...contact, owner: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Email</Form.Label><Form.Control value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Teléfono</Form.Label><Form.Control value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></Form.Group></div></Card.Body></Card></fieldset><div className="d-grid d-md-flex justify-content-md-end"><Button onClick={save} disabled={saving || !canUpdateProfile}>{saving ? "Guardando…" : canUpdateProfile ? "Guardar en Logto y encolar sync" : "Solo lectura"}</Button></div></Form></PageCard></div>;
}
function BrandingTab({ data, organizationId, onSaved }: { data: OwnerOrganizationProfileResponse; organizationId: string; onSaved: () => void }) { const ownerApi = useOwnerApi(); const { canExecute } = useAuthorization(); const canUpdateBranding = canExecute("owner.organization.profile.update"); const civitas = getCivitasProfile(data); const savedBranding = data.readModel?.branding ?? civitas.branding; const [branding, setBranding] = useState({ lightLogoUrl: savedBranding.lightLogoUrl ?? savedBranding.logoUrl ?? data.organization.profile?.branding?.logoUrl ?? "", lightFaviconUrl: savedBranding.lightFaviconUrl ?? savedBranding.faviconUrl ?? data.organization.profile?.branding?.faviconUrl ?? "", lightPrimaryColor: savedBranding.lightPrimaryColor ?? savedBranding.primaryColor ?? data.organization.profile?.branding?.primaryColor ?? "", darkLogoUrl: savedBranding.darkLogoUrl ?? "", darkFaviconUrl: savedBranding.darkFaviconUrl ?? "", darkPrimaryColor: savedBranding.darkPrimaryColor ?? savedBranding.primaryColorDark ?? data.organization.profile?.branding?.primaryColorDark ?? "" }); const [saving, setSaving] = useState(false); const save = async () => { if (!canUpdateBranding) return; setSaving(true); try { await ownerApi.updateOrganizationProfile(organizationId, { customData: { branding, downstream: { propagateTo: ["logto_custom_css"] } } }); onSaved(); } finally { setSaving(false); } }; return <div className="row g-4"><div className="col-12 col-xl-7"><PageCard title="Branding" subtitle="Estos datos se guardan en Logto customData y el backend genera el CSS de Logto; Civitas no renderiza ese CSS."><Form className="d-flex flex-column gap-3"><fieldset disabled={!canUpdateBranding} className="d-flex flex-column gap-3"><h3 className="h6 mb-0">Tema claro</h3><Form.Group><Form.Label>URL del logotipo de la organización</Form.Label><Form.Control value={branding.lightLogoUrl} onChange={(e) => setBranding({ ...branding, lightLogoUrl: e.target.value })} /></Form.Group><Form.Group><Form.Label>URL del favicon</Form.Label><Form.Control value={branding.lightFaviconUrl} onChange={(e) => setBranding({ ...branding, lightFaviconUrl: e.target.value })} /></Form.Group><Form.Group><Form.Label>Color de la marca</Form.Label><Form.Control value={branding.lightPrimaryColor} onChange={(e) => setBranding({ ...branding, lightPrimaryColor: e.target.value })} placeholder="#0d6efd" /></Form.Group><h3 className="h6 mb-0 mt-2">Tema oscuro</h3><Form.Group><Form.Label>URL del logotipo de la organización (oscuro)</Form.Label><Form.Control value={branding.darkLogoUrl} onChange={(e) => setBranding({ ...branding, darkLogoUrl: e.target.value })} /></Form.Group><Form.Group><Form.Label>URL del favicon (oscuro)</Form.Label><Form.Control value={branding.darkFaviconUrl} onChange={(e) => setBranding({ ...branding, darkFaviconUrl: e.target.value })} /></Form.Group><Form.Group><Form.Label>Color de la marca (oscuro)</Form.Label><Form.Control value={branding.darkPrimaryColor} onChange={(e) => setBranding({ ...branding, darkPrimaryColor: e.target.value })} placeholder="#111827" /></Form.Group></fieldset><Button onClick={save} disabled={saving || !canUpdateBranding}>{saving ? "Guardando…" : canUpdateBranding ? "Guardar branding en Logto" : "Solo lectura"}</Button></Form></PageCard></div><div className="col-12 col-xl-5"><PageCard title="Vista rápida del logo" subtitle="Solo previsualiza URLs; el CSS final lo calcula el backend y lo guarda en Logto.">{branding.lightLogoUrl ? <img src={branding.lightLogoUrl} alt="Logo claro" className="img-fluid border rounded p-3 mb-3" /> : <EmptyState title="Sin logo claro" description="Agrega una URL de logo para previsualizarlo." />}{branding.darkLogoUrl ? <div className="bg-dark rounded p-3"><img src={branding.darkLogoUrl} alt="Logo oscuro" className="img-fluid" /></div> : null}</PageCard></div></div>; }


function MembersTab({ organizationId }: { organizationId: string }) {
  const ownerApi = useOwnerApi();
  const { canExecute } = useAuthorization();
  const canCreateMember = canExecute("owner.organization.member.create");
  const canUpdateMember = canExecute("owner.organization.member.update");
  const canResetMemberPassword = canExecute("owner.organization.member.password.reset");
  const resource = useStableResource({ initialParams: organizationId, load: ownerApi.getOrganizationMembers, getKey: (id) => `members-${id}` });
  const templateResource = useStableResource({ initialParams: "roles", load: ownerApi.getOrganizationTemplate, getKey: () => "organization-template-for-member-create" });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemberIdentityDraft>({ primerNombre: "", segundoNombre: "", primerApellido: "", segundoApellido: "", email: "", previousEmail: "", phone: "" });
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lastLoginFilter, setLastLoginFilter] = useState("all");
  const [mfaFilter, setMfaFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"nombres" | "apellidos" | "rol" | "estado">("apellidos");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newMember, setNewMember] = useState<{ primerNombre: string; segundoNombre: string; primerApellido: string; segundoApellido: string; email: string; phoneCountryCode: string; phoneNational: string; phoneExtension: string; position: string; organizationRoleName: string }>({ primerNombre: "", segundoNombre: "", primerApellido: "", segundoApellido: "", email: "", phoneCountryCode: "57", phoneNational: "", phoneExtension: "", position: "", organizationRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE });
  const templateRoles = templateResource.data?.roles?.map((role) => role.name).filter(Boolean) ?? [];
  const selectableRoles = templateRoles.length > 0 ? templateRoles : [ORGANIZATION_BOOTSTRAP_ADMIN_ROLE];
  useEffect(() => {
    if (!selectableRoles.includes(newMember.organizationRoleName)) setNewMember((current) => ({ ...current, organizationRoleName: selectableRoles[0] || ORGANIZATION_BOOTSTRAP_ADMIN_ROLE }));
  }, [selectableRoles.join("|")]);
  const buildPhone = () => {
    const national = newMember.phoneNational.replace(/\D/g, "");
    const code = newMember.phoneCountryCode.replace(/\D/g, "") || "57";
    return national ? `+${code}${national}` : null;
  };
  const submitNewMember = async () => {
    if (!canCreateMember) return;
    setCreateError(null);
    setCreateSuccess(null);
    if (!newMember.primerNombre.trim() || !newMember.primerApellido.trim() || !newMember.email.trim() || !newMember.organizationRoleName.trim()) {
      setCreateError("Completa Nombre 1, Apellido 1, email y rol para crear el primer miembro o administrador.");
      return;
    }
    setCreating(true);
    try {
      const result = await ownerApi.createOrganizationMember(organizationId, { firstName: newMember.primerNombre.trim(), middleName: newMember.segundoNombre.trim() || null, firstSurname: newMember.primerApellido.trim(), secondSurname: newMember.segundoApellido.trim() || null, email: newMember.email.trim(), phone: buildPhone(), phoneExtension: newMember.phoneExtension.trim() || null, position: newMember.position.trim() || null, organizationRoleName: newMember.organizationRoleName });
      setCreateSuccess(`Usuario encolado/creado con rol ${newMember.organizationRoleName}. Operación: ${String(result.syncOperation?.id ?? "registrada")}.`);
      setNewMember({ primerNombre: "", segundoNombre: "", primerApellido: "", segundoApellido: "", email: "", phoneCountryCode: "57", phoneNational: "", phoneExtension: "", position: "", organizationRoleName: ORGANIZATION_BOOTSTRAP_ADMIN_ROLE });
      resource.retry();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "No se pudo crear o vincular el usuario.");
    } finally {
      setCreating(false);
    }
  };
  const members = resource.data?.members ?? [];
  const roles = Array.from(new Set([...members.flatMap((member) => member.identity.roles ?? []), ...selectableRoles])).sort();
  const toggleSort = (nextSortBy: "nombres" | "apellidos" | "rol" | "estado") => {
    if (sortBy === nextSortBy) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortBy(nextSortBy);
    setSortDirection("asc");
  };
  const sortLabel = (key: "nombres" | "apellidos" | "rol" | "estado") => sortBy === key ? (sortDirection === "asc" ? " ↑" : " ↓") : "";
  const filteredMembers = members.filter((member) => {
    const identity = member.identity;
    const haystack = [identity.primerNombre, identity.segundoNombre, identity.primerApellido, identity.segundoApellido, identity.name, identity.email, identity.phone, identity.logtoUserId, ...(identity.roles ?? [])].filter(Boolean).join(" ").toLowerCase();
    const last = identity.lastLoginAt ? new Date(identity.lastLoginAt).getTime() : null;
    const now = Date.now();
    return (!search.trim() || haystack.includes(search.trim().toLowerCase()))
      && (roleFilter === "all" || (identity.roles ?? []).includes(roleFilter))
      && (statusFilter === "all" || String(member.civitas?.membershipStatus ?? "active") === statusFilter)
      && (mfaFilter === "all" || (mfaFilter === "enabled" ? identity.mfa?.enabled === true : identity.mfa?.enabled === false))
      && (lastLoginFilter === "all" || (lastLoginFilter === "never" ? !last : lastLoginFilter === "7d" ? Boolean(last && now - last <= 7 * 86400000) : lastLoginFilter === "30d" ? Boolean(last && now - last <= 30 * 86400000) : Boolean(last && now - last > 30 * 86400000)));
  });
  const statusRank: Record<string, number> = { active: 1, activo: 1, invited: 2, invitado: 2, pending: 3, pendiente: 3, retryable: 3, hitl_required: 3, suspended: 4, suspendido: 4 };
  const sortedMembers = [...filteredMembers].sort((left, right) => {
    const leftIdentity = left.identity;
    const rightIdentity = right.identity;
    const leftRole = leftIdentity.roles?.[0] ?? "";
    const rightRole = rightIdentity.roles?.[0] ?? "";
    const leftStatus = String(left.civitas?.membershipStatus ?? "active");
    const rightStatus = String(right.civitas?.membershipStatus ?? "active");
    const value = sortBy === "nombres"
      ? getGivenNames(leftIdentity).localeCompare(getGivenNames(rightIdentity), "es", { sensitivity: "base" })
      : sortBy === "apellidos"
        ? getSurnames(leftIdentity).localeCompare(getSurnames(rightIdentity), "es", { sensitivity: "base" })
        : sortBy === "rol"
          ? leftRole.localeCompare(rightRole, "es", { sensitivity: "base" })
          : (statusRank[leftStatus] ?? 99) - (statusRank[rightStatus] ?? 99) || leftStatus.localeCompare(rightStatus, "es", { sensitivity: "base" });
    return sortDirection === "asc" ? value : -value;
  });
  if (resource.isLoading) return <LoadingState title="Cargando miembros" description="Leyendo membresías y roles desde Logto." />;
  if (resource.error) return <ErrorState title="No se pudieron cargar miembros" message={resource.error} action={<Button onClick={resource.retry}>Reintentar</Button>} />;
  return <div className="d-flex flex-column gap-4"><PageCard title="Añadir usuario" subtitle="Flujo único para crear o vincular miembros. Para el primer usuario, deja Admin-org seleccionado o elige cualquier rol disponible."><Form className="row g-3" onSubmit={(event) => { event.preventDefault(); submitNewMember(); }}><fieldset disabled={!canCreateMember} className="row g-3"><Form.Group className="col-12 col-md-3"><Form.Label>Nombre 1 *</Form.Label><Form.Control value={newMember.primerNombre} onChange={(e) => setNewMember({ ...newMember, primerNombre: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-3"><Form.Label>Nombre 2</Form.Label><Form.Control value={newMember.segundoNombre} onChange={(e) => setNewMember({ ...newMember, segundoNombre: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-3"><Form.Label>Apellido 1 *</Form.Label><Form.Control value={newMember.primerApellido} onChange={(e) => setNewMember({ ...newMember, primerApellido: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-3"><Form.Label>Apellido 2</Form.Label><Form.Control value={newMember.segundoApellido} onChange={(e) => setNewMember({ ...newMember, segundoApellido: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Email *</Form.Label><Form.Control type="email" value={newMember.email} onChange={(e) => setNewMember({ ...newMember, email: e.target.value })} /></Form.Group><Form.Group className="col-4 col-lg-2"><Form.Label>País/código</Form.Label><Form.Control inputMode="numeric" value={newMember.phoneCountryCode} onChange={(e) => setNewMember({ ...newMember, phoneCountryCode: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></Form.Group><Form.Group className="col-8 col-lg-3"><Form.Label>Teléfono nacional</Form.Label><Form.Control value={newMember.phoneNational} onChange={(e) => setNewMember({ ...newMember, phoneNational: e.target.value })} /></Form.Group><Form.Group className="col-6 col-lg-1"><Form.Label>Ext.</Form.Label><Form.Control value={newMember.phoneExtension} onChange={(e) => setNewMember({ ...newMember, phoneExtension: e.target.value })} /></Form.Group><Form.Group className="col-6 col-lg-2"><Form.Label>Cargo</Form.Label><Form.Control value={newMember.position} onChange={(e) => setNewMember({ ...newMember, position: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Rol de organización *</Form.Label><Form.Select value={newMember.organizationRoleName} onChange={(e) => setNewMember({ ...newMember, organizationRoleName: e.target.value })}>{selectableRoles.map((role) => <option key={role} value={role}>{role}</option>)}</Form.Select></Form.Group></fieldset><div className="col-12 d-flex flex-wrap gap-2 align-items-center"><Button type="submit" disabled={creating || !canCreateMember}>{creating ? "Creando…" : canCreateMember ? members.length === 0 ? "Crear primer usuario" : "Añadir usuario" : "Solo lectura"}</Button>{members.length === 0 ? <Badge bg="warning" text="dark">Mínimo recomendado: 1 miembro administrador</Badge> : null}{createSuccess ? <span className="text-success small">{createSuccess}</span> : null}{createError ? <span className="text-danger small">{createError}</span> : null}</div></Form></PageCard><PageCard title="Miembros" subtitle="Admin-org es un rol seleccionable normal; este directorio muestra usuarios reales de la organización."><div className="row g-2 mb-3"><Form.Group className="col-12 col-lg-4"><Form.Label>Buscar</Form.Label><Form.Control placeholder="Nombre, apellido, email, teléfono, rol o Logto ID" value={search} onChange={(e) => setSearch(e.target.value)} /></Form.Group><Form.Group className="col-6 col-lg-2"><Form.Label>Rol</Form.Label><Form.Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="all">Todos</option>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</Form.Select></Form.Group><Form.Group className="col-6 col-lg-2"><Form.Label>Estado</Form.Label><Form.Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Todos</option><option value="active">Activo</option><option value="suspended">Suspendido</option><option value="pending">Pendiente</option><option value="invited">Invitado</option><option value="retryable">Retryable</option><option value="hitl_required">HITL</option></Form.Select></Form.Group><Form.Group className="col-6 col-lg-2"><Form.Label>Último login</Form.Label><Form.Select value={lastLoginFilter} onChange={(e) => setLastLoginFilter(e.target.value)}><option value="all">Todos</option><option value="never">Nunca</option><option value="7d">Últimos 7 días</option><option value="30d">Últimos 30 días</option><option value="gt30d">Más de 30 días</option></Form.Select></Form.Group><Form.Group className="col-6 col-lg-2"><Form.Label>MFA</Form.Label><Form.Select value={mfaFilter} onChange={(e) => setMfaFilter(e.target.value)}><option value="all">Todos</option><option value="enabled">Habilitado</option><option value="disabled">No habilitado</option></Form.Select></Form.Group></div><Table responsive hover><thead><tr><th><Button variant="link" className="p-0 text-decoration-none" onClick={() => toggleSort("nombres")}>Nombres{sortLabel("nombres")}</Button></th><th><Button variant="link" className="p-0 text-decoration-none" onClick={() => toggleSort("apellidos")}>Apellidos{sortLabel("apellidos")}</Button></th><th>Email</th><th>Teléfono</th><th><Button variant="link" className="p-0 text-decoration-none" onClick={() => toggleSort("rol")}>Roles{sortLabel("rol")}</Button></th><th><Button variant="link" className="p-0 text-decoration-none" onClick={() => toggleSort("estado")}>Estado{sortLabel("estado")}</Button></th><th>Último login</th><th>MFA</th><th>Acciones</th></tr></thead><tbody>{sortedMembers.map((member) => { const id = member.identity.logtoUserId; const isEditing = editing === id; return <tr key={id ?? member.identity.email}><td>{isEditing ? <fieldset disabled={!canUpdateMember} className="d-flex flex-column gap-2"><Form.Control aria-label="Nombre 1" value={draft.primerNombre} onChange={(e) => setDraft({ ...draft, primerNombre: e.target.value })} /><Form.Control aria-label="Nombre 2" value={draft.segundoNombre} onChange={(e) => setDraft({ ...draft, segundoNombre: e.target.value })} /></fieldset> : getGivenNames(member.identity) || buildDisplayName(member.identity)}</td><td>{isEditing ? <fieldset disabled={!canUpdateMember} className="d-flex flex-column gap-2"><Form.Control aria-label="Apellido 1" value={draft.primerApellido} onChange={(e) => setDraft({ ...draft, primerApellido: e.target.value })} /><Form.Control aria-label="Apellido 2" value={draft.segundoApellido} onChange={(e) => setDraft({ ...draft, segundoApellido: e.target.value })} /></fieldset> : getSurnames(member.identity)}</td><td>{isEditing ? <Form.Control disabled={!canUpdateMember} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /> : member.identity.email ?? "No disponible"}</td><td>{isEditing ? <Form.Control disabled={!canUpdateMember} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /> : member.identity.phone ?? "No disponible"}</td><td>{member.identity.roles?.join(", ") || "Sin rol"}</td><td>{String(member.civitas?.membershipStatus ?? "active")}</td><td>{member.identity.lastLoginAt ? new Date(member.identity.lastLoginAt).toLocaleString() : "Nunca"}</td><td>{member.identity.mfa?.enabled === true ? `Habilitado${member.identity.mfa.method ? ` (${member.identity.mfa.method})` : ""}` : member.identity.mfa?.enabled === false ? "No habilitado" : "No disponible"}</td><td className="d-flex gap-2">{isEditing ? <Button size="sm" disabled={!canUpdateMember} onClick={() => ownerApi.updateOrganizationMember(organizationId, id!, { firstName: draft.primerNombre, middleName: draft.segundoNombre, firstSurname: draft.primerApellido, secondSurname: draft.segundoApellido, email: draft.email, previousEmail: draft.previousEmail, phone: draft.phone }).then(() => { setEditing(null); resource.retry(); })}>Guardar</Button> : <Button size="sm" variant="outline-primary" disabled={!canUpdateMember} onClick={() => { setEditing(id); setDraft(buildMemberDraft(member.identity)); }}>{canUpdateMember ? "Editar" : "Solo lectura"}</Button>}<Button size="sm" variant="outline-secondary" disabled={!canResetMemberPassword} onClick={() => ownerApi.resetOrganizationMemberPassword(organizationId, id!)}>Reset password</Button></td></tr>; })}</tbody></Table></PageCard></div>;
}

export function OwnerOrganizationConsolePage() { const { organizationId = "" } = useParams(); const [tab, setTab] = useState<TabKey>("profile"); const ownerApi = useOwnerApi(); const resource = useStableResource({ initialParams: organizationId, load: ownerApi.getOrganizationProfile, getKey: (id) => `org-console-${id}` }); useEffect(() => { resource.retry(); }, [organizationId]); return <PageShell eyebrow="Consola por organización" title={resource.data?.organization.name ?? "Organización"} description="Perfil de tenant con datos canónicos de Logto, branding y miembros. El timeline operativo vive en /owner/logs." actions={<Link className="btn btn-outline-primary btn-sm" to={`/owner/logs?organizationId=${encodeURIComponent(organizationId)}`}>Ver logs de esta organización</Link>}><Nav variant="tabs" activeKey={tab} onSelect={(key) => setTab((key as TabKey) || "profile")} className="mb-4"><Nav.Item><Nav.Link eventKey="profile">Datos de la organización</Nav.Link></Nav.Item><Nav.Item><Nav.Link eventKey="branding">Branding</Nav.Link></Nav.Item><Nav.Item><Nav.Link eventKey="members">Miembros</Nav.Link></Nav.Item></Nav>{resource.isLoading ? <LoadingState title="Cargando organización" description="Leyendo Logto, sync_operations y auditoría." /> : resource.error ? <ErrorState title="No se pudo cargar la consola" message={cleanMessage(resource.error)} action={<Button onClick={resource.retry}>Reintentar</Button>} /> : resource.data && tab === "profile" ? <ProfileTab data={resource.data} organizationId={organizationId} onSaved={resource.retry} /> : resource.data && tab === "branding" ? <BrandingTab data={resource.data} organizationId={organizationId} onSaved={resource.retry} /> : <MembersTab organizationId={organizationId} />}</PageShell>; }
