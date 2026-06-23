import type { ReactNode } from "react";

import { StatusPill } from "./StatusPill";

type SystemCheckCardProps = {
  title: string;
  system: string;
  required?: boolean;
  status: string;
  message: string;
  nextAction?: string | null;
  badgeLabel?: string;
  actions?: ReactNode;
  className?: string;
};

export function SystemCheckCard({
  title,
  system,
  required = true,
  status,
  message,
  nextAction,
  badgeLabel,
  actions,
  className,
}: SystemCheckCardProps) {
  return (
    <article className={`lss-system-check-card ${className ?? ""}`.trim()}>
      <div className="lss-system-check-card__head">
        <div>
          <div className="lss-system-check-card__title">{title}</div>
          <div className="lss-system-check-card__meta">{system}{required ? " · requerido" : " · opcional/futuro"}</div>
        </div>
        <StatusPill status={status} label={badgeLabel ?? status} />
      </div>
      <p className="lss-system-check-card__message">{message}</p>
      {nextAction ? <p className="lss-system-check-card__action">Acción: {nextAction}</p> : null}
      {actions}
    </article>
  );
}
