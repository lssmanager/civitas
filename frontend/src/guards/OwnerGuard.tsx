import { Badge, Button } from "react-bootstrap";
import { useSession } from "../session/sessionContext";
import { ErrorState, PageCard, PageShell } from "../shared/ui";
import {
  getOwnerAuthorizationFromSession,
  OWNER_REQUIRED_SCOPE,
  type OwnerAuthorizationContext,
} from "./ownerAuthorization";

type OwnerGuardProps = {
  children: (ownerMe: OwnerAuthorizationContext) => React.ReactNode;
};

export function OwnerGuard({ children }: OwnerGuardProps) {
  const { error, me } = useSession();

  if (error) {
    return (
      <PageShell eyebrow="Owner" title="Acceso denegado" description="El portal owner requiere scopes globales de Logto." actions={<Badge bg="danger">403</Badge>}>
        <PageCard title="Permisos insuficientes">
          <ErrorState
            title="No se pudo validar el acceso owner"
            message={error}
            action={<Button href="/account" variant="outline-primary">Ver mi cuenta</Button>}
          />
        </PageCard>
      </PageShell>
    );
  }

  if (!me) {
    return (
      <PageShell eyebrow="Owner" title="Acceso denegado" description="El portal owner requiere una sesión inicializada de Civitas." actions={<Badge bg="danger">403</Badge>}>
        <PageCard title="Sesion no inicializada">
          <ErrorState
            title="Sesion no disponible"
            message="Civitas no pudo resolver el usuario interno antes de validar owner."
            action={<Button href="/account" variant="outline-primary">Ver mi cuenta</Button>}
          />
        </PageCard>
      </PageShell>
    );
  }

  const scopes = Array.isArray(me.auth?.scopes) ? me.auth.scopes : [];
  const isAuthorized = scopes.includes(OWNER_REQUIRED_SCOPE);

  if (!isAuthorized) {
    return (
      <PageShell eyebrow="Owner" title="Acceso denegado" description="El portal owner requiere scopes globales de Logto." actions={<Badge bg="danger">403</Badge>}>
        <PageCard title="Permisos insuficientes">
          <ErrorState
            title="Permisos insuficientes"
            message="Tu access token de Logto no contiene el scope global owner:read."
            action={<Button href="/account" variant="outline-primary">Ver mi cuenta</Button>}
          />
        </PageCard>
      </PageShell>
    );
  }

  return <>{children(getOwnerAuthorizationFromSession(me))}</>;
}
