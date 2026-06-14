import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Form, ListGroup } from "react-bootstrap";
import type { CreateOrganizationPayload, Organization, OwnerMeResponse } from "../../api/owner";
import { useOwnerApi } from "../../api/owner";
import { OwnerGuard } from "../../guards/OwnerGuard";
import { DataTable, EmptyState, ErrorState, LoadingState, PageCard, PageShell, type DataTableColumn } from "../../shared/ui";

const organizationTypes: CreateOrganizationPayload["type"][] = ["school", "district", "community", "other"];
const subdomainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "No disponible");

const getOwnerOrganizationErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) {
    return "No se pudo completar la acción.";
  }

  const maybeStatus = (error as { status?: unknown }).status;
  const status = typeof maybeStatus === "number" ? maybeStatus : undefined;
  if (status === 401) {
    return "Sesión inválida o falta autenticación. Inicia sesión nuevamente.";
  }
  if (status === 403) {
    return "No tienes permisos owner para administrar organizaciones.";
  }
  if (status === 409) {
    return "Ya existe una organización con ese nombre o subdominio.";
  }
  if (status === 500) {
    return "Error del servidor al procesar organizaciones.";
  }

  return error.message;
};


const columns: DataTableColumn<Organization>[] = [
  { key: "name", header: "Nombre", render: (organization) => <span className="fw-semibold">{organization.name}</span> },
  { key: "type", header: "Tipo", render: (organization) => <Badge bg="info">{organization.type}</Badge> },
  { key: "subdomain", header: "Subdominio", render: (organization) => <code>{organization.subdomain}</code> },
  { key: "seatTotal", header: "Cupos", render: (organization) => organization.seatTotal.toLocaleString() },
  { key: "status", header: "Estado", render: (organization) => <Badge bg={organization.status === "active" ? "success" : "secondary"}>{organization.status}</Badge> },
  { key: "createdAt", header: "Creada", render: (organization) => formatDate(organization.createdAt) },
  { key: "updatedAt", header: "Actualizada", render: (organization) => formatDate(organization.updatedAt) },
];

function OrganizationsPanel() {
  const { createOrganization, listOrganizations } = useOwnerApi();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [formData, setFormData] = useState<CreateOrganizationPayload>({ name: "", type: "school", subdomain: "", seatTotal: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const loadOrganizations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await listOrganizations();
      setOrganizations(response.organizations);
    } catch (error) {
      setError(getOwnerOrganizationErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [listOrganizations]);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  const validateForm = () => {
    const name = formData.name.trim().replace(/\s+/g, " ");
    const subdomain = formData.subdomain.trim().toLowerCase();
    const seatTotal = Number(formData.seatTotal);

    if (name.length < 2 || name.length > 120) {
      return "El nombre debe tener entre 2 y 120 caracteres.";
    }

    if (!subdomainPattern.test(subdomain)) {
      return "El subdominio debe usar solo minúsculas, números y guiones, sin iniciar ni terminar con guion.";
    }

    if (!organizationTypes.includes(formData.type)) {
      return "Selecciona un tipo de organización válido.";
    }

    if (!Number.isInteger(seatTotal) || seatTotal < 0) {
      return "Los cupos deben ser un entero mayor o igual a 0.";
    }

    return null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setFormError(null);
    setSuccess(null);

    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsCreating(true);

    try {
      const response = await createOrganization({
        name: formData.name.trim().replace(/\s+/g, " "),
        type: formData.type,
        subdomain: formData.subdomain.trim().toLowerCase(),
        seatTotal: Number(formData.seatTotal),
      });
      await loadOrganizations();
      setFormData({ name: "", type: "school", subdomain: "", seatTotal: 0 });
      setSuccess(`Organización creada: ${response.organization.name}`);
    } catch (error) {
      setFormError(getOwnerOrganizationErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="row g-4">
      <div className="col-12 col-xl-8">
        <PageCard title="Organizaciones" subtitle="Modelo interno de Civitas. No sincroniza con Logto ni plataformas externas.">
          {isLoading ? (
            <LoadingState title="Cargando organizaciones" description="Consultando la base interna de Civitas." />
          ) : error && organizations.length === 0 ? (
            <ErrorState title="No se pudieron cargar las organizaciones" message={error} action={<Button onClick={() => void loadOrganizations()}>Reintentar</Button>} />
          ) : organizations.length === 0 ? (
            <EmptyState title="Sin organizaciones" description="Crea la primera organización interna desde el formulario." />
          ) : (
            <DataTable columns={columns} rows={organizations} getRowKey={(organization) => organization.id} emptyTitle="Sin organizaciones" />
          )}
        </PageCard>
      </div>
      <div className="col-12 col-xl-4">
        <PageCard title="Nueva organización" subtitle="Solo alta interna en PostgreSQL.">
          {success && <Alert variant="success">{success}</Alert>}
          {formError && <Alert variant="danger">{formError}</Alert>}
          {error && organizations.length > 0 && <Alert variant="danger">{error}</Alert>}
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3" controlId="organizationName"><Form.Label>Nombre</Form.Label><Form.Control minLength={2} maxLength={120} required value={formData.name} onChange={(e) => setFormData((current) => ({ ...current, name: e.target.value }))} placeholder="Colegio Demo" /></Form.Group>
            <Form.Group className="mb-3" controlId="organizationType"><Form.Label>Tipo</Form.Label><Form.Select value={formData.type} onChange={(e) => setFormData((current) => ({ ...current, type: e.target.value as CreateOrganizationPayload["type"] }))}>{organizationTypes.map((type) => <option key={type} value={type}>{type}</option>)}</Form.Select></Form.Group>
            <Form.Group className="mb-3" controlId="organizationSubdomain"><Form.Label>Subdominio</Form.Label><Form.Control pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" required value={formData.subdomain} onChange={(e) => setFormData((current) => ({ ...current, subdomain: e.target.value.toLowerCase() }))} placeholder="colegio-demo" /></Form.Group>
            <Form.Group className="mb-4" controlId="organizationSeatTotal"><Form.Label>Cupos</Form.Label><Form.Control min={0} step={1} required type="number" value={formData.seatTotal} onChange={(e) => setFormData((current) => ({ ...current, seatTotal: Number(e.target.value) }))} /></Form.Group>
            <Button type="submit" disabled={isCreating}>{isCreating ? "Creando..." : "Crear organización"}</Button>
          </Form>
        </PageCard>
      </div>
    </div>
  );
}

function OwnerDashboard({ ownerMe }: { ownerMe: OwnerMeResponse }) {
  const { authScopes, owner, ownerAuthorizedBy, scope } = ownerMe;

  return (
    <PageShell eyebrow="Owner" title="Portal owner" description="Administración global protegida para el owner de Civitas." actions={<Badge bg="success">owner_global</Badge>}>
      <div className="row g-4 mb-1">
        <div className="col-12 col-xl-7">
          <PageCard title="Owner autenticado" subtitle="Datos mínimos del usuario interno persistido en PostgreSQL.">
            <ListGroup variant="flush">
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Internal user id</span><span className="fw-semibold text-break text-end">{owner.id}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Logto user id</span><span className="fw-semibold text-break text-end">{owner.logtoUserId}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Email</span><span className="fw-semibold text-break text-end">{owner.email ?? "No disponible"}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Status</span><Badge bg={owner.status === "active" ? "success" : "warning"}>{owner.status}</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Autorizado por</span><Badge bg="primary">{ownerAuthorizedBy}</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Last login</span><span className="fw-semibold text-end">{formatDate(owner.lastLoginAt)}</span></ListGroup.Item>
              <ListGroup.Item className="px-0"><div className="text-secondary mb-2">Scopes Logto</div><div className="d-flex flex-wrap gap-2">{authScopes.map((scope) => <Badge key={scope} bg="dark">{scope}</Badge>)}</div></ListGroup.Item>
            </ListGroup>
          </PageCard>
        </div>
        <div className="col-12 col-xl-5">
          <PageCard title="Alcance Fase 05" subtitle="Organizaciones internas sin sincronizaciones externas.">
            <ListGroup variant="flush">
              <ListGroup.Item className="d-flex justify-content-between px-0"><span>Organizaciones</span><Badge bg={scope.organizations ? "success" : "secondary"}>{scope.organizations ? "Activo" : "Fuera de alcance"}</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between px-0"><span>Membresías</span><Badge bg="secondary">Fuera de alcance</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between px-0"><span>RBAC fino</span><Badge bg="secondary">Fuera de alcance</Badge></ListGroup.Item>
            </ListGroup>
          </PageCard>
        </div>
        <div className="col-12"><OrganizationsPanel /></div>
      </div>
    </PageShell>
  );
}

export function OwnerPage() {
  return <OwnerGuard>{(ownerMe) => <OwnerDashboard ownerMe={ownerMe} />}</OwnerGuard>;
}
