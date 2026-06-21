type MetricCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "primary" | "success" | "warning" | "danger";
};

export function MetricCard({
  label,
  value,
  hint,
  tone = "primary",
}: MetricCardProps) {
  return (
    <div className={`civitas-metric-card civitas-metric-card--${tone}`}>
      <p className="civitas-metric-card__label mb-1">{label}</p>
      <p className="civitas-metric-card__value mb-0">{value}</p>
      {hint ? <p className="civitas-metric-card__hint mb-0">{hint}</p> : null}
    </div>
  );
}
