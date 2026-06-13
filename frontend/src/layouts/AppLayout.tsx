import { useState } from "react";
import { Container, Offcanvas } from "react-bootstrap";
import { Outlet } from "react-router-dom";
import { Header } from "../navigation/Header";
import { Sidebar, SidebarBrand, SidebarNav } from "../navigation/Sidebar";

export function AppLayout() {
  const [showNavigation, setShowNavigation] = useState(false);

  return (
    <div className="civitas-app-shell">
      <Sidebar />
      <div className="civitas-content-shell">
        <Header onMenuClick={() => setShowNavigation(true)} />
        <main className="civitas-main py-4 py-lg-5">
          <Container fluid="xl">
            <Outlet />
          </Container>
        </main>
      </div>

      <Offcanvas
        show={showNavigation}
        onHide={() => setShowNavigation(false)}
        aria-labelledby="mobile-navigation-title"
      >
        <Offcanvas.Header closeButton className="border-bottom">
          <Offcanvas.Title id="mobile-navigation-title" className="visually-hidden">
            Navegación principal
          </Offcanvas.Title>
          <SidebarBrand />
        </Offcanvas.Header>
        <Offcanvas.Body className="p-0">
          <SidebarNav onNavigate={() => setShowNavigation(false)} />
        </Offcanvas.Body>
      </Offcanvas>
    </div>
  );
}
