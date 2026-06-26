import { Accordion, Nav } from "react-bootstrap";
import { NavLink, useLocation } from "react-router-dom";
import { menuCapabilities } from "../authz/navigationPolicy";
import { deriveAuthorizationCapabilities } from "../authz/capabilities";
import { useSession } from "../session/sessionContext";
import { useSiteLogo } from "../shared/hooks/useSiteLogo";
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
  const logoUrl = useSiteLogo();

  return (
    <div className="civitas-sidebar__brand px-4 py-4 border-bottom">
      <div className="d-flex align-items-center gap-2">
        <img
          className="civitas-sidebar__logo-mark"
          src={logoUrl}
          alt="Learn Social Studies"
        />
        <div className="civitas-sidebar__logo civitas-sidebar__logo--full">
          <span className="fw-bold">Civitas</span>
        </div>
      </div>
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
  const { me } = useSession();
  const capabilities = deriveAuthorizationCapabilities(me);
  const isVisible = (item: AppRoute) => {
    const capability = menuCapabilities[item.path];
    return capability ? capabilities[capability] : false;
  };
  const rootRoute = ownerNavigationTree[0] && isVisible(ownerNavigationTree[0]) ? ownerNavigationTree[0] : undefined;
  const sectionRoutes = ownerNavigationTree.slice(1).map((item) => ({ ...item, children: item.children?.filter(isVisible) })).filter((item) => !item.children || item.children.length > 0);
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
          <p className="mb-1 fw-semibold civitas-sidebar__panel-title">Owner</p>
        </div>
        {rootRoute ? <SidebarLink item={rootRoute} onNavigate={onNavigate} /> : null}
        <Accordion defaultActiveKey={activeOwnerSections} alwaysOpen>
          {sectionRoutes.map((item, index) => (
            <NavigationBranch key={item.path} item={item} index={index} onNavigate={onNavigate} />
          ))}
        </Accordion>
      </Nav>
      <Nav className="flex-column gap-2 civitas-sidebar__panel civitas-sidebar__panel--secondary mt-auto" as="nav">
        {primaryNavigation.filter(isVisible).map((item) => (
          <SidebarLink key={item.path} item={item} onNavigate={onNavigate} />
        ))}
      </Nav>
    </div>
  );
}
