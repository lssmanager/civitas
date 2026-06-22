import { useLogto } from "@logto/react";
import { Button, Container, Navbar } from "react-bootstrap";
import { APP_ENV } from "../env";
import { isLogtoAuthEnabled } from "../authConfig";
import { useSession } from "../session/sessionContext";
import { AppBreadcrumbs } from "./AppBreadcrumbs";

type HeaderProps = {
  onMenuClick: () => void;
};

function LogtoSessionControls() {
  const { isAuthenticated, isLoading, signIn, signOut } = useLogto();
  const { idTokenClaims } = useSession();

  const displayName =
    idTokenClaims?.name ?? idTokenClaims?.username ?? idTokenClaims?.sub ?? "Usuario Logto";

  if (isAuthenticated) {
    return (
      <div className="d-flex align-items-center gap-2 text-secondary small">
        <span className="badge text-bg-success-subtle text-success-emphasis border border-success-subtle">
          Logto activo
        </span>
        <span className="text-truncate civitas-header__user" title={idTokenClaims?.sub}>
          {displayName}
        </span>
        <Button
          size="sm"
          variant="outline-secondary"
          onClick={() => void signOut(APP_ENV.app.signOutRedirectUri)}
        >
          Salir
        </Button>
      </div>
    );
  }

  return (
    <div className="d-flex align-items-center gap-2 text-secondary small">
      <span className="badge text-bg-warning-subtle text-warning-emphasis border border-warning-subtle">
        Sesión requerida
      </span>
      <Button
        size="sm"
        variant="primary"
        disabled={isLoading}
        onClick={() => void signIn(APP_ENV.app.redirectUri)}
      >
        Iniciar sesión
      </Button>
    </div>
  );
}

function DevSessionControls() {
  return (
    <div className="d-none d-md-flex align-items-center gap-2 text-secondary small">
      <span className="badge text-bg-success-subtle text-success-emphasis border border-success-subtle">
        Mock local
      </span>
      <span>Logto desactivado</span>
    </div>
  );
}

export function Header({ onMenuClick }: HeaderProps) {
  return (
    <Navbar className="civitas-header border-bottom" expand="lg">
      <Container fluid className="civitas-header__inner gap-3">
        <Button
          variant="outline-primary"
          className="civitas-header__menu d-lg-none"
          onClick={onMenuClick}
          aria-label="Abrir navegación"
        >
          ☰
        </Button>
        <div className="civitas-header__breadcrumb flex-grow-1">
          <AppBreadcrumbs />
        </div>
        {isLogtoAuthEnabled ? <LogtoSessionControls /> : <DevSessionControls />}
      </Container>
    </Navbar>
  );
}
