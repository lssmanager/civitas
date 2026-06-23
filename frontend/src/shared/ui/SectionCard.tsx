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
    <Card className={`civitas-section-card border-0 ${className ?? ""}`.trim()}>
      {hasHeader ? (
        <div className="civitas-section-card__head">
          <div className="civitas-section-card__title">
            {icon}
            {title ? <span>{title}</span> : null}
          </div>
          <div className="civitas-section-card__meta">
            {badge}
            {action}
          </div>
        </div>
      ) : null}
      <Card.Body className="civitas-section-card__body">
        {!hasHeader && title ? <h3 className="h6 mb-3">{title}</h3> : null}
        {children}
      </Card.Body>
    </Card>
  );
}
