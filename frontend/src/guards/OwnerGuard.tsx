import { useEffect, useState } from "react";
import { Badge, Button } from "react-bootstrap";
import { ApiRequestError } from "../api/base";
import { type OwnerMeResponse, useOwnerApi } from "../api/owner";
import { isLogtoAuthEnabled } from "../authConfig";
import { ErrorState, LoadingState, PageCard, PageShell } from "../shared/ui";

type OwnerGuardProps = {
  children: (ownerMe: OwnerMeResponse) => React.ReactNode;
};

const devOwnerMe: OwnerMeResponse = {
  owner: {
    id: "dev-owner",
    logtoUserId: "dev-logto-owner",
    email: "owner@civitas.local",
    status: "active",
    globalRole: "owner_global",
    lastLoginAt: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  authScopes: ["owner:read", "organizations:read", "organizations:create"],
  ownerAuthorizedBy: "logto_scope",
  scope: {
    organizations: true,
    memberships: false,
    rbac: false,
  },
};

function getOwnerError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) {
      return {
        title: "Sesión requerida",
        message: "No pudimos validar tu sesión. Inicia sesión de nuevo para entrar al portal owner.",
      };
    }

    if (error.status === 403) {
      return {
        title: "Sin permisos owner",
        message: "Tu sesión está autenticada, pero el access token de Logto no contiene el scope owner:read.",
      };
    }
  }

  return {
    title: "No se pudo validar el rol owner",
    message: error instanceof Error ? error.message : "Intenta nuevamente o contacta al administrador.",
  };
}

export function OwnerGuard({ children }: OwnerGuardProps) {
  const { getOwnerMe } = useOwnerApi();
  const [ownerMe, setOwnerMe] = useState<OwnerMeResponse>();
  const [error, setError] = useState<{ title: string; message: string }>();
  const [isLoading, setIsLoading] = useState(isLogtoAuthEnabled);

  useEffect(() => {
    let isMounted = true;

    async function loadOwner() {
      if (!isLogtoAuthEnabled) {
        setOwnerMe(devOwnerMe);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(undefined);

      try {
        const response = await getOwnerMe();
        if (isMounted) {
          setOwnerMe(response);
        }
      } catch (loadError) {
        if (isMounted) {
          setOwnerMe(undefined);
          setError(getOwnerError(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadOwner();

    return () => {
      isMounted = false;
    };
  }, [getOwnerMe]);

  if (isLoading) {
    return (
      <PageShell eyebrow="Owner" title="Validando permisos owner" description="Comprobando scopes globales de Logto.">
        <PageCard title="Guard owner">
          <LoadingState title="Validando owner_global" description="Estamos consultando /owner/me y validando el scope owner:read." />
        </PageCard>
      </PageShell>
    );
  }

  if (error || !ownerMe) {
    return (
      <PageShell eyebrow="Owner" title="Acceso denegado" description="El portal owner requiere scopes globales de Logto." actions={<Badge bg="danger">403</Badge>}>
        <PageCard title="Permisos insuficientes">
          <ErrorState
            title={error?.title ?? "Sin permisos owner"}
            message={error?.message ?? "Tu usuario no tiene acceso al portal owner."}
            action={<Button href="/account" variant="outline-primary">Ver mi cuenta</Button>}
          />
        </PageCard>
      </PageShell>
    );
  }

  return <>{children(ownerMe)}</>;
}
