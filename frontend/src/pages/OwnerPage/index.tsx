import { useMemo, useState } from "react";
import { Alert, Badge, Button, Form, ListGroup } from "react-bootstrap";
import { useOutletContext } from "react-router-dom";
import { useOwnerApi, type OwnerOrganization } from "../../api/owner";
import { devOwnerMe, type OwnerAuthorizationContext } from "../../guards/ownerAuthorization";
import { useStableResource } from "../../shared/hooks/useStableResource";
import { DataTable, EmptyState, ErrorState, LoadingState, PageCard, PageShell, type DataTableColumn } from "../../shared/ui";

type OwnerDashboardProps = {
  ownerMe: OwnerAuthorizationContext;
};

const getSyncBadge = (status?: string) => {
  if (status === "synced") return <Badge bg="success">Sincronizada</Badge>;
  if (status === "error") return <Badge bg="danger">Error Logto</Badge>;
  return <Badge bg="warning" text="dark">Pendiente</Badge>;
};

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "Sin sync exitoso");

function OwnerDashboard({ ownerMe }: OwnerDashboardProps) {
  const { owner } = ownerMe;
  const ownerApi = useOwnerApi();
  const [name, setName] = useState("");
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
          <div className="text-secondary small text-break">Perfil interno: {organization.profile?.id}</div>
        </div>
      ),
    },
    {
      key: "logto",
      header: "Logto",
      render: (organization) => (
        <div className="d-flex flex-column gap-1">
          {getSyncBadge(organization.profile?.logtoSyncStatus)}
          <span className="text-secondary small text-break">{organization.logtoOrganizationId ?? "Aún sin id Logto"}</span>
        </div>
      ),
    },
    {
      key: "lastSync",
      header: "Último sync exitoso",
      render: (organization) => <span className="small">{formatDate(organization.profile?.logtoSyncedAt)}</span>,
    },
    {
      key: "error",
      header: "Error visible",
      render: (organization) => organization.profile?.logtoSyncError ? (
        <Alert variant="danger" className="py-2 px-3 mb-0 small">{organization.profile.logtoSyncError}</Alert>
      ) : <span className="text-secondary small">Sin error registrado</span>,
    },
  ], []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      await ownerApi.createOrganization({ name });
      setName("");
      organizationsResource.reload();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo crear la organización.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageShell
      eyebrow="Owner"
      title="Portal owner"
      description="Entrada protegida por Logto RBAC. Civitas valida scopes globales del API resource, no roles guardados en PostgreSQL."
      actions={<Badge bg="success">owner:read</Badge>}
    >
      <div className="row g-4">
        <div className="col-12 col-xl-7">
          <PageCard title="Owner autorizado por Logto" subtitle="El owner global se determina por scopes del access token de Logto.">
            <ListGroup variant="flush">
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Internal user id</span><span className="fw-semibold text-break text-end">{owner.internalUserId}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Logto user id</span><span className="fw-semibold text-break text-end">{owner.logtoUserId}</span></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Autorizado por</span><Badge bg="primary">{owner.authorizedBy}</Badge></ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Scope requerido</span><Badge bg="success">{owner.requiredScope}</Badge></ListGroup.Item>
            </ListGroup>
          </PageCard>
        </div>
        <div className="col-12 col-xl-5">
          <PageCard title="Scopes detectados" subtitle="Permisos globales incluidos en el access token del API resource.">
            <div className="d-flex flex-wrap gap-2">
              {owner.scopes.map((scope) => <Badge bg="secondary" key={scope}>{scope}</Badge>)}
            </div>
          </PageCard>
        </div>
        <div className="col-12 col-xl-4">
          <PageCard title="Crear organización" subtitle="Civitas persiste primero y luego sincroniza con Logto vía backend M2M.">
            <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
              <Form.Group controlId="ownerOrganizationName">
                <Form.Label>Nombre</Form.Label>
                <Form.Control value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Legal" required />
              </Form.Group>
              {submitError && <Alert variant="danger" className="mb-0">{submitError}</Alert>}
              <Button type="submit" disabled={isSubmitting || !name.trim()}>{isSubmitting ? "Creando..." : "Crear y sincronizar"}</Button>
            </Form>
          </PageCard>
        </div>
        <div className="col-12 col-xl-8">
          <PageCard title="Organizaciones Civitas / Logto" subtitle="El estado de sincronización se lee desde PostgreSQL para evitar inconsistencias invisibles.">
            {organizationsResource.isLoading ? (
              <LoadingState title="Cargando organizaciones" description="Consultando el registro operativo interno de Civitas." />
            ) : organizationsResource.error ? (
              <ErrorState title="No se pudieron cargar organizaciones" message={organizationsResource.error} action={<Button onClick={organizationsResource.retry}>Reintentar</Button>} />
            ) : organizations.length === 0 ? (
              <EmptyState title="Sin organizaciones" description="Crea la primera organización; si Logto falla, verás el error persistido aquí." />
            ) : (
              <DataTable columns={columns} rows={organizations} getRowKey={(row) => row.profile?.id ?? row.logtoOrganizationId ?? row.name ?? "organization"} />
            )}
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}

export function OwnerPage() {
  const ownerMe = useOutletContext<OwnerAuthorizationContext | undefined>();

  return <OwnerDashboard ownerMe={ownerMe ?? devOwnerMe} />;
}
