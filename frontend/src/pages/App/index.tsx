import {
  LogtoProvider,
  LogtoConfig,
  useLogto,
  UserScope,
  ReservedResource,
} from "@logto/react";
import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Landing from "./Landing";
import Dashboard from "./Dashboard";
import Callback from "../Callback";
import OrganizationPage from "../OrganizationPage";
import { APP_ENV } from "../../env";

const config: LogtoConfig = {
  endpoint: APP_ENV.logto.endpoint,
  appId: APP_ENV.logto.appId,
  scopes: [UserScope.Organizations, "read:documents", "create:documents", "create:organization"],
  resources: [ReservedResource.Organization, APP_ENV.api.resourceIndicator],
};

type HealthPayload = {
  status: string;
  service: string;
  timestamp: string;
  database?: {
    status: string;
  };
};

function App() {
  if (!APP_ENV.auth.logtoEnabled) {
    return <LocalBaseApp />;
  }

  return (
    <LogtoProvider config={config}>
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
        <Routes>
          <Route path="/callback" element={<Callback />} />
          <Route path="/*" element={<AuthenticatedAppContent />} />
        </Routes>
      </div>
    </LogtoProvider>
  );
}

function LocalBaseApp() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${APP_ENV.api.baseUrl}/health`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.database?.error ?? `Healthcheck failed with ${response.status}`);
        }

        setHealth(payload);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        setError(requestError instanceof Error ? requestError.message : String(requestError));
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 px-6 py-12">
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-blue-600">
          Civitas Nivel 0
        </p>
        <h1 className="mb-4 text-4xl font-bold text-slate-900">
          Base técnica local verificable
        </h1>
        <p className="mb-8 text-lg text-slate-600">
          Frontend React conectado al backend Node/Express local. La autenticación y organizaciones heredadas del sample Logto quedan desactivadas para este flujo base.
        </p>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="mb-3 text-xl font-semibold text-slate-900">GET /health</h2>
          {health ? (
            <dl className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-500">API</dt>
                <dd className="font-semibold text-green-700">{health.status}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Servicio</dt>
                <dd>{health.service}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">PostgreSQL</dt>
                <dd>{health.database?.status ?? "sin reporte"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Timestamp</dt>
                <dd>{health.timestamp}</dd>
              </div>
            </dl>
          ) : error ? (
            <p className="text-sm text-red-700">No se pudo verificar el backend: {error}</p>
          ) : (
            <p className="text-sm text-slate-600">Verificando backend local...</p>
          )}
        </div>
      </section>
    </main>
  );
}

function AuthenticatedAppContent() {
  const { isAuthenticated } = useLogto();

  if (!isAuthenticated) {
    return <Landing />;
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/:orgId" element={<OrganizationPage />} />
    </Routes>
  );
}

export default App;
