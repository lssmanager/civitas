import { useLogto, type IdTokenClaims } from "@logto/react";
import { useEffect, useState } from "react";
import { Badge, Button, ListGroup } from "react-bootstrap";
import { isLogtoAuthEnabled } from "../../authConfig";
import { APP_ENV } from "../../env";
import { ErrorState, PageCard, PageShell } from "../../shared/ui";

function LogtoAccountDetails() {
  const { getIdTokenClaims, getAccessToken } = useLogto();
  const [user, setUser] = useState<IdTokenClaims>();
  const [apiTokenStatus, setApiTokenStatus] = useState("No solicitado");

  useEffect(() => {
    void getIdTokenClaims().then((claims) => setUser(claims ?? undefined));
  }, [getIdTokenClaims]);

  const requestApiToken = async () => {
    try {
      await getAccessToken(APP_ENV.api.resourceIndicator);
      setApiTokenStatus("Token de API disponible para el backend");
    } catch {
      setApiTokenStatus("No se pudo obtener token de API. Revisa el resource indicator en Logto.");
    }
  };

  return (
    <ListGroup variant="flush">
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Subject (sub)</span><span className="fw-semibold text-break text-end">{user?.sub ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Nombre</span><span className="fw-semibold">{user?.name ?? user?.username ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Modo</span><Badge bg="success">Logto</Badge></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Token API</span><span className="fw-semibold text-end">{apiTokenStatus}</span></ListGroup.Item>
      <ListGroup.Item className="px-0"><Button variant="outline-primary" onClick={() => void requestApiToken()}>Verificar token para backend</Button></ListGroup.Item>
    </ListGroup>
  );
}

function DevAccountDetails() {
  return (
    <ListGroup variant="flush">
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Nombre visible</span><span className="fw-semibold">Usuario Civitas Demo</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Correo</span><span className="fw-semibold">demo@civitas.local</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Modo</span><Badge bg="secondary">Mock sin auth</Badge></ListGroup.Item>
    </ListGroup>
  );
}

export function AccountPage() {
  return (
    <PageShell eyebrow="Cuenta" title="Perfil de sesión" description="Muestra datos mínimos del identity provider sin crear todavía un usuario interno de Civitas." actions={<Button variant="outline-secondary">Fase 02</Button>}>
      <div className="row g-4">
        <div className="col-12 col-lg-7"><PageCard title="Información de cuenta" subtitle="Datos mínimos obtenidos desde Logto cuando la autenticación está activa.">{isLogtoAuthEnabled ? <LogtoAccountDetails /> : <DevAccountDetails />}</PageCard></div>
        <div className="col-12 col-lg-5"><PageCard title="Aviso de alcance"><ErrorState title="Sin perfil interno todavía" message="Esta fase valida la sesión externa de Logto y tokens JWT, pero no crea usuarios en PostgreSQL, roles owner/admin ni organization tokens." /></PageCard></div>
      </div>
    </PageShell>
  );
}
