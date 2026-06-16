import { useState } from "react";
import { Alert, Badge, Button, Form } from "react-bootstrap";
import { useOwnerApi } from "../../api/owner";
import { ORGANIZATION_BOOTSTRAP_ADMIN_ROLE, ORGANIZATION_JIT_DEFAULT_ROLE } from "../../authLayers";
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
  const [adminRoleName, setAdminRoleName] = useState<string>(ORGANIZATION_BOOTSTRAP_ADMIN_ROLE);
  const [jitDefaultRoleName, setJitDefaultRoleName] = useState<string>(ORGANIZATION_JIT_DEFAULT_ROLE);
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
  const selectedAdminRole = roles.some((role) => role.name === adminRoleName) ? adminRoleName : ORGANIZATION_BOOTSTRAP_ADMIN_ROLE;
  const selectedJitDefaultRole = roles.some((role) => role.name === jitDefaultRoleName) ? jitDefaultRoleName : ORGANIZATION_JIT_DEFAULT_ROLE;
  const logtoUserIdLooksLikeRole = ([ORGANIZATION_BOOTSTRAP_ADMIN_ROLE, ORGANIZATION_JIT_DEFAULT_ROLE] as string[]).includes(baseAdminLogtoUserId.trim());

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
        baseAdmin: {
          name: baseAdminName || undefined,
          email: baseAdminEmail || undefined,
          logtoUserId: baseAdminLogtoUserId || undefined,
          initialOrganizationRole: selectedAdminRole,
        },
        jitProvisioning: {
          domain: adminDomain || undefined,
          defaultRoleNames: [selectedJitDefaultRole],
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
      description="Flujo Logto-first: la organización nace canónicamente en Logto; Civitas no crea una pre-organización local ni checkpoints pending para validar el alta."
      actions={<Badge bg="success">organizations:create</Badge>}
    >
      <div className="row g-4">
        <div className="col-12 col-xl-7">
          <PageCard title="Nueva organización" subtitle="Logto es la fuente canónica; la base local queda fuera del camino obligatorio de creación.">
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
                <Form.Group controlId="ownerOrganizationBaseAdminLogtoId"><Form.Label>Logto user id admin base</Form.Label><Form.Control isInvalid={logtoUserIdLooksLikeRole} value={baseAdminLogtoUserId} onChange={(event) => setBaseAdminLogtoUserId(event.target.value)} placeholder="Opcional; deja vacío para crear o resolver por correo" /><Form.Control.Feedback type="invalid">Este campo es un ID de usuario Logto; no puede ser {ORGANIZATION_BOOTSTRAP_ADMIN_ROLE} ni {ORGANIZATION_JIT_DEFAULT_ROLE}.</Form.Control.Feedback><Form.Text>Si se omite, Civitas crea o resuelve el usuario por correo en Logto antes de agregarlo a la organización.</Form.Text></Form.Group>
                <div className="row g-3">
                  <Form.Group className="col-12 col-lg-6" controlId="ownerOrganizationAdminRole"><Form.Label>Rol organizacional del admin base</Form.Label><Form.Select value={selectedAdminRole} onChange={(event) => setAdminRoleName(event.target.value)} disabled={roles.length === 0}>{roles.map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</Form.Select><Form.Text>Este rol se asigna solo al admin base.</Form.Text></Form.Group>
                  <Form.Group className="col-12 col-lg-6" controlId="ownerOrganizationJitRole"><Form.Label>Rol predeterminado JIT</Form.Label><Form.Select value={selectedJitDefaultRole} onChange={(event) => setJitDefaultRoleName(event.target.value)} disabled={roles.length === 0}>{roles.map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</Form.Select><Form.Text>Este rol se aplicará a futuros usuarios del dominio institucional.</Form.Text></Form.Group>
                </div>
                <Alert variant="info" className="mb-0">
                  El alta crea o reconcilia la organización en Logto, crea/resuelve el admin base por email si falta su user id, lo agrega como miembro, le asigna el rol admin y configura el dominio JIT con el rol predeterminado seleccionado.
                </Alert>
                {submitError && <Alert variant="danger" className="mb-0">{submitError}</Alert>}
                {submitWarning && <Alert variant="warning" className="mb-0">{submitWarning}</Alert>}
                <Button type="submit" disabled={isSubmitting || logtoUserIdLooksLikeRole || !name.trim() || !slug.trim() || !appSubdomain.trim() || !adminDomain.trim() || !baseAdminName.trim() || !baseAdminEmail.trim() || !templateResource.data?.ready}>{isSubmitting ? "Creando..." : "Crear organización"}</Button>
              </Form>
            )}
          </PageCard>
        </div>
        <div className="col-12 col-xl-5">
          <PageCard title="Qué ocurre al crear" subtitle="Las etapas quedan auditadas de forma separada.">
            <ol className="text-secondary mb-0 d-flex flex-column gap-2">
              <li>Crear o reconciliar primero la organización canónica en Logto.</li>
              <li>Enviar <code>customData</code> derivado de slug/subdominio/dominio directamente a Logto.</li>
              <li>No insertar <code>organization_profiles</code> ni checkpoints locales como requisito del alta.</li>
              <li>Crear o resolver al admin base en Logto, agregarlo como miembro y asignarle el rol <code>{ORGANIZATION_BOOTSTRAP_ADMIN_ROLE}</code>.</li>
              <li>Configurar JIT en Logto para el dominio institucional con <code>{ORGANIZATION_JIT_DEFAULT_ROLE}</code> como rol predeterminado.</li>
              <li>Enviar errores y soporte técnico a <strong>Observabilidad &gt; Logs</strong>.</li>
            </ol>
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}
