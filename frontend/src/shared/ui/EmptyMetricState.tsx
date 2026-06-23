type EmptyMetricStateProps = {
  title: string;
  description: string;
  note?: string;
  className?: string;
};

export function EmptyMetricState({ title, description, note, className }: EmptyMetricStateProps) {
  return (
    <div className={`civitas-empty-metric-state ${className ?? ""}`.trim()}>
      <div className="civitas-empty-metric-state__title">{title}</div>
      <div className="civitas-empty-metric-state__description">{description}</div>
      {note ? <div className="civitas-empty-metric-state__note">{note}</div> : null}
    </div>
  );
}
