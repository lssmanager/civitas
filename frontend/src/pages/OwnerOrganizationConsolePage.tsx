import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Form, Nav, Table } from "react-bootstrap";
import { useParams } from "react-router-dom";
import { useOwnerApi, type OwnerOrganizationProfileResponse } from "../api/owner";
import { ORGANIZATION_BOOTSTRAP_ADMIN_ROLE } from "../authLayers";
import { useStableResource } from "../shared/hooks/useStableResource";
import { EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

type TabKey = "profile" | "branding" | "events" | "members";

type MemberIdentityDraft = { primerNombre: string; segundoNombre: string; primerApellido: string; segundoApellido: string; email: string; phone: string; previousEmail: string };

const buildDisplayName = (identity: { primerNombre?: string | null; segundoNombre?: string | null; primerApellido?: string | null; segundoApellido?: string | null; name?: string | null }) =>
  [identity.primerNombre, identity.segundoNombre, identity.primerApellido, identity.segundoApellido].map((value) => value?.trim() || "").filter(Boolean).join(" ") || identity.name || "No disponible";

const buildMemberDraft = (identity: { primerNombre?: string | null; segundoNombre?: string | null; primerApellido?: string | null; segundoApellido?: string | null; email?: string | null; phone?: string | null; name?: string | null }): MemberIdentityDraft => {
  const parts = !identity.primerNombre && !identity.primerApellido && identity.name ? identity.name.split(/\s+/).filter(Boolean) : [];
  return {
    primerNombre: identity.primerNombre ?? parts[0] ?? "",
    segundoNombre: identity.segundoNombre ?? (parts.length > 3 ? parts.slice(1, -2).join(" ") : ""),
    primerApellido: identity.primerApellido ?? (parts.length > 1 ? parts[parts.length - 2] ?? parts[1] ?? "" : ""),
    segundoApellido: identity.segundoApellido ?? (parts.length > 2 ? parts[parts.length - 1] ?? "" : ""),
    email: identity.email ?? "",
    previousEmail: identity.email ?? "",
    phone: identity.phone ?? "",
  };
};

const cleanMessage = (message?: string | null) => !message ? "Sin detalle funcional." : /failed query|organization_bootstrap_micro_requests|select |insert |update |delete |sql/i.test(message) ? "Hay un pendiente operativo; el detalle técnico quedó registrado para soporte." : message;

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
  const entryHost = business.slug ? `${business.slug}.learnsocialstudies.com` : business.subdomain ? `${business.subdomain}.learnsocialstudies.com` : null;
  const entryUrl = entryHost ? `https://${entryHost}` : null;
  const website = business.website || business.institutionalDomain || null;
  const addressLine = [business.addressLine1, business.addressLine2].filter(Boolean).join(", ");
  const locationLine = [business.city, business.department, business.country, business.postalCode].filter(Boolean).join(" · ");
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
  const civitas = getCivitasProfile(data);
  const [name, setName] = useState(data.organization.name ?? "");
  const savedBusiness = data.readModel?.business ?? civitas.business;
  const savedContact = data.readModel?.contact ?? civitas.contact;
  const [business, setBusiness] = useState({ slug: savedBusiness.slug ?? data.organization.profile?.slug ?? "", website: savedBusiness.website ?? "", institutionalDomain: savedBusiness.institutionalDomain ?? data.organization.profile?.adminDomain ?? "", nit: savedBusiness.nit ?? "", verificationDigit: savedBusiness.verificationDigit ?? "", country: savedBusiness.country ?? "", department: savedBusiness.department ?? "", city: savedBusiness.city ?? "", postalCode: savedBusiness.postalCode ?? "", addressLine1: savedBusiness.addressLine1 ?? "", addressLine2: savedBusiness.addressLine2 ?? "" });
  const [contact, setContact] = useState({ owner: savedContact.owner ?? "", email: savedContact.email ?? "", phone: savedContact.phone ?? "" });
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await ownerApi.updateOrganizationProfile(organizationId, { name, customData: { business, contact, downstream: { propagateTo: ["fluentcrm"] } } }); onSaved(); } finally { setSaving(false); } };
  return <div className="d-flex flex-column gap-4"><OrganizationSnapshotCard name={name} business={business} contact={contact} logoUrl={data.readModel?.branding?.lightLogoUrl ?? data.readModel?.branding?.logoUrl ?? data.organization.profile?.branding?.logoUrl ?? null} /><PageCard title="Editar datos de la organización" subtitle="Formulario completo de lado a lado. Se precarga desde Logto y CRM; al guardar se actualiza Logto y se encola downstream sync."><Form className="d-flex flex-column gap-4"><Card className="border-0 bg-light"><Card.Body><h3 className="h6 mb-3">• Identidad y puertas de entrada</h3><div className="row g-3"><Form.Group className="col-12 col-lg-4"><Form.Label>Nombre canónico Logto</Form.Label><Form.Control value={name} onChange={(e) => setName(e.target.value)} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Slug / subdominio</Form.Label><Form.Control value={business.slug} onChange={(e) => setBusiness({ ...business, slug: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Sitio web</Form.Label><Form.Control value={business.website} onChange={(e) => setBusiness({ ...business, website: e.target.value })} /></Form.Group><Form.Group className="col-12"><Form.Label>Dominio institucional de aprovisionamiento</Form.Label><Form.Control value={business.institutionalDomain} onChange={(e) => setBusiness({ ...business, institutionalDomain: e.target.value })} /></Form.Group></div></Card.Body></Card><Card className="border-0 bg-light"><Card.Body><h3 className="h6 mb-3">• Identificación fiscal</h3><div className="row g-3"><Form.Group className="col-12 col-md-6"><Form.Label>NIT</Form.Label><Form.Control value={business.nit} onChange={(e) => setBusiness({ ...business, nit: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-6"><Form.Label>Dígito de verificación</Form.Label><Form.Control value={business.verificationDigit} onChange={(e) => setBusiness({ ...business, verificationDigit: e.target.value })} /></Form.Group></div></Card.Body></Card><Card className="border-0 bg-light"><Card.Body><h3 className="h6 mb-3">• Ubicación</h3><div className="row g-3"><Form.Group className="col-12 col-md-6 col-xl-3"><Form.Label>País</Form.Label><Form.Control value={business.country} onChange={(e) => setBusiness({ ...business, country: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-6 col-xl-3"><Form.Label>Departamento</Form.Label><Form.Control value={business.department} onChange={(e) => setBusiness({ ...business, department: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-6 col-xl-3"><Form.Label>Ciudad</Form.Label><Form.Control value={business.city} onChange={(e) => setBusiness({ ...business, city: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-6 col-xl-3"><Form.Label>Postal Code</Form.Label><Form.Control value={business.postalCode} onChange={(e) => setBusiness({ ...business, postalCode: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-6"><Form.Label>Address Line 1</Form.Label><Form.Control value={business.addressLine1} onChange={(e) => setBusiness({ ...business, addressLine1: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-6"><Form.Label>Address Line 2</Form.Label><Form.Control value={business.addressLine2} onChange={(e) => setBusiness({ ...business, addressLine2: e.target.value })} /></Form.Group></div></Card.Body></Card><Card className="border-0 bg-light"><Card.Body><h3 className="h6 mb-3">• Contacto administrativo</h3><div className="row g-3"><Form.Group className="col-12 col-lg-4"><Form.Label>Responsable</Form.Label><Form.Control value={contact.owner} onChange={(e) => setContact({ ...contact, owner: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Email</Form.Label><Form.Control value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Teléfono</Form.Label><Form.Control value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></Form.Group></div></Card.Body></Card><div className="d-grid d-md-flex justify-content-md-end"><Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar en Logto y encolar sync"}</Button></div></Form></PageCard><PageCard title="Pendientes y conflictos" subtitle="Micro-operaciones en sync_operations/sync_operation_steps; la tabla legacy no es fuente activa.">{data.sync.pending.length === 0 ? <EmptyState title="Sin pendientes" description="El perfil no tiene reintentos pendientes." /> : <div className="row g-3">{data.sync.pending.map((item) => <div className="col-12 col-lg-6" key={item.id}><Alert variant={item.retryable ? "warning" : "secondary"} className="h-100"><div className="d-flex justify-content-between"><strong>{item.type}</strong><Badge bg="light" text="dark">{item.affectedSystem}</Badge></div><p className="mb-2 small">{cleanMessage(item.lastError)}</p><Button size="sm" variant="outline-primary" onClick={() => ownerApi.retrySyncOperation(organizationId, item.operationId).then(onSaved)} disabled={!item.retryable}>{item.suggestedAction}</Button></Alert></div>)}</div>}</PageCard></div>;
}

function BrandingTab({ data, organizationId, onSaved }: { data: OwnerOrganizationProfileResponse; organizationId: string; onSaved: () => void }) { const ownerApi = useOwnerApi(); const civitas = getCivitasProfile(data); const savedBranding = data.readModel?.branding ?? civitas.branding; const [branding, setBranding] = useState({ lightLogoUrl: savedBranding.lightLogoUrl ?? savedBranding.logoUrl ?? data.organization.profile?.branding?.logoUrl ?? "", lightFaviconUrl: savedBranding.lightFaviconUrl ?? savedBranding.faviconUrl ?? data.organization.profile?.branding?.faviconUrl ?? "", lightPrimaryColor: savedBranding.lightPrimaryColor ?? savedBranding.primaryColor ?? data.organization.profile?.branding?.primaryColor ?? "", darkLogoUrl: savedBranding.darkLogoUrl ?? "", darkFaviconUrl: savedBranding.darkFaviconUrl ?? "", darkPrimaryColor: savedBranding.darkPrimaryColor ?? savedBranding.primaryColorDark ?? data.organization.profile?.branding?.primaryColorDark ?? "" }); const [saving, setSaving] = useState(false); const save = async () => { setSaving(true); try { await ownerApi.updateOrganizationProfile(organizationId, { customData: { branding, downstream: { propagateTo: ["logto_custom_css", "fluentcrm"] } } }); onSaved(); } finally { setSaving(false); } }; return <div className="row g-4"><div className="col-12 col-xl-7"><PageCard title="Branding" subtitle="Estos datos se guardan en Logto customData y el backend genera el CSS de Logto; Civitas no renderiza ese CSS."><Form className="d-flex flex-column gap-3"><h3 className="h6 mb-0">Tema claro</h3><Form.Group><Form.Label>URL del logotipo de la organización</Form.Label><Form.Control value={branding.lightLogoUrl} onChange={(e) => setBranding({ ...branding, lightLogoUrl: e.target.value })} /></Form.Group><Form.Group><Form.Label>URL del favicon</Form.Label><Form.Control value={branding.lightFaviconUrl} onChange={(e) => setBranding({ ...branding, lightFaviconUrl: e.target.value })} /></Form.Group><Form.Group><Form.Label>Color de la marca</Form.Label><Form.Control value={branding.lightPrimaryColor} onChange={(e) => setBranding({ ...branding, lightPrimaryColor: e.target.value })} placeholder="#0d6efd" /></Form.Group><h3 className="h6 mb-0 mt-2">Tema oscuro</h3><Form.Group><Form.Label>URL del logotipo de la organización (oscuro)</Form.Label><Form.Control value={branding.darkLogoUrl} onChange={(e) => setBranding({ ...branding, darkLogoUrl: e.target.value })} /></Form.Group><Form.Group><Form.Label>URL del favicon (oscuro)</Form.Label><Form.Control value={branding.darkFaviconUrl} onChange={(e) => setBranding({ ...branding, darkFaviconUrl: e.target.value })} /></Form.Group><Form.Group><Form.Label>Color de la marca (oscuro)</Form.Label><Form.Control value={branding.darkPrimaryColor} onChange={(e) => setBranding({ ...branding, darkPrimaryColor: e.target.value })} placeholder="#111827" /></Form.Group><Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar branding en Logto"}</Button></Form></PageCard></div><div className="col-12 col-xl-5"><PageCard title="Vista rápida del logo" subtitle="Solo previsualiza URLs; el CSS final lo calcula el backend y lo guarda en Logto.">{branding.lightLogoUrl ? <img src={branding.lightLogoUrl} alt="Logo claro" className="img-fluid border rounded p-3 mb-3" /> : <EmptyState title="Sin logo claro" description="Agrega una URL de logo para previsualizarlo." />}{branding.darkLogoUrl ? <div className="bg-dark rounded p-3"><img src={branding.darkLogoUrl} alt="Logo oscuro" className="img-fluid" /></div> : null}</PageCard></div></div>; }

function EventsTab({ data, onRetry, organizationId }: { data: OwnerOrganizationProfileResponse; onRetry: () => void; organizationId: string }) { const ownerApi = useOwnerApi(); return <PageCard title="Notificaciones" subtitle="Centro de eventos funcional por organización.">{data.sync.events.length === 0 ? <EmptyState title="Sin eventos" description="No hay eventos operativos recientes." /> : <Table responsive hover><thead><tr><th>Fecha</th><th>Tipo</th><th>Resultado</th><th>Etapa</th><th>Mensaje</th><th>Acción</th></tr></thead><tbody>{data.sync.events.map((event) => <tr key={event.id}><td>{event.at ? new Date(event.at).toLocaleString() : "—"}</td><td>{event.type}</td><td><Badge bg={event.result === "success" || event.result === "completed" ? "success" : event.requiresAction ? "warning" : "secondary"}>{event.result}</Badge></td><td>{event.stage}</td><td>{cleanMessage(event.message)}</td><td>{event.retryOperationId ? <Button size="sm" variant="outline-primary" onClick={() => ownerApi.retrySyncOperation(organizationId, event.retryOperationId!).then(onRetry)}>Reintentar</Button> : "—"}</td></tr>)}</tbody></Table>}</PageCard>; }

function MembersTab({ organizationId }: { organizationId: string }) {
  const ownerApi = useOwnerApi();
  const resource = useStableResource({ initialParams: organizationId, load: ownerApi.getOrganizationMembers, getKey: (id) => `members-${id}` });
  const templateResource = useStableResource({ initialParams: "roles", load: ownerApi.getOrganizationTemplate, getKey: () => "organization-template-for-member-create" });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemberIdentityDraft>({ primerNombre: "", segundoNombre: "", primerApellido: "", segundoApellido: "", email: "", previousEmail: "", phone: "" });
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lastLoginFilter, setLastLoginFilter] = useState("all");
  const [mfaFilter, setMfaFilter] = useState("all");
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
    setCreateError(null);
    setCreateSuccess(null);
    if (!newMember.primerNombre.trim() || !newMember.primerApellido.trim() || !newMember.email.trim() || !newMember.organizationRoleName.trim()) {
      setCreateError("Completa Nombre 1, Apellido 1, email y rol para crear el primer miembro o administrador.");
      return;
    }
    setCreating(true);
    try {
      const result = await ownerApi.createOrganizationMember(organizationId, { primerNombre: newMember.primerNombre.trim(), segundoNombre: newMember.segundoNombre.trim() || null, primerApellido: newMember.primerApellido.trim(), segundoApellido: newMember.segundoApellido.trim() || null, email: newMember.email.trim(), phone: buildPhone(), phoneExtension: newMember.phoneExtension.trim() || null, position: newMember.position.trim() || null, organizationRoleName: newMember.organizationRoleName });
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
  if (resource.isLoading) return <LoadingState title="Cargando miembros" description="Leyendo membresías y roles desde Logto." />;
  if (resource.error) return <ErrorState title="No se pudieron cargar miembros" message={resource.error} action={<Button onClick={resource.retry}>Reintentar</Button>} />;
  return <div className="d-flex flex-column gap-4"><PageCard title="Añadir usuario" subtitle="Flujo único para crear o vincular miembros. Para el primer usuario, deja Admin-org seleccionado o elige cualquier rol disponible."><Form className="row g-3" onSubmit={(event) => { event.preventDefault(); submitNewMember(); }}><Form.Group className="col-12 col-md-3"><Form.Label>Nombre 1 *</Form.Label><Form.Control value={newMember.primerNombre} onChange={(e) => setNewMember({ ...newMember, primerNombre: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-3"><Form.Label>Nombre 2</Form.Label><Form.Control value={newMember.segundoNombre} onChange={(e) => setNewMember({ ...newMember, segundoNombre: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-3"><Form.Label>Apellido 1 *</Form.Label><Form.Control value={newMember.primerApellido} onChange={(e) => setNewMember({ ...newMember, primerApellido: e.target.value })} /></Form.Group><Form.Group className="col-12 col-md-3"><Form.Label>Apellido 2</Form.Label><Form.Control value={newMember.segundoApellido} onChange={(e) => setNewMember({ ...newMember, segundoApellido: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Email *</Form.Label><Form.Control type="email" value={newMember.email} onChange={(e) => setNewMember({ ...newMember, email: e.target.value })} /></Form.Group><Form.Group className="col-4 col-lg-2"><Form.Label>País/código</Form.Label><Form.Control inputMode="numeric" value={newMember.phoneCountryCode} onChange={(e) => setNewMember({ ...newMember, phoneCountryCode: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></Form.Group><Form.Group className="col-8 col-lg-3"><Form.Label>Teléfono nacional</Form.Label><Form.Control value={newMember.phoneNational} onChange={(e) => setNewMember({ ...newMember, phoneNational: e.target.value })} /></Form.Group><Form.Group className="col-6 col-lg-1"><Form.Label>Ext.</Form.Label><Form.Control value={newMember.phoneExtension} onChange={(e) => setNewMember({ ...newMember, phoneExtension: e.target.value })} /></Form.Group><Form.Group className="col-6 col-lg-2"><Form.Label>Cargo</Form.Label><Form.Control value={newMember.position} onChange={(e) => setNewMember({ ...newMember, position: e.target.value })} /></Form.Group><Form.Group className="col-12 col-lg-4"><Form.Label>Rol de organización *</Form.Label><Form.Select value={newMember.organizationRoleName} onChange={(e) => setNewMember({ ...newMember, organizationRoleName: e.target.value })}>{selectableRoles.map((role) => <option key={role} value={role}>{role}</option>)}</Form.Select></Form.Group><div className="col-12 d-flex flex-wrap gap-2 align-items-center"><Button type="submit" disabled={creating}>{creating ? "Creando…" : members.length === 0 ? "Crear primer usuario" : "Añadir usuario"}</Button>{members.length === 0 ? <Badge bg="warning" text="dark">Mínimo recomendado: 1 miembro administrador</Badge> : null}{createSuccess ? <span className="text-success small">{createSuccess}</span> : null}{createError ? <span className="text-danger small">{createError}</span> : null}</div></Form></PageCard><PageCard title="Miembros" subtitle="Admin-org es un rol seleccionable normal; este directorio muestra usuarios reales de la organización."><div className="row g-2 mb-3"><Form.Group className="col-12 col-lg-4"><Form.Label>Buscar</Form.Label><Form.Control placeholder="Nombre, apellido, email, teléfono, rol o Logto ID" value={search} onChange={(e) => setSearch(e.target.value)} /></Form.Group><Form.Group className="col-6 col-lg-2"><Form.Label>Rol</Form.Label><Form.Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="all">Todos</option>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</Form.Select></Form.Group><Form.Group className="col-6 col-lg-2"><Form.Label>Estado</Form.Label><Form.Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Todos</option><option value="active">Activo</option><option value="retryable">Retryable</option><option value="hitl_required">HITL</option></Form.Select></Form.Group><Form.Group className="col-6 col-lg-2"><Form.Label>Último login</Form.Label><Form.Select value={lastLoginFilter} onChange={(e) => setLastLoginFilter(e.target.value)}><option value="all">Todos</option><option value="never">Nunca</option><option value="7d">Últimos 7 días</option><option value="30d">Últimos 30 días</option><option value="gt30d">Más de 30 días</option></Form.Select></Form.Group><Form.Group className="col-6 col-lg-2"><Form.Label>MFA</Form.Label><Form.Select value={mfaFilter} onChange={(e) => setMfaFilter(e.target.value)}><option value="all">Todos</option><option value="enabled">Habilitado</option><option value="disabled">No habilitado</option></Form.Select></Form.Group></div><Table responsive hover><thead><tr><th>Nombre completo</th><th>Nombre 1</th><th>Nombre 2</th><th>Apellido 1</th><th>Apellido 2</th><th>Email</th><th>Teléfono</th><th>Roles</th><th>Estado</th><th>Último login</th><th>MFA</th><th>Acciones</th></tr></thead><tbody>{filteredMembers.map((member) => { const id = member.identity.logtoUserId; const isEditing = editing === id; return <tr key={id ?? member.identity.email}><td>{buildDisplayName(member.identity)}</td><td>{isEditing ? <Form.Control value={draft.primerNombre} onChange={(e) => setDraft({ ...draft, primerNombre: e.target.value })} /> : member.identity.primerNombre ?? ""}</td><td>{isEditing ? <Form.Control value={draft.segundoNombre} onChange={(e) => setDraft({ ...draft, segundoNombre: e.target.value })} /> : member.identity.segundoNombre ?? ""}</td><td>{isEditing ? <Form.Control value={draft.primerApellido} onChange={(e) => setDraft({ ...draft, primerApellido: e.target.value })} /> : member.identity.primerApellido ?? ""}</td><td>{isEditing ? <Form.Control value={draft.segundoApellido} onChange={(e) => setDraft({ ...draft, segundoApellido: e.target.value })} /> : member.identity.segundoApellido ?? ""}</td><td>{isEditing ? <Form.Control value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /> : member.identity.email ?? "No disponible"}</td><td>{isEditing ? <Form.Control value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /> : member.identity.phone ?? "No disponible"}</td><td>{member.identity.roles?.join(", ") || "Sin rol"}</td><td>{String(member.civitas?.membershipStatus ?? "active")}</td><td>{member.identity.lastLoginAt ? new Date(member.identity.lastLoginAt).toLocaleString() : "Nunca"}</td><td>{member.identity.mfa?.enabled === true ? `Habilitado${member.identity.mfa.method ? ` (${member.identity.mfa.method})` : ""}` : member.identity.mfa?.enabled === false ? "No habilitado" : "No disponible"}</td><td className="d-flex gap-2">{isEditing ? <Button size="sm" onClick={() => ownerApi.updateOrganizationMember(organizationId, id!, { ...draft, name: [draft.primerNombre, draft.segundoNombre, draft.primerApellido, draft.segundoApellido].map((value) => value.trim()).filter(Boolean).join(" ") }).then(() => { setEditing(null); resource.retry(); })}>Guardar</Button> : <Button size="sm" variant="outline-primary" onClick={() => { setEditing(id); setDraft(buildMemberDraft(member.identity)); }}>Editar</Button>}<Button size="sm" variant="outline-secondary" onClick={() => ownerApi.resetOrganizationMemberPassword(organizationId, id!)}>Reset password</Button></td></tr>; })}</tbody></Table></PageCard></div>;
}

export function OwnerOrganizationConsolePage() { const { organizationId = "" } = useParams(); const [tab, setTab] = useState<TabKey>("profile"); const ownerApi = useOwnerApi(); const resource = useStableResource({ initialParams: organizationId, load: ownerApi.getOrganizationProfile, getKey: (id) => `org-console-${id}` }); useEffect(() => { resource.retry(); }, [organizationId]); return <PageShell eyebrow="Consola por organización" title={resource.data?.organization.name ?? "Organización"} description="Perfil de tenant con datos canónicos de Logto, pendientes operativos y miembros."><Nav variant="tabs" activeKey={tab} onSelect={(key) => setTab((key as TabKey) || "profile")} className="mb-4"><Nav.Item><Nav.Link eventKey="profile">Datos de la organización</Nav.Link></Nav.Item><Nav.Item><Nav.Link eventKey="branding">Branding</Nav.Link></Nav.Item><Nav.Item><Nav.Link eventKey="events">Notificaciones</Nav.Link></Nav.Item><Nav.Item><Nav.Link eventKey="members">Miembros</Nav.Link></Nav.Item></Nav>{resource.isLoading ? <LoadingState title="Cargando organización" description="Leyendo Logto, sync_operations y auditoría." /> : resource.error ? <ErrorState title="No se pudo cargar la consola" message={cleanMessage(resource.error)} action={<Button onClick={resource.retry}>Reintentar</Button>} /> : resource.data && tab === "profile" ? <ProfileTab data={resource.data} organizationId={organizationId} onSaved={resource.retry} /> : resource.data && tab === "branding" ? <BrandingTab data={resource.data} organizationId={organizationId} onSaved={resource.retry} /> : resource.data && tab === "events" ? <EventsTab data={resource.data} organizationId={organizationId} onRetry={resource.retry} /> : <MembersTab organizationId={organizationId} />}</PageShell>; }
