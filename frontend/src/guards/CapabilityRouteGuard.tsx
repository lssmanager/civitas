import { Badge, Button } from "react-bootstrap";
import { deriveAuthorizationCapabilities, type CapabilityKey } from "../authz/capabilities";
import { useSession } from "../session/sessionContext";
import { ErrorState, PageCard, PageShell } from "../shared/ui";
export function CapabilityRouteGuard({ capability, children }: { capability: CapabilityKey; children: React.ReactNode }) {
  const { me } = useSession();
  if (!deriveAuthorizationCapabilities(me)[capability]) return <PageShell eyebrow="Autorización" title="Ruta no disponible" description="Esta pantalla no aplica a los permisos del access token vigente." actions={<Badge bg="danger">403</Badge>}><PageCard title="Acceso bloqueado por RBAC"><ErrorState title="Permiso insuficiente" message="El menú se oculta para esta capacidad y el acceso directo queda bloqueado por el route guard." action={<Button href="/account" variant="outline-primary">Ver metadata de sesión</Button>} /></PageCard></PageShell>;
  return <>{children}</>;
}
