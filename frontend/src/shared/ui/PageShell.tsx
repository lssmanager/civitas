import type { ReactNode } from "react";

type PageShellProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function PageShell({
  title,
  eyebrow,
  description,
  actions,
  children,
  className,
}: PageShellProps) {
  return (
    <div className={`civitas-page-shell d-flex flex-column gap-4 ${className ?? ""}`.trim()}>
      <header className="civitas-page-shell__header d-flex flex-column flex-xl-row gap-4 justify-content-between align-items-xl-start">
        <div className="civitas-page-shell__copy">
          {eyebrow && (
            <p className="civitas-page-shell__eyebrow text-uppercase fw-semibold small mb-2">
              {eyebrow}
            </p>
          )}
          <h1 className="civitas-page-shell__title display-6 fw-semibold mb-2">{title}</h1>
          {description && (
            <p className="civitas-page-shell__description lead mb-0">{description}</p>
          )}
        </div>
        {actions && <div className="civitas-page-shell__actions d-flex gap-2 flex-wrap">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
