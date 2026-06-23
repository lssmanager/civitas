import type { ReactNode } from "react";

type KpiGridProps = {
  children: ReactNode;
  className?: string;
};

export function KpiGrid({ children, className }: KpiGridProps) {
  return <div className={`civitas-kpi-grid ${className ?? ""}`.trim()}>{children}</div>;
}
