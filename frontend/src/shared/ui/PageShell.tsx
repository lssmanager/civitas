import type { ReactNode } from "react";

type PageShellProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function PageShell({ title, eyebrow, description, actions, children }: PageShellProps) {
  return (
    <div className="d-flex flex-column gap-4">
      <header className="d-flex flex-column flex-lg-row gap-3 justify-content-between align-items-lg-start">
        <div>
          {eyebrow && <p className="text-uppercase fw-semibold text-primary small mb-2">{eyebrow}</p>}
          <h1 className="display-6 fw-semibold mb-2">{title}</h1>
          {description && <p className="lead text-secondary mb-0">{description}</p>}
        </div>
        {actions && <div className="d-flex gap-2 flex-wrap">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
