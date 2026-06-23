import type { ReactNode } from "react";

type MetricCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "primary" | "success" | "warning" | "danger";
  delta?: string;
  deltaType?: "success" | "warning" | "danger" | "neutral";
  icon?: ReactNode;
  className?: string;
};

export function MetricCard({
  label,
  value,
  hint,
  tone = "primary",
  delta,
  deltaType = "neutral",
  icon,
  className,
}: MetricCardProps) {
  return (
    <div className={`civitas-kpi-card civitas-metric-card civitas-metric-card--${tone} ${className ?? ""}`.trim()}>
      <div className="civitas-kpi-card__label civitas-metric-card__label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="civitas-kpi-card__value civitas-metric-card__value">{value}</div>
      {delta ? <div className={`civitas-kpi-card__delta civitas-kpi-card__delta--${deltaType}`}>{delta}</div> : null}
      {hint ? <p className="civitas-kpi-card__hint civitas-metric-card__hint mb-0">{hint}</p> : null}
    </div>
  );
}
