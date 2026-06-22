import type { ReactNode } from "react";
import { Alert } from "react-bootstrap";

type RenewalAlertProps = { title?: string; children: ReactNode; action?: ReactNode; className?: string };
export function RenewalAlert({ title = "Atención requerida", children, action, className }: RenewalAlertProps) {
  return <Alert variant="warning" className={`d-flex flex-column flex-md-row gap-2 justify-content-between align-items-md-center ${className ?? ""}`.trim()}><div>{title ? <Alert.Heading className="h6 mb-1">{title}</Alert.Heading> : null}<div className="small">{children}</div></div>{action}</Alert>;
}
