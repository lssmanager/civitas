import { useState } from "react";
import { Alert, Badge, Button, Form } from "react-bootstrap";
import { useOwnerApi } from "../../api/owner";
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
  const [defaultRoleName, setDefaultRoleName] = useState("Admin-org");
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
  const selectedRole = roles.some((role) => role.name === defaultRoleName) ? defaultRoleName : roles[0]?.name ?? "Admin-org";

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
        },
      });

      setName("");
      setSlug("");
      setAppSubdomain("");
      setAdminDomain("");
      setBaseAdminName("");
      setBaseAdminEmail("");
      if (result.warning) setSubmitWarning(result.warning);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo crear la organización.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageShell
      eyebrow="Owner / Crear organización"
      title="Crear organización"
      description="Formulario operativo para dar de alta una organización. La consola técnica y la reconciliación viven en Observabilidad."
      actions={<Badge bg="success">organizations:create</Badge>}
    >
      <div className="row g-4">
        <div className="col-12 col-xl-8">
          <PageCard title="Nueva organización" subtitle="Completa los datos humanos mínimos para ejecutar el alta owner.">
            {templateResource.isLoading ? (
              <LoadingState title="Cargando plantilla" description="Consultando roles de la organization template de Logto." />
            ) : templateResource.error ? (
              <ErrorState title="No se pudo cargar la plantilla" message={templateResource.error} action={<Button onClick={templateResource.retry}>Reintentar</Button>} />
            ) : (
              <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
                {templateResource.data && !templateResource.data.ready ? (
                  <Alert variant="danger" className="mb-0">
                    Falta configurar la plantilla de Logto. Roles requeridos ausentes: {templateResource.data.missingRoleNames.join(", ") || "Admin-org"}.
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
                <Form.Group controlId="ownerOrganizationRoles"><Form.Label>Rol inicial desde plantilla Logto</Form.Label><Form.Select value={selectedRole} onChange={(event) => setDefaultRoleName(event.target.value)} disabled={roles.length === 0}>{roles.map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</Form.Select></Form.Group>
                <Alert variant="info" className="mb-0">
                  Civitas generará la configuración técnica necesaria a partir de estos campos. Revisa detalles, ids y reconciliación en <strong>Observabilidad &gt; Logs</strong>.
                </Alert>
                {submitError && <Alert variant="danger" className="mb-0">{submitError}</Alert>}
                {submitWarning && <Alert variant="warning" className="mb-0">{submitWarning}</Alert>}
                <Button type="submit" disabled={isSubmitting || !name.trim() || !slug.trim() || !appSubdomain.trim() || !adminDomain.trim() || !baseAdminName.trim() || !baseAdminEmail.trim() || !templateResource.data?.ready}>{isSubmitting ? "Creando..." : "Crear organización"}</Button>
              </Form>
            )}
          </PageCard>
        </div>
        <div className="col-12 col-xl-4">
          <PageCard title="Después del alta" subtitle="Feedback operativo del flujo.">
            <ul className="text-secondary mb-0 d-flex flex-column gap-2">
              <li>El formulario validará campos requeridos antes de enviar.</li>
              <li>Si la creación termina con advertencias, aparecerán aquí como feedback operativo.</li>
              <li>Los ids Logto, estados parciales y errores técnicos se revisan en <strong>Observabilidad &gt; Logs</strong>.</li>
            </ul>
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}
