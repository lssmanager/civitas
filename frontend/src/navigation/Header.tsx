import { useLogto, type IdTokenClaims } from "@logto/react";
import { useEffect, useState } from "react";
import { Button, Container, Navbar } from "react-bootstrap";
import { APP_ENV } from "../env";
import { isLogtoAuthEnabled } from "../authConfig";
import { AppBreadcrumbs } from "./AppBreadcrumbs";

type HeaderProps = {
  onMenuClick: () => void;
};

function LogtoSessionControls() {
  const { isAuthenticated, isLoading, signIn, signOut, getIdTokenClaims } = useLogto();
  const [user, setUser] = useState<IdTokenClaims>();

  useEffect(() => {
    if (!isAuthenticated) {
      setUser(undefined);
      return;
    }

    void getIdTokenClaims().then((claims) => setUser(claims ?? undefined));
  }, [getIdTokenClaims, isAuthenticated]);

  const displayName = user?.name ?? user?.username ?? user?.sub ?? "Usuario Logto";

  if (isAuthenticated) {
    return (
      <div className="d-flex align-items-center gap-2 text-secondary small">
        <span className="badge text-bg-success-subtle text-success-emphasis border border-success-subtle">Logto activo</span>
        <span className="text-truncate" style={{ maxWidth: 220 }} title={user?.sub}> {displayName}</span>
        <Button size="sm" variant="outline-secondary" onClick={() => void signOut(APP_ENV.app.signOutRedirectUri)}>
          Salir
        </Button>
      </div>
    );
  }

  return (
    <div className="d-flex align-items-center gap-2 text-secondary small">
      <span className="badge text-bg-warning-subtle text-warning-emphasis border border-warning-subtle">Sesión requerida</span>
      <Button size="sm" variant="primary" disabled={isLoading} onClick={() => void signIn(APP_ENV.app.redirectUri)}>
        Iniciar sesión
      </Button>
    </div>
  );
}

function DevSessionControls() {
  return (
    <div className="d-none d-md-flex align-items-center gap-2 text-secondary small">
      <span className="badge text-bg-success-subtle text-success-emphasis border border-success-subtle">Mock local</span>
      <span>Logto desactivado</span>
    </div>
  );
}

export function Header({ onMenuClick }: HeaderProps) {
  return (
    <Navbar className="civitas-header border-bottom bg-white" expand="lg">
      <Container fluid className="gap-3">
        <Button variant="outline-primary" className="d-lg-none" onClick={onMenuClick} aria-label="Abrir navegación">☰</Button>
        <div className="flex-grow-1"><AppBreadcrumbs /></div>
        {isLogtoAuthEnabled ? <LogtoSessionControls /> : <DevSessionControls />}
      </Container>
    </Navbar>
  );
}
