import { Button, Container, Navbar } from "react-bootstrap";
import { AppBreadcrumbs } from "./AppBreadcrumbs";

type HeaderProps = {
  onMenuClick: () => void;
};

export function Header({ onMenuClick }: HeaderProps) {
  return (
    <Navbar className="civitas-header border-bottom bg-white" expand="lg">
      <Container fluid className="gap-3">
        <Button
          variant="outline-primary"
          className="d-lg-none"
          onClick={onMenuClick}
          aria-label="Abrir navegación"
        >
          ☰
        </Button>
        <div className="flex-grow-1">
          <AppBreadcrumbs />
        </div>
        <div className="d-none d-md-flex align-items-center gap-2 text-secondary small">
          <span className="badge text-bg-success-subtle text-success-emphasis border border-success-subtle">
            Mock local
          </span>
          <span>Sin autenticación</span>
        </div>
      </Container>
    </Navbar>
  );
}
