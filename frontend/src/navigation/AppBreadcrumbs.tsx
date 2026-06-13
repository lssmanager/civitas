import { Breadcrumb } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";
import { routeMetadata } from "./routes";

export function AppBreadcrumbs() {
  const location = useLocation();
  const current = routeMetadata[location.pathname];

  return (
    <Breadcrumb className="civitas-breadcrumb mb-0">
      <Breadcrumb.Item linkAs={Link} linkProps={{ to: "/owner" }}>
        Civitas
      </Breadcrumb.Item>
      {current ? (
        <Breadcrumb.Item active>{current.label}</Breadcrumb.Item>
      ) : (
        <Breadcrumb.Item active>Vista local</Breadcrumb.Item>
      )}
    </Breadcrumb>
  );
}
