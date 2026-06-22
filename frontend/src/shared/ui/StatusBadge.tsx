import { Badge } from "react-bootstrap";

type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: StatusTone;
  className?: string;
};

const toneToBg: Record<StatusTone, string> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  neutral: "secondary",
  primary: "primary",
};

export function StatusBadge({ children, tone = "neutral", className }: StatusBadgeProps) {
  return (
    <Badge bg={toneToBg[tone]} className={`civitas-status-badge civitas-status-badge--${tone} ${className ?? ""}`.trim()}>
      {children}
    </Badge>
  );
}
