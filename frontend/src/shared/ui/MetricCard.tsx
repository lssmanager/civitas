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
    <div className={`lss-metric-card civitas-metric-card civitas-metric-card--${tone} ${className ?? ""}`.trim()}>
      <div className="lss-metric-label civitas-metric-card__label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="lss-metric-value civitas-metric-card__value">{value}</div>
      {delta ? <div className={`lss-metric-delta lss-delta-${deltaType}`}>{delta}</div> : null}
      {hint ? <p className="lss-metric-hint civitas-metric-card__hint mb-0">{hint}</p> : null}
    </div>
  );
}
