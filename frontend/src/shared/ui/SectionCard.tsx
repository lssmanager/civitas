import type { ReactNode } from "react";
import { Card } from "react-bootstrap";

type SectionCardProps = {
  title?: string;
  icon?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function SectionCard({ title, icon, badge, action, children, className }: SectionCardProps) {
  const hasHeader = Boolean(title || icon || badge || action);

  return (
    <Card className={`lss-section-card civitas-section-card border-0 ${className ?? ""}`.trim()}>
      {hasHeader ? (
        <div className="lss-section-card-head">
          <div className="lss-section-card-title">
            {icon}
            {title ? <span>{title}</span> : null}
          </div>
          <div className="lss-section-card-meta">
            {badge}
            {action}
          </div>
        </div>
      ) : null}
      <Card.Body className="lss-section-card-body">
        {!hasHeader && title ? <h3 className="h6 mb-3">{title}</h3> : null}
        {children}
      </Card.Body>
    </Card>
  );
}
