import type { ReactNode } from "react";
import { Badge } from "react-bootstrap";

type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

type StatusBadgeProps = { children: ReactNode; tone?: StatusTone; className?: string };

export function StatusBadge({ children, tone = "neutral", className }: StatusBadgeProps) {
  return <Badge className={`civitas-status-badge civitas-status-badge--${tone} ${className ?? ""}`.trim()}>{children}</Badge>;
}
