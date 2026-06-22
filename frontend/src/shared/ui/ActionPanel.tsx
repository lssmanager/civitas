import type { ReactNode } from "react";
import { Card } from "react-bootstrap";

type ActionPanelProps = { title?: string; description?: string; actions?: ReactNode; children?: ReactNode; className?: string };
export function ActionPanel({ title, description, actions, children, className }: ActionPanelProps) {
  return <Card className={`civitas-section-card ${className ?? ""}`.trim()}><Card.Body><div className="d-flex flex-column flex-md-row gap-2 justify-content-between align-items-md-start"> <div>{title ? <h3 className="h6 mb-1">{title}</h3> : null}{description ? <p className="text-secondary mb-0">{description}</p> : null}</div>{actions ? <div className="d-flex gap-2 flex-wrap">{actions}</div> : null}</div>{children ? <div className="mt-3">{children}</div> : null}</Card.Body></Card>;
}
