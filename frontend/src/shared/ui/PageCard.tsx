import type { ReactNode } from "react";
import { Card } from "react-bootstrap";

type PageCardProps = {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function PageCard({ title, subtitle, actions, children, className }: PageCardProps) {
  return (
    <Card className={`civitas-card border-0 shadow-sm ${className ?? ""}`.trim()}>
      {(title || subtitle || actions) && (
        <Card.Header className="bg-white border-0 pb-0">
          <div className="d-flex flex-column flex-md-row gap-3 justify-content-between align-items-md-start">
            <div>
              {title && <h2 className="h5 mb-1">{title}</h2>}
              {subtitle && <p className="text-secondary mb-0">{subtitle}</p>}
            </div>
            {actions && <div className="d-flex gap-2 flex-wrap">{actions}</div>}
          </div>
        </Card.Header>
      )}
      <Card.Body>{children}</Card.Body>
    </Card>
  );
}
