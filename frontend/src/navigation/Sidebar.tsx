import { Accordion, Nav } from "react-bootstrap";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  ownerNavigationTree,
  primaryNavigation,
  type AppRoute,
  type NavigationNode,
} from "./routes";

export function Sidebar() {
  return (
    <aside className="civitas-sidebar d-none d-lg-flex flex-column border-end">
      <SidebarBrand />
      <SidebarNav />
    </aside>
  );
}

export function SidebarBrand() {
  return (
    <div className="civitas-sidebar__brand px-4 py-4 border-bottom">
      <Link className="civitas-sidebar__brand-link" to="/owner" aria-label="Civitas">
        <img
          src="/civitas-logo-light.svg"
          alt="Civitas"
          className="civitas-sidebar__logo civitas-sidebar__logo--full civitas-sidebar__logo--light"
        />
        <img
          src="/civitas-logo-dark.svg"
          alt=""
          aria-hidden="true"
          className="civitas-sidebar__logo civitas-sidebar__logo--full civitas-sidebar__logo--dark"
        />
        <img
          src="/civitas-mark.svg"
          alt=""
          aria-hidden="true"
          className="civitas-sidebar__logo civitas-sidebar__logo--mark"
        />
      </Link>
    </div>
  );
}

function SidebarLink({
  item,
  onNavigate,
  nested = false,
}: {
  item: AppRoute;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={({ isActive }) =>
        `nav-link civitas-sidebar-link rounded-3 py-2 ${nested ? "px-3 ms-3" : "px-3"} ${isActive ? "active" : ""}`
      }
    >
      <span className="fw-semibold">{item.label}</span>
      {item.description && (
        <span className="d-block small civitas-sidebar-link__meta">{item.description}</span>
      )}
    </NavLink>
  );
}

function NavigationBranch({
  item,
  index,
  onNavigate,
}: {
  item: NavigationNode;
  index: number;
  onNavigate?: () => void;
}) {
  if (!item.children?.length) {
    return <SidebarLink item={item} onNavigate={onNavigate} />;
  }

  return (
    <Accordion.Item eventKey={`owner-section-${index}`} className="border-0 civitas-sidebar-section">
      <Accordion.Header>
        <span>
          <span className="fw-semibold">{item.label}</span>
          {item.description && (
            <span className="d-block small civitas-sidebar-link__meta">{item.description}</span>
          )}
        </span>
      </Accordion.Header>
      <Accordion.Body className="p-0 pt-1">
        <div className="d-flex flex-column gap-1 border-start ms-3 ps-1">
          {item.children.map((child) => (
            <SidebarLink key={child.path} item={child} onNavigate={onNavigate} nested />
          ))}
        </div>
      </Accordion.Body>
    </Accordion.Item>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const rootRoute = ownerNavigationTree[0];
  const sectionRoutes = ownerNavigationTree.slice(1);
  const activeOwnerSections = sectionRoutes
    .map((item, index) =>
      item.children?.some((child) => child.path === location.pathname)
        ? `owner-section-${index}`
        : undefined,
    )
    .filter((key): key is string => Boolean(key));

  return (
    <div className="civitas-sidebar__nav flex-grow-1 d-flex flex-column p-3 gap-3">
      <Nav className="flex-column gap-2 civitas-sidebar__panel" as="nav">
        <div className="civitas-sidebar__panel-header px-3 py-3">
          <p className="mb-1 fw-semibold text-white">Owner</p>
          <p className="mb-0 small civitas-sidebar-link__meta">Espacio global del producto y sus operaciones.</p>
        </div>
        {rootRoute ? <SidebarLink item={rootRoute} onNavigate={onNavigate} /> : null}
        <Accordion defaultActiveKey={activeOwnerSections} alwaysOpen>
          {sectionRoutes.map((item, index) => (
            <NavigationBranch key={item.path} item={item} index={index} onNavigate={onNavigate} />
          ))}
        </Accordion>
      </Nav>
      <Nav className="flex-column gap-2 civitas-sidebar__panel civitas-sidebar__panel--secondary mt-auto" as="nav">
        {primaryNavigation.map((item) => (
          <SidebarLink key={item.path} item={item} onNavigate={onNavigate} />
        ))}
      </Nav>
    </div>
  );
}
