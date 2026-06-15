import { Accordion, Nav } from "react-bootstrap";
import { NavLink } from "react-router-dom";
import { ownerNavigation, primaryNavigation } from "./routes";

export function Sidebar() {
  return (
    <aside className="civitas-sidebar d-none d-lg-flex flex-column border-end bg-white">
      <SidebarBrand />
      <SidebarNav />
    </aside>
  );
}

export function SidebarBrand() {
  return (
    <div className="px-4 py-4 border-bottom">
      <div className="d-flex align-items-center gap-2">
        <span className="civitas-brand-mark">C</span>
        <div>
          <p className="fw-bold mb-0">Civitas</p>
          <p className="small text-secondary mb-0">Fase 07 · Logto-first</p>
        </div>
      </div>
    </div>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Nav className="flex-column gap-2 p-3" as="nav">
      <Accordion defaultActiveKey="owner" alwaysOpen>
        <Accordion.Item eventKey="owner" className="border-0">
          <Accordion.Header>Owner</Accordion.Header>
          <Accordion.Body className="p-0 pt-2">
            <div className="d-flex flex-column gap-1">
              {ownerNavigation.map((item) => (
                <NavLink key={item.path} to={item.path} onClick={onNavigate} className={({ isActive }) => `nav-link civitas-sidebar-link rounded-3 px-3 py-2 ${isActive ? "active" : ""}`}>
                  <span className="fw-semibold">{item.label}</span>
                  {item.description && <span className="d-block small text-secondary">{item.description}</span>}
                </NavLink>
              ))}
            </div>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      {primaryNavigation.map((item) => (
        <NavLink key={item.path} to={item.path} onClick={onNavigate} className={({ isActive }) => `nav-link civitas-sidebar-link rounded-3 px-3 py-2 ${isActive ? "active" : ""}`}>
          <span className="fw-semibold">{item.label}</span>
          {item.description && <span className="d-block small text-secondary">{item.description}</span>}
        </NavLink>
      ))}
    </Nav>
  );
}
