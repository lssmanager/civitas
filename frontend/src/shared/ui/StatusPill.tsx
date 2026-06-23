type StatusPillStatus =
  | "ok"
  | "ready"
  | "warn"
  | "warning"
  | "error"
  | "danger"
  | "unknown"
  | "not_configured"
  | "neutral"
  | "info"
  | "primary";

type StatusPillProps = {
  status: StatusPillStatus | string;
  label?: string;
  className?: string;
};

const statusToVariant: Record<string, string> = {
  ok: "success",
  ready: "success",
  warn: "warning",
  warning: "warning",
  error: "danger",
  danger: "danger",
  unknown: "neutral",
  not_configured: "neutral",
  neutral: "neutral",
  info: "info",
  primary: "primary",
};

export function StatusPill({ status, label, className }: StatusPillProps) {
  const variant = statusToVariant[status] ?? "neutral";
  return <span className={`lss-pill lss-pill-${variant} ${className ?? ""}`.trim()}>{label ?? status}</span>;
}
