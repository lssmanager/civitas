import { useLogto, type IdTokenClaims } from "@logto/react";
import { useEffect, useState } from "react";
import { Alert, Badge, ListGroup, Spinner } from "react-bootstrap";
import { ApiRequestError } from "../../api/base";
import { type MeResponse, useMeApi } from "../../api/me";
import { isLogtoAuthEnabled } from "../../authConfig";
import { ErrorState, PageCard, PageShell } from "../../shared/ui";

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "No disponible");

function getMeErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) {
      return "La sesión no es válida o falta autenticación. Inicia sesión otra vez.";
    }

    if (error.status === 403) {
      return "El usuario interno existe, pero no está activo. Contacta al administrador.";
    }
  }

  return error instanceof Error ? error.message : "No se pudo cargar el usuario interno.";
}

function LogtoAccountDetails() {
  const { getIdTokenClaims } = useLogto();
  const { getMe } = useMeApi();
  const [logtoUser, setLogtoUser] = useState<IdTokenClaims>();
  const [me, setMe] = useState<MeResponse>();
  const [isLoadingMe, setIsLoadingMe] = useState(true);
  const [meError, setMeError] = useState<string>();

  useEffect(() => {
    void getIdTokenClaims().then((claims) => setLogtoUser(claims ?? undefined));
  }, [getIdTokenClaims]);

  useEffect(() => {
    let isMounted = true;

    async function loadMe() {
      setIsLoadingMe(true);
      setMeError(undefined);

      try {
        const response = await getMe();
        if (isMounted) {
          setMe(response);
        }
      } catch (error) {
        if (isMounted) {
          setMe(undefined);
          setMeError(getMeErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsLoadingMe(false);
        }
      }
    }

    void loadMe();

    return () => {
      isMounted = false;
    };
  }, [getMe]);

  if (isLoadingMe) {
    return (
      <div className="d-flex align-items-center gap-2 text-secondary">
        <Spinner animation="border" size="sm" />
        <span>Cargando usuario interno de Civitas...</span>
      </div>
    );
  }

  if (meError) {
    return <Alert variant="danger">{meError}</Alert>;
  }

  return (
    <ListGroup variant="flush">
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Internal user id</span><span className="fw-semibold text-break text-end">{me?.user.id ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Logto user id</span><span className="fw-semibold text-break text-end">{me?.user.logtoUserId ?? logtoUser?.sub ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Email</span><span className="fw-semibold text-break text-end">{me?.user.email ?? "No disponible"}</span></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Status</span><Badge bg={me?.user.status === "active" ? "success" : "warning"}>{me?.user.status ?? "No disponible"}</Badge></ListGroup.Item>
      <ListGroup.Item className="d-flex justify-content-between align-items-start px-0"><span className="text-secondary">Last login</span><span className="fw-semibold text-end">{formatDate(me?.user.lastLoginAt)}</span></ListGroup.Item>
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
    <PageShell eyebrow="Cuenta" title="Perfil de sesión" description="Muestra la identidad interna de Civitas creada desde la sesión autenticada de Logto." actions={<Badge bg="primary">Fase 03</Badge>}>
      <div className="row g-4">
        <div className="col-12 col-lg-7"><PageCard title="Usuario interno" subtitle="Datos mínimos persistidos en PostgreSQL y vinculados al sub de Logto.">{isLogtoAuthEnabled ? <LogtoAccountDetails /> : <DevAccountDetails />}</PageCard></div>
        <div className="col-12 col-lg-5"><PageCard title="Aviso de alcance"><ErrorState title="Sin roles ni organizaciones todavía" message="Esta fase solo crea el usuario interno básico. Roles owner/admin, organizaciones, membresías, permisos finos y perfil completo quedan fuera de alcance." /></PageCard></div>
      </div>
    </PageShell>
  );
}
