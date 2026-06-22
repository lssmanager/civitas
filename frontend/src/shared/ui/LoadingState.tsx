import { Spinner } from "react-bootstrap";

type LoadingStateProps = {
  title?: string;
  description?: string;
};

export function LoadingState({
  title = "Cargando vista mock",
  description = "Preparando contenido local sin consumir servicios externos.",
}: LoadingStateProps) {
  return (
    <div className="civitas-state text-center p-4 p-md-5 rounded-4 border">
      <Spinner animation="border" role="status" className="mb-3">
        <span className="visually-hidden">Cargando...</span>
      </Spinner>
      <h2 className="h5 mb-2">{title}</h2>
      <p className="text-secondary mb-0">{description}</p>
    </div>
  );
}
