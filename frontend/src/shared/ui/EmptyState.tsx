import type { ReactNode } from "react";
import { Button } from "react-bootstrap";

type EmptyStateProps = {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
};

export function EmptyState({ title, description, actionLabel, onAction, icon }: EmptyStateProps) {
  return (
    <div className="civitas-state text-center p-4 p-md-5 rounded-4 border bg-light">
      <div className="civitas-state-icon mx-auto mb-3" aria-hidden="true">
        {icon ?? "∅"}
      </div>
      <h2 className="h5 mb-2">{title}</h2>
      {description && <p className="text-secondary mb-3">{description}</p>}
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
