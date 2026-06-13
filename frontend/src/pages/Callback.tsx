import { useHandleSignInCallback } from '@logto/react';
import { Alert, Spinner } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { APP_ENV } from '../env';
import { isLogtoAuthEnabled } from '../authConfig';

function LogtoCallback() {
  const navigate = useNavigate();
  const { isLoading } = useHandleSignInCallback(() => {
    navigate('/');
  });

  if (isLoading) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
        <div className="d-flex align-items-center gap-3 text-secondary">
          <Spinner animation="border" size="sm" />
          <span>Completando inicio de sesión...</span>
        </div>
      </div>
    );
  }

  return null;
}

export default function Callback() {
  if (!APP_ENV.auth.logtoEnabled) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light px-3">
        <Alert variant="info" className="mb-0">
          Logto está desactivado localmente. Activa VITE_ENABLE_LOGTO=true para usar /callback.
        </Alert>
      </div>
    );
  }

  if (!isLogtoAuthEnabled) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light px-3">
        <Alert variant="warning" className="mb-0">
          Configuración de Logto incompleta. Revisa VITE_LOGTO_ENDPOINT y VITE_LOGTO_APP_ID.
        </Alert>
      </div>
    );
  }

  return <LogtoCallback />;
}
