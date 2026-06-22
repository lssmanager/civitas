import { Alert, Button, Card } from "react-bootstrap";
import { APP_ENV } from "../../env";

type AuthRequiredStateProps = {
  title?: string;
  message?: string;
  onSignIn?: () => void;
  isLoading?: boolean;
};

export function AuthRequiredState({
  title = "Autenticación requerida",
  message = "Inicia sesión con Logto para acceder a esta sección privada de Civitas.",
  onSignIn,
  isLoading = false,
}: AuthRequiredStateProps) {
  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center civitas-auth-state px-3">
      <Card className="border-0 shadow-sm civitas-auth-card">
        <Card.Body className="p-4 p-md-5">
          <Alert variant="warning" className="mb-4">
            <Alert.Heading className="h5">{title}</Alert.Heading>
            <p className="mb-0">{message}</p>
          </Alert>
          {onSignIn ? (
            <Button disabled={isLoading} onClick={onSignIn}>
              {isLoading ? "Preparando inicio de sesión..." : "Iniciar sesión"}
            </Button>
          ) : null}
          {!APP_ENV.auth.logtoEnabled ? (
            <p className="text-secondary small mb-0">
              Logto está desactivado en desarrollo local (VITE_ENABLE_LOGTO=false), por lo que la UI mock sigue disponible.
            </p>
          ) : null}
        </Card.Body>
      </Card>
    </div>
  );
}
