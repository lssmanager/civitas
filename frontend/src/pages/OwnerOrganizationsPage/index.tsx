import { useState } from "react";
import { Alert, Badge, Button, Form } from "react-bootstrap";
import { useOwnerApi } from "../../api/owner";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { ErrorState, LoadingState, PageCard, PageShell } from "../../shared/ui";

export function OwnerOrganizationsPage() {
  const ownerApi = useOwnerApi();
  const [name, setName] = useState("");
  const [adminDomain, setAdminDomain] = useState("");
  const [baseAdminName, setBaseAdminName] = useState("");
  const [baseAdminEmail, setBaseAdminEmail] = useState("");
  const [baseAdminLogtoUserId, setBaseAdminLogtoUserId] = useState("");
  const [defaultRoleName, setDefaultRoleName] = useState("Admin-org");
  const [customSettingsJson, setCustomSettingsJson] = useState("{}");
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
      let settings: Record<string, unknown> | undefined;
      if (customSettingsJson.trim()) {
        settings = JSON.parse(customSettingsJson);
      }

      const result = await ownerApi.createOrganization({
        name,
        adminDomain: adminDomain || undefined,
        defaultRoleNames: [selectedRole],
        baseAdmin: {
          name: baseAdminName || undefined,
          email: baseAdminEmail || undefined,
          logtoUserId: baseAdminLogtoUserId || undefined,
        },
        settings,
      });

      setName("");
      setAdminDomain("");
      setBaseAdminName("");
      setBaseAdminEmail("");
      setBaseAdminLogtoUserId("");
      setCustomSettingsJson("{}");
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
                    Falta configurar la plantilla de Logto. Roles requeridos ausentes: {templateResource.data.missingRoleNames.join(", ") || "Admin-org"}.
                  </Alert>
                ) : null}
                <Form.Group controlId="ownerOrganizationName"><Form.Label>Nombre de organización</Form.Label><Form.Control value={name} onChange={(event) => setName(event.target.value)} placeholder="Colegio 1" required /></Form.Group>
                <Form.Group controlId="ownerOrganizationAdminDomain"><Form.Label>Dominio admin / correo</Form.Label><Form.Control value={adminDomain} onChange={(event) => setAdminDomain(event.target.value)} placeholder="colegio1.edu.co" /></Form.Group>
                <div className="row g-3">
                  <Form.Group className="col-12 col-lg-6" controlId="ownerOrganizationBaseAdminName"><Form.Label>Nombre admin base</Form.Label><Form.Control value={baseAdminName} onChange={(event) => setBaseAdminName(event.target.value)} placeholder="María Admin" /></Form.Group>
                  <Form.Group className="col-12 col-lg-6" controlId="ownerOrganizationBaseAdminEmail"><Form.Label>Correo admin base</Form.Label><Form.Control type="email" value={baseAdminEmail} onChange={(event) => setBaseAdminEmail(event.target.value)} placeholder="admin@colegio1.edu.co" /></Form.Group>
                </div>
                <Form.Group controlId="ownerOrganizationBaseAdminLogtoId"><Form.Label>Logto user id admin base</Form.Label><Form.Control value={baseAdminLogtoUserId} onChange={(event) => setBaseAdminLogtoUserId(event.target.value)} placeholder="Opcional; si se omite, se usa el owner actual para bootstrap" /><Form.Text>La invitación por correo queda preparada para fase posterior; la asignación inmediata requiere usuario Logto existente.</Form.Text></Form.Group>
                <Form.Group controlId="ownerOrganizationRoles"><Form.Label>Rol inicial desde plantilla Logto</Form.Label><Form.Select value={selectedRole} onChange={(event) => setDefaultRoleName(event.target.value)} disabled={roles.length === 0}>{roles.map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}</Form.Select></Form.Group>
                <Form.Group controlId="ownerOrganizationSettings"><Form.Label>Datos personalizados JSON</Form.Label><Form.Control as="textarea" rows={5} value={customSettingsJson} onChange={(event) => setCustomSettingsJson(event.target.value)} spellCheck={false} /><Form.Text>Solo metadata operativa Civitas; no reemplaza la organización canónica de Logto.</Form.Text></Form.Group>
                {submitError && <Alert variant="danger" className="mb-0">{submitError}</Alert>}
                {submitWarning && <Alert variant="warning" className="mb-0">{submitWarning}</Alert>}
                <Button type="submit" disabled={isSubmitting || !name.trim() || !templateResource.data?.ready}>{isSubmitting ? "Creando..." : "Crear organización"}</Button>
              </Form>
            )}
          </PageCard>
        </div>
        <div className="col-12 col-xl-5">
          <PageCard title="Qué ocurre al crear" subtitle="Las etapas quedan auditadas de forma separada.">
            <ol className="text-secondary mb-0 d-flex flex-column gap-2">
              <li>Validar plantilla de Logto y el rol <code>Admin-org</code>.</li>
              <li>Crear o reconciliar la organización canónica en Logto.</li>
              <li>Enlazar metadata operativa local con <code>logto_organization_id</code>.</li>
              <li>Agregar admin base a la organización y asignar rol inicial.</li>
              <li>Enviar errores y soporte técnico a <strong>Observabilidad &gt; Logs</strong>.</li>
            </ol>
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}
