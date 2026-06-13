import { Button, Card } from "react-bootstrap";
import { mockOrganizations } from "../../navigation/mockData";
import { EmptyState, PageCard, PageShell } from "../../shared/ui";

export function SelectOrganizationPage() {
  return (
    <PageShell
      eyebrow="Organizaciones"
      title="Seleccionar organización"
      description="Selector visual mock. No crea sesión, membresías, permisos ni consultas reales."
    >
      <div className="row g-4">
        {mockOrganizations.map((organization) => (
          <div className="col-12 col-md-6" key={organization.id}>
            <Card className="h-100 border-0 shadow-sm civitas-select-card">
              <Card.Body>
                <div className="d-flex justify-content-between gap-3 mb-3">
                  <div>
                    <Card.Title className="mb-1">{organization.name}</Card.Title>
                    <Card.Subtitle className="text-secondary small">
                      {organization.members} miembros mock
                    </Card.Subtitle>
                  </div>
                  <span className="badge rounded-pill text-bg-primary-subtle text-primary-emphasis border border-primary-subtle">
                    Demo
                  </span>
                </div>
                <Card.Text className="text-secondary">{organization.description}</Card.Text>
                <Button variant="outline-primary">Continuar mock</Button>
              </Card.Body>
            </Card>
          </div>
        ))}
      </div>

      <PageCard className="mt-4" title="Sin organizaciones reales">
        <EmptyState
          title="No hay datos conectados"
          description="Esta fase solo muestra organizaciones locales de ejemplo para verificar el flujo visual."
        />
      </PageCard>
    </PageShell>
  );
}
