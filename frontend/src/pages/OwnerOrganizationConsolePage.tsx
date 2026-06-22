import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Form, Nav, Table } from "react-bootstrap";
import { useParams } from "react-router-dom";
import { useOwnerApi, type OwnerOrganizationProfileResponse } from "../api/owner";
import { useStableResource } from "../shared/hooks/useStableResource";
import { EmptyState, ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

type TabKey = "profile" | "branding" | "events" | "members";

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
    <Card className="border shadow-sm overflow-hidden mx-auto civitas-organization-card civitas-organization-card--snapshot">
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

function MembersTab({ organizationId }: { organizationId: string }) { const ownerApi = useOwnerApi(); const resource = useStableResource({ initialParams: organizationId, load: ownerApi.getOrganizationMembers, getKey: (id) => `members-${id}` }); const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState({ name: "", email: "", phone: "" }); if (resource.isLoading) return <LoadingState title="Cargando miembros" description="Leyendo membresías y roles desde Logto." />; if (resource.error) return <ErrorState title="No se pudieron cargar miembros" message={resource.error} action={<Button onClick={resource.retry}>Reintentar</Button>} />; return <PageCard title="Miembros" subtitle="Logto es fuente canónica de identidad, membresía y roles. MFA, sesiones y spent time se muestran solo si el proveedor los expone."><Table responsive hover><thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Roles</th><th>Last login</th><th>MFA</th><th>Spent time</th><th>Acciones</th></tr></thead><tbody>{(resource.data?.members ?? []).map((member) => { const id = member.identity.logtoUserId; const isEditing = editing === id; return <tr key={id ?? member.identity.email}><td>{isEditing ? <Form.Control value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /> : member.identity.name ?? "No disponible"}</td><td>{isEditing ? <Form.Control value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /> : member.identity.email ?? "No disponible"}</td><td>{isEditing ? <Form.Control value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /> : member.identity.phone ?? "No disponible"}</td><td>{member.identity.roles?.join(", ") || "Sin rol"}</td><td>{member.identity.lastLoginAt ? new Date(member.identity.lastLoginAt).toLocaleString() : "No disponible"}</td><td>{member.identity.mfa?.enabled === true ? `Habilitado${member.identity.mfa.method ? ` (${member.identity.mfa.method})` : ""}` : member.identity.mfa?.enabled === false ? "No habilitado" : "No disponible"}</td><td>{member.identity.spentTime?.availability === "available" ? member.identity.spentTime.value : "No disponible"}</td><td className="d-flex gap-2">{isEditing ? <Button size="sm" onClick={() => ownerApi.updateOrganizationMember(organizationId, id!, draft).then(() => { setEditing(null); resource.retry(); })}>Guardar</Button> : <Button size="sm" variant="outline-primary" onClick={() => { setEditing(id); setDraft({ name: member.identity.name ?? "", email: member.identity.email ?? "", phone: member.identity.phone ?? "" }); }}>Editar</Button>}<Button size="sm" variant="outline-secondary" onClick={() => ownerApi.resetOrganizationMemberPassword(organizationId, id!)}>Reset password</Button></td></tr>; })}</tbody></Table></PageCard>; }

export function OwnerOrganizationConsolePage() { const { organizationId = "" } = useParams(); const [tab, setTab] = useState<TabKey>("profile"); const ownerApi = useOwnerApi(); const resource = useStableResource({ initialParams: organizationId, load: ownerApi.getOrganizationProfile, getKey: (id) => `org-console-${id}` }); useEffect(() => { resource.retry(); }, [organizationId]); return <PageShell eyebrow="Consola por organización" title={resource.data?.organization.name ?? "Organización"} description="Perfil de tenant con datos canónicos de Logto, pendientes operativos y miembros."><Nav variant="tabs" activeKey={tab} onSelect={(key) => setTab((key as TabKey) || "profile")} className="mb-4"><Nav.Item><Nav.Link eventKey="profile">Datos de la organización</Nav.Link></Nav.Item><Nav.Item><Nav.Link eventKey="branding">Branding</Nav.Link></Nav.Item><Nav.Item><Nav.Link eventKey="events">Notificaciones</Nav.Link></Nav.Item><Nav.Item><Nav.Link eventKey="members">Miembros</Nav.Link></Nav.Item></Nav>{resource.isLoading ? <LoadingState title="Cargando organización" description="Leyendo Logto, sync_operations y auditoría." /> : resource.error ? <ErrorState title="No se pudo cargar la consola" message={cleanMessage(resource.error)} action={<Button onClick={resource.retry}>Reintentar</Button>} /> : resource.data && tab === "profile" ? <ProfileTab data={resource.data} organizationId={organizationId} onSaved={resource.retry} /> : resource.data && tab === "branding" ? <BrandingTab data={resource.data} organizationId={organizationId} onSaved={resource.retry} /> : resource.data && tab === "events" ? <EventsTab data={resource.data} organizationId={organizationId} onRetry={resource.retry} /> : <MembersTab organizationId={organizationId} />}</PageShell>; }
