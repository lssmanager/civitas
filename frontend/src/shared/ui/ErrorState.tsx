import type { ReactNode } from "react";
import { Alert } from "react-bootstrap";

type ErrorStateProps = {
  title?: string;
  message: string;
  action?: ReactNode;
};

export function ErrorState({ title = "No se pudo completar la acción", message, action }: ErrorStateProps) {
  return (
    <Alert variant="danger" className="civitas-state mb-0">
      <Alert.Heading className="h5">{title}</Alert.Heading>
      <p className="mb-3">{message}</p>
      {action}
    </Alert>
  );
}
