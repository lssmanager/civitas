import { Badge, Button, ListGroup } from "react-bootstrap";
import { ErrorState, PageCard, PageShell } from "../../shared/ui";

export function AccountPage() {
  return (
    <PageShell
      eyebrow="Cuenta"
      title="Perfil local mock"
      description="Resumen estático para validar la ruta /account sin introducir login, logout ni proveedor de identidad."
      actions={<Button variant="outline-secondary">Editar mock</Button>}
    >
      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <PageCard title="Información de cuenta" subtitle="Datos fijos usados solo para composición de UI.">
            <ListGroup variant="flush">
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0">
                <span className="text-secondary">Nombre visible</span>
                <span className="fw-semibold">Usuario Civitas Demo</span>
              </ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0">
                <span className="text-secondary">Correo</span>
                <span className="fw-semibold">demo@civitas.local</span>
              </ListGroup.Item>
              <ListGroup.Item className="d-flex justify-content-between align-items-start px-0">
                <span className="text-secondary">Modo</span>
                <Badge bg="secondary">Mock sin auth</Badge>
              </ListGroup.Item>
            </ListGroup>
          </PageCard>
        </div>
        <div className="col-12 col-lg-5">
          <PageCard title="Aviso de alcance">
            <ErrorState
              title="Autenticación fuera de alcance"
              message="Esta pantalla no activa Logto, guards, roles, permisos ni consumo de API real."
            />
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}
