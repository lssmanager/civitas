import { useState } from "react";
import { Alert, Badge, Button, Form } from "react-bootstrap";
import { useOwnerApi } from "../../api/owner";
import { ORGANIZATION_BOOTSTRAP_ADMIN_ROLE } from "../../authLayers";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

export function OwnerOrganizationsPage() {
  const ownerApi = useOwnerApi();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [appSubdomain, setAppSubdomain] = useState("");
  const [adminDomain, setAdminDomain] = useState("");
  const [baseAdminName, setBaseAdminName] = useState("");
  const [baseAdminEmail, setBaseAdminEmail] = useState("");
  const [baseAdminLogtoUserId, setBaseAdminLogtoUserId] = useState("");
  const [defaultRoleName, setDefaultRoleName] = useState<string>(ORGANIZATION_BOOTSTRAP_ADMIN_ROLE);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const templateResource = useStableResource({
    initialParams: {},
    load: ownerApi.getOrganizationTemplate,
    getKey: () => "owner-organization-template",
    getErrorMessage: (error) => error instanceof Error ? error.message : "No se pudo cargar la plantilla de organización de Logto.",
  });

  const roles = templateResource.data?.roles.filter((role) => role.name) ?? [];
  const selectedRole = roles.some((role) => role.name === defaultRoleName) ? defaultRoleName : roles[0]?.name ?? ORGANIZATION_BOOTSTRAP_ADMIN_ROLE;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setSubmitWarning(null);
    setIsSubmitting(true);

    try {
      const result = await ownerApi.createOrganization({
        name,
        slug,
        subdomain: appSubdomain,
        adminDomain: adminDomain || undefined,
        defaultRoleNames: [selectedRole],
        baseAdmin: {
          name: baseAdminName || undefined,
          email: baseAdminEmail || undefined,
          logtoUserId: baseAdminLogtoUserId || undefined,
        },
      });

      setName("");
      setSlug("");
      setAppSubdomain("");
      setAdminDomain("");
      setBaseAdminName("");
      setBaseAdminEmail("");
      setBaseAdminLogtoUserId("");
      if (result.warning) setSubmitWarning(result.warning);
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
      description="Flujo enfocado en crear la organización canónica en Logto y ejecutar el bootstrap inicial por etapas. La observabilidad técnica vive en Logs."
      actions={<Badge bg="success">organizations:create</Badge>}
    >
      <div className="row g-4">
        <div className="col-12 col-xl-7">
          <PageCard title="Nueva organización" subtitle="Logto es la fuente canónica; Civitas solo guarda metadata operativa, reconciliación y estado de bootstrap.">
            {templateResource.isLoading ? (
              <LoadingState title="Cargando plantilla" description="Consultando roles de la organization template de Logto." />
            ) : templateResource.error ? (
              <ErrorState title="No se pudo cargar la plantilla" message={templateResource.error} action={<Button onClick={templateResource.retry}>Reintentar</Button>} />
            ) : (
              <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
                {templateResource.data && !templateResource.data.ready ? (
                  <Alert variant="danger" className="mb-0">
                    Falta configurar la plantilla de Logto. Roles requeridos ausentes: {templateResource.data.missingRoleNames.join(", ") || ORGANIZATION_BOOTSTRAP_ADMIN_ROLE}.
                  </Alert>
                ) : null}
                <Form.Group controlId="ownerOrganizationName"><Form.Label>Nombre de organización</Form.Label><Form.Control value={name} onChange={(event) => setName(event.target.value)} placeholder="Colegio San José" required /></Form.Group>
                <Form.Group controlId="ownerOrganizationSlug"><Form.Label>Slug</Form.Label><Form.Control value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="colegio-san-jose" required /><Form.Text>Identificador interno legible para rutas y operación owner; usa minúsculas, números y guiones.</Form.Text></Form.Group>
                <div className="row g-3">
                  <Form.Group className="col-12 col-lg-6" controlId="ownerOrganizationAppSubdomain"><Form.Label>Subdominio app</Form.Label><Form.Control value={appSubdomain} onChange={(event) => setAppSubdomain(event.target.value)} placeholder="sanjose" required /><Form.Text>Solo el prefijo operativo de la app. Genera automáticamente <code>https://{appSubdomain || "sanjose"}.learnsocialstudies.com/callback</code>.</Form.Text></Form.Group>
                  <Form.Group className="col-12 col-lg-6" controlId="ownerOrganizationAdminDomain"><Form.Label>Dominio institucional de aprovisionamiento</Form.Label><Form.Control value={adminDomain} onChange={(event) => setAdminDomain(event.target.value)} placeholder="colegiosanjose.edu.co" required /><Form.Text>Dominio real de correo/identidad institucional; no es el subdominio app.</Form.Text></Form.Group>
                </div>
                <div className="row g-3">
                  <Form.Group className="col-12 col-lg-6" controlId="ownerOrganizationBaseAdminName"><Form.Label>Nombre admin base</Form.Label><Form.Control value={baseAdminName} onChange={(event) => setBaseAdminName(event.target.value)} placeholder="María Admin" required /></Form.Group>
                  <Form.Group className="col-12 col-lg-6" controlId="ownerOrganizationBaseAdminEmail"><Form.Label>Correo admin base</Form.Label><Form.Control type="email" value={baseAdminEmail} onChange={(event) => setBaseAdminEmail(event.target.value)} placeholder="admin@colegio1.edu.co" required /></Form.Group>
                </div>
                <Form.Group controlId="ownerOrganizationBaseAdminLogtoId"><Form.Label>Logto user id admin base</Form.Label><Form.Control value={baseAdminLogtoUserId} onChange={(event) => setBaseAdminLogtoUserId(event.target.value)} placeholder="Opcional; requerido para agregar y asignar rol inmediatamente" /><Form.Text>Si se omite, no se usa el owner actual como sustituto: el admin queda como invitación pendiente hasta crear/enlazar un usuario Logto.</Form.Text></Form.Group>
                <Form.Group controlId="ownerOrganizationRoles"><Form.Label>Rol inicial desde plantilla Logto</Form.Label><Form.Select value={selectedRole} onChange={(event) => setDefaultRoleName(event.target.value)} disabled={roles.length === 0}>{roles.map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</Form.Select></Form.Group>
                <Alert variant="info" className="mb-0">
                  El alta crea la organización canónica en Logto y envía customData OIDC generado desde slug/subdominio/dominio. El dominio institucional queda guardado localmente como pending_logto_configuration para JIT/seats futuro; el admin solo se agrega si indicas un Logto user id existente.
                </Alert>
                {submitError && <Alert variant="danger" className="mb-0">{submitError}</Alert>}
                {submitWarning && <Alert variant="warning" className="mb-0">{submitWarning}</Alert>}
                <Button type="submit" disabled={isSubmitting || !name.trim() || !slug.trim() || !appSubdomain.trim() || !adminDomain.trim() || !baseAdminName.trim() || !baseAdminEmail.trim() || !templateResource.data?.ready}>{isSubmitting ? "Creando..." : "Crear organización"}</Button>
              </Form>
            )}
          </PageCard>
        </div>
        <div className="col-12 col-xl-5">
          <PageCard title="Qué ocurre al crear" subtitle="Las etapas quedan auditadas de forma separada.">
            <ol className="text-secondary mb-0 d-flex flex-column gap-2">
              <li>Validar plantilla de Logto y el rol <code>{ORGANIZATION_BOOTSTRAP_ADMIN_ROLE}</code>.</li>
              <li>Crear o reconciliar la organización canónica en Logto.</li>
              <li>Enviar <code>customData</code> OIDC generado automáticamente a Logto durante la creación.</li>
              <li>Enlazar metadata operativa local con <code>logto_organization_id</code>.</li>
              <li>Guardar dominio institucional como <code>pending_logto_configuration</code> para JIT/seats futuro.</li>
              <li>Agregar admin base y asignar rol solo si se proporcionó un Logto user id; si no, queda invitación pendiente.</li>
              <li>Enviar errores y soporte técnico a <strong>Observabilidad &gt; Logs</strong>.</li>
            </ol>
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}
