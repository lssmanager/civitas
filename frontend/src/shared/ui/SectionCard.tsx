import type { ReactNode } from "react";
import { Card } from "react-bootstrap";

type SectionCardProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

export function SectionCard({ title, children, className }: SectionCardProps) {
  return (
    <Card className={`civitas-section-card border-0 ${className ?? ""}`.trim()}>
      <Card.Body>
        {title ? <h3 className="h6 mb-3">{title}</h3> : null}
        {children}
      </Card.Body>
    </Card>
  );
}
