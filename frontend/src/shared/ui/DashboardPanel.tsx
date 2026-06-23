import type { ReactNode } from "react";

type DashboardPanelProps = {
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function DashboardPanel({ title, icon, badge, action, children, className }: DashboardPanelProps) {
  return (
    <section className={`civitas-dashboard-panel ${className ?? ""}`.trim()}>
      <div className="civitas-dashboard-panel__head">
        <div className="civitas-dashboard-panel__title">
          {icon}
          <span>{title}</span>
        </div>
        <div className="civitas-dashboard-panel__meta">
          {badge}
          {action}
        </div>
      </div>
      <div className="civitas-dashboard-panel__body">{children}</div>
    </section>
  );
}
