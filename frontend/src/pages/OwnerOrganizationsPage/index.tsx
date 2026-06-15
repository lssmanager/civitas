import { useMemo, useState } from "react";
import { Alert, Badge, Button, Form } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useOwnerApi, type OwnerOrganization } from "../../api/owner";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { DataTable, EmptyState, ErrorState, LoadingState, PageCard, PageShell, type DataTableColumn } from "../../shared/ui";

const getSyncBadge = (status?: string) => {
  if (status === "synced" || status === "reconciled") return <Badge bg="success">Reconciliada</Badge>;
  if (status === "logto_created") return <Badge bg="warning" text="dark">Logto creada</Badge>;
  if (status === "creator_membership_pending") return <Badge bg="warning" text="dark">Membership pendiente</Badge>;
  if (status === "creator_role_pending") return <Badge bg="warning" text="dark">Rol admin pendiente</Badge>;
  if (status === "creator_role_missing") return <Badge bg="danger">Rol admin faltante</Badge>;
  if (status === "bootstrap_incomplete") return <Badge bg="warning" text="dark">Bootstrap incompleto</Badge>;
  if (status === "error") return <Badge bg="danger">Error Logto</Badge>;
  return <Badge bg="warning" text="dark">Pendiente</Badge>;
};

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "Sin sync exitoso");

export function OwnerOrganizationsPage() {
  const ownerApi = useOwnerApi();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminDomain, setAdminDomain] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [primaryColorDark, setPrimaryColorDark] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [loginExperienceEnabled, setLoginExperienceEnabled] = useState(false);
  const [defaultRoles, setDefaultRoles] = useState<string[]>(["STUDENT"]);
  const [oidcRedirectUri, setOidcRedirectUri] = useState("");
  const [oidcApplicationId, setOidcApplicationId] = useState("");
  const [oidcApplicationSecret, setOidcApplicationSecret] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const organizationsResource = useStableResource({
    initialParams: {},
    load: ownerApi.getOrganizations,
    getKey: () => "owner-organizations",
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudieron cargar las organizaciones owner.",
  });

  const organizations = organizationsResource.data?.organizations ?? [];
  const columns = useMemo<DataTableColumn<OwnerOrganization>[]>(() => [
    {
      key: "name",
      header: "Organización",
      render: (organization) => (
        <div>
          <div className="fw-semibold">{organization.name ?? organization.profile?.nameCache ?? "Sin nombre"}</div>
          <div className="text-secondary small text-break">Organización Logto: {organization.logtoOrganizationId ?? "sin id"}</div>
          <div className="text-secondary small text-break">Perfil operativo: {organization.profile?.id ?? "metadata pendiente"}</div>
        </div>
      ),
    },
    {
      key: "logto",
      header: "Bootstrap",
      render: (organization) => (
        <div className="d-flex flex-column gap-1">
          {getSyncBadge(organization.profile?.logtoSyncStatus)}
          <span className="text-secondary small text-break">{organization.logtoOrganizationId ?? "Aún sin id Logto"}</span>
        </div>
      ),
    },
    { key: "slug", header: "Operativa", render: (organization) => <span className="small">Slug: {organization.profile?.slug ?? "Sin slug"}<br />Admin: {organization.profile?.adminDomain ?? "Sin dominio"}<br />Roles: {organization.profile?.defaultRoleNames?.join(", ") || "Sin roles"}</span> },
    { key: "settings", header: "Settings", render: (organization) => <Link className="btn btn-sm btn-outline-primary" to={`/owner/organizations/${organization.profile?.id ?? organization.logtoOrganizationId}/settings`}>Abrir</Link> },
    { key: "lastSync", header: "Último sync", render: (organization) => <span className="small">{formatDate(organization.profile?.logtoSyncedAt)}</span> },
    {
      key: "error",
      header: "Error visible",
      render: (organization) => organization.profile?.logtoSyncError ? <Alert variant="danger" className="py-2 px-3 mb-0 small">{organization.profile.logtoSyncError}</Alert> : <span className="text-secondary small">Sin error registrado</span>,
    },
  ], []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const result = await ownerApi.createOrganization({
        name,
        slug: slug || undefined,
        adminDomain: adminDomain || undefined,
        primaryColor: primaryColor || undefined,
        primaryColorDark: primaryColorDark || undefined,
        logoUrl: logoUrl || undefined,
        faviconUrl: faviconUrl || undefined,
        organizationLoginExperienceEnabled: loginExperienceEnabled,
        defaultRoleNames: defaultRoles,
        oidcRedirectUri: oidcRedirectUri || undefined,
        oidcApplicationId: oidcApplicationId || undefined,
        oidcApplicationSecret: oidcApplicationSecret || undefined,
      });
      setName("");
      setSlug("");
      setAdminDomain("");
      setPrimaryColor("");
      setPrimaryColorDark("");
      setLogoUrl("");
      setFaviconUrl("");
      setLoginExperienceEnabled(false);
      setDefaultRoles(["STUDENT"]);
      setOidcRedirectUri("");
      setOidcApplicationId("");
      setOidcApplicationSecret("");
      organizationsResource.reload();
      if (result.warning) setSubmitError(result.warning);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo crear la organización.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageShell eyebrow="Owner" title="Organizaciones Logto / Civitas" description="Logto es la fuente canónica; Civitas guarda metadata operativa, reconciliación y estado de bootstrap." actions={<Badge bg="success">organizations:read</Badge>}>
      <div className="row g-4">
        <div className="col-12 col-xl-4">
          <PageCard title="Crear organización" subtitle="Provisionamiento ampliado inicial: identidad canónica en Logto y metadata local para #51.">
            <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
              <Form.Group controlId="ownerOrganizationName"><Form.Label>Nombre</Form.Label><Form.Control value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Legal" required /></Form.Group>
              <Form.Group controlId="ownerOrganizationSlug"><Form.Label>Slug</Form.Label><Form.Control value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="acme-legal" /></Form.Group>
              <Form.Group controlId="ownerOrganizationAdminDomain"><Form.Label>Dominio admin</Form.Label><Form.Control value={adminDomain} onChange={(event) => setAdminDomain(event.target.value)} placeholder="admin.acme.test" /></Form.Group>
              <div className="row g-2">
                <Form.Group className="col" controlId="ownerOrganizationPrimaryColor"><Form.Label>Color primario</Form.Label><Form.Control value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} placeholder="#0d6efd" pattern="^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" /></Form.Group>
                <Form.Group className="col" controlId="ownerOrganizationPrimaryColorDark"><Form.Label>Color oscuro</Form.Label><Form.Control value={primaryColorDark} onChange={(event) => setPrimaryColorDark(event.target.value)} placeholder="#084298" pattern="^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" /></Form.Group>
              </div>
              <Form.Group controlId="ownerOrganizationLogoUrl"><Form.Label>Logo URL</Form.Label><Form.Control type="url" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://cdn.example.com/logo.svg" /></Form.Group>
              <Form.Group controlId="ownerOrganizationFaviconUrl"><Form.Label>Favicon URL</Form.Label><Form.Control type="url" value={faviconUrl} onChange={(event) => setFaviconUrl(event.target.value)} placeholder="https://cdn.example.com/favicon.ico" /></Form.Group>
              <Form.Check type="switch" id="ownerOrganizationLoginExperience" label="Preparar login experience por organización" checked={loginExperienceEnabled} onChange={(event) => setLoginExperienceEnabled(event.target.checked)} />
              <Form.Group controlId="ownerOrganizationRoles"><Form.Label>Roles predeterminados</Form.Label><Form.Control value={defaultRoles.join(", ")} onChange={(event) => setDefaultRoles(event.target.value.split(",").map((role) => role.trim().toUpperCase()).filter(Boolean))} placeholder="STUDENT" /><Form.Text>Incluye STUDENT por defecto; separa roles con coma.</Form.Text></Form.Group>
              <Form.Group controlId="ownerOrganizationOidcRedirect"><Form.Label>OIDC redirect URI inicial</Form.Label><Form.Control type="url" value={oidcRedirectUri} onChange={(event) => setOidcRedirectUri(event.target.value)} placeholder="https://admin.acme.test/callback" /></Form.Group>
              <Form.Group controlId="ownerOrganizationOidcApplicationId"><Form.Label>OIDC application id</Form.Label><Form.Control value={oidcApplicationId} onChange={(event) => setOidcApplicationId(event.target.value)} placeholder="app_xxx" /></Form.Group>
              <Form.Group controlId="ownerOrganizationOidcSecret"><Form.Label>OIDC secret inicial</Form.Label><Form.Control type="password" value={oidcApplicationSecret} onChange={(event) => setOidcApplicationSecret(event.target.value)} placeholder="No se mostrará en listados" /><Form.Text>Se registra solo como configurado/redactado; no se devuelve en texto plano.</Form.Text></Form.Group>
              {submitError && <Alert variant="danger" className="mb-0">{submitError}</Alert>}
              <Button type="submit" disabled={isSubmitting || !name.trim()}>{isSubmitting ? "Creando..." : "Crear y sincronizar"}</Button>
            </Form>
          </PageCard>
        </div>
        <div className="col-12 col-xl-8">
          <PageCard title="Directorio canónico" subtitle="Una fila por organización real de Logto; los perfiles Civitas son metadata reconciliable.">
            {organizationsResource.isLoading ? <LoadingState title="Cargando organizaciones" description="Consultando Logto y metadata operativa." /> : organizationsResource.error ? <ErrorState title="No se pudieron cargar organizaciones" message={organizationsResource.error} action={<Button onClick={organizationsResource.retry}>Reintentar</Button>} /> : organizations.length === 0 ? <EmptyState title="Sin organizaciones" description="Crea la primera organización; si el bootstrap queda parcial, el estado persistido aparecerá aquí." /> : <DataTable columns={columns} rows={organizations} getRowKey={(row) => row.profile?.id ?? row.logtoOrganizationId ?? row.name ?? "organization"} />}
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}
