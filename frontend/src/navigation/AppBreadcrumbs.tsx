import { Breadcrumb } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";
import { routeMetadata, routePatterns, type RouteMetadata } from "./routes";

const getRouteMetadata = (pathname: string): RouteMetadata | undefined =>
  routeMetadata[pathname] ?? routePatterns.find((routePattern) => routePattern.pattern.test(pathname))?.metadata;

const buildTrail = (pathname: string) => {
  const trail: { path: string; label: string }[] = [];
  let currentPath: string | undefined = pathname;
  const visited = new Set<string>();

  while (currentPath && !visited.has(currentPath)) {
    visited.add(currentPath);
    const current = getRouteMetadata(currentPath);
    if (!current) break;
    trail.unshift({ path: currentPath, label: current.label });
    currentPath = current.parentPath;
  }

  return trail;
};

export function AppBreadcrumbs() {
  const location = useLocation();
  const trail = buildTrail(location.pathname);

  return (
    <Breadcrumb className="civitas-breadcrumb mb-0">
      <Breadcrumb.Item
        className="civitas-breadcrumb__item civitas-breadcrumb__item--brand"
        linkAs={Link}
        linkProps={{ to: "/owner" }}
      >
        Civitas
      </Breadcrumb.Item>
      {trail.length > 0 ? (
        trail.map((item, index) => {
          const isLast = index === trail.length - 1;
          return isLast ? (
            <Breadcrumb.Item className="civitas-breadcrumb__item civitas-breadcrumb__item--current" active key={item.path}>
              {item.label}
            </Breadcrumb.Item>
          ) : (
            <Breadcrumb.Item
              className="civitas-breadcrumb__item"
              linkAs={Link}
              linkProps={{ to: item.path }}
              key={item.path}
            >
              {item.label}
            </Breadcrumb.Item>
          );
        })
      ) : (
        <Breadcrumb.Item className="civitas-breadcrumb__item civitas-breadcrumb__item--current" active>
          Vista local
        </Breadcrumb.Item>
      )}
    </Breadcrumb>
  );
}
