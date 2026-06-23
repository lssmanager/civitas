import "./OwnerSystemPage.css";

import { Button } from "react-bootstrap";
import { useOwnerApi, type OwnerIntegrationHealthCheck, type OwnerWorkerHealth } from "../api/owner";
import { useStableResource } from "../shared/hooks/useStableResource";
import { DataTable, ErrorState, LoadingState, PageShell, StatusBadge } from "../shared/ui";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

type StatusPillProps = { children: React.ReactNode; tone?: Tone; className?: string };

type SystemCardProps = { title: string; eyebrow?: string; children: React.ReactNode; className?: string; action?: React.ReactNode };

type MiniKpiProps = { label: string; value: React.ReactNode; meta: string; tone?: Tone };

type MetricBarProps = { label: string; value: number; text?: string; tone?: Tone };

const integrationTone = (check: OwnerIntegrationHealthCheck): Tone => {
  if (check.severity === "success") return "success";
  if (check.severity === "danger") return "danger";
  if (check.severity === "secondary") return "neutral";
  return "warning";
};

const statusTone = (status?: string): Tone => {
  if (["ok", "ready", "success", "healthy"].includes(status ?? "")) return "success";
  if (["error", "degraded", "failed", "down"].includes(status ?? "")) return "danger";
  if (["unknown", "attention", "pending_integration", "not_configured", "stale"].includes(status ?? "")) return "warning";
  return "neutral";
};

const formatCheckedAt = (value?: string | null) => (value ? new Date(value).toLocaleString() : "Sin dato");
const formatSeconds = (value: number) => (value > 60 ? `${Math.round(value / 60)}m` : `${value}s`);
const safePercent = (value: number) => Math.min(100, Math.max(0, value));

const buildGeneralStatus = (integrationsStatus?: string, readiness?: string) => {
  if (readiness === "ready" && integrationsStatus === "ok") return "ok";
  if (readiness === "degraded" || integrationsStatus === "degraded") return "degraded";
  if (integrationsStatus === "attention") return "attention";
  return readiness ?? integrationsStatus ?? "unknown";
};

function StatusPill({ children, tone = "neutral", className = "" }: StatusPillProps) {
  const badgeTone = tone === "info" ? "neutral" : tone;
  return (
    <StatusBadge tone={badgeTone} className={`owner-system-status-pill owner-system-status-pill--${tone} ${className}`}>
      {children}
    </StatusBadge>
  );
}

function SystemCard({ title, eyebrow, children, className = "", action }: SystemCardProps) {
  return (
    <section className={`owner-system-card ${className}`}>
      <div className="owner-system-card__header">
        <div>
          {eyebrow ? <div className="owner-system-card__eyebrow">{eyebrow}</div> : null}
          <h3>{title}</h3>
        </div>
        {action}
      </div>
      <div className="owner-system-card__body">{children}</div>
    </section>
  );
}

function MiniKpi({ label, value, meta, tone = "neutral" }: MiniKpiProps) {
  return (
    <SystemCard title={label} className={`mini-kpi mini-kpi--${tone}`}>
      <div className="mini-kpi__value">{value}</div>
      <div className="mini-kpi__meta">{meta}</div>
    </SystemCard>
  );
}

function MetricBar({ label, value, text, tone = "info" }: MetricBarProps) {
  return (
    <div className="metric-bar">
      <div className="metric-bar__label"><span>{label}</span><strong>{text ?? `${value}%`}</strong></div>
      <div className="metric-bar__track"><span className={`metric-bar__fill metric-bar__fill--${tone}`} style={{ width: `${safePercent(value)}%` }} /></div>
    </div>
  );
}

const wantedSystems = ["Redis / BullMQ", "Logto Management API", "FluentCRM", "WordPress", "Moodle"];

const orderedChecks = (checks: OwnerIntegrationHealthCheck[]) =>
  [...checks].sort((a, b) => {
    const ai = wantedSystems.findIndex((name) => a.label.includes(name) || a.system.includes(name) || a.key.toLowerCase().includes(name.toLowerCase().split(" ")[0]));
    const bi = wantedSystems.findIndex((name) => b.label.includes(name) || b.system.includes(name) || b.key.toLowerCase().includes(name.toLowerCase().split(" ")[0]));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

const queueTotals = (workerHealth?: OwnerWorkerHealth) =>
  workerHealth?.queues.reduce(
    (total, queue) => ({ activeBacklog: total.activeBacklog + queue.waiting + queue.active + queue.delayed, failed: total.failed + queue.failed }),
    { activeBacklog: 0, failed: 0 }
  ) ?? { activeBacklog: 0, failed: 0 };

export function OwnerSystemPage() {
  const ownerApi = useOwnerApi();
  const workerResource = useStableResource({ load: ownerApi.getWorkerHealth, getKey: () => "owner-worker-health", initialParams: undefined });
  const integrationsResource = useStableResource({ load: ownerApi.getIntegrationsHealth, getKey: () => "owner-integrations-health", initialParams: undefined });
  const retryAll = () => { workerResource.retry(); integrationsResource.retry(); };

  const workerHealth = workerResource.data;
  const integrationsHealth = integrationsResource.data;
  const requiredChecks = integrationsHealth?.checks.filter((check) => check.required !== false).length ?? 0;
  const okRequiredChecks = integrationsHealth?.checks.filter((check) => check.required !== false && ["ok", "ready", "configured"].includes(check.status)).length ?? 0;
  const generalStatus = buildGeneralStatus(integrationsHealth?.status, workerHealth?.readiness);
  const totals = queueTotals(workerHealth);
  const redisOk = workerHealth?.redis.status === "ok";
  const lastReview = formatCheckedAt(integrationsHealth?.checkedAt ?? workerHealth?.worker.heartbeatAt);

  return (
    <PageShell eyebrow="Owner / sistema" title="System KPI" description="Dashboard operativo compacto para Redis, BullMQ, worker e integraciones críticas." className="owner-system-page">
      {workerResource.isLoading || integrationsResource.isLoading ? <LoadingState title="Cargando salud técnica" description="Consultando worker, colas e integraciones." /> : null}
      {workerResource.error ? <ErrorState title="No se pudo cargar worker health" message={workerResource.error} action={<Button onClick={workerResource.retry}>Reintentar worker</Button>} /> : null}
      {integrationsResource.error ? <ErrorState title="No se pudieron cargar integraciones" message={integrationsResource.error} action={<Button onClick={integrationsResource.retry}>Reintentar integraciones</Button>} /> : null}

      <div className="owner-system-dashboard">
        <div className="owner-system-topbar">
          <div><h1>Civitas — System KPI Dashboard</h1><p>civitas.socialstudies.cloud · owner/system · última revisión {lastReview}</p></div>
          <div className="owner-system-topbar__actions"><StatusPill tone={statusTone(generalStatus)}>Estado general: {generalStatus}</StatusPill><Button size="sm" variant="outline-primary" onClick={retryAll}>Refresh</Button><Button size="sm" variant="primary" onClick={retryAll}>Revisar todo</Button></div>
        </div>

        <div className={`owner-system-alert owner-system-alert--${redisOk ? "ok" : "warn"}`}><strong>Redis / BullMQ:</strong> {redisOk ? "conectado y listo para coordinar jobs." : `requiere atención (${workerHealth?.redis.status ?? "unknown"}).`} <span>Los timeouts cortos protegen el panel owner.</span></div>

        <section className="owner-system-section"><div className="owner-system-section__title"><h2>Resumen general</h2><span>datos reales de health endpoints</span></div><div className="kpi-grid">
          <MiniKpi label="Servicios ok" value={`${okRequiredChecks}/${requiredChecks}`} meta="checks requeridos saludables" tone={okRequiredChecks === requiredChecks && requiredChecks > 0 ? "success" : "warning"} />
          <MiniKpi label="Worker heartbeat" value={workerHealth?.worker.heartbeatStale ? "stale" : "ok"} meta={`último: ${formatCheckedAt(workerHealth?.worker.heartbeatAt)}`} tone={workerHealth?.worker.heartbeatStale ? "warning" : "success"} />
          <MiniKpi label="Colas activas" value={totals.activeBacklog} meta={`${totals.failed} failed · waiting + active + delayed`} tone={totals.failed > 0 ? "warning" : "info"} />
          <MiniKpi label="Readiness" value={workerHealth?.readiness ?? "unknown"} meta="workerHealth.readiness" tone={statusTone(workerHealth?.readiness)} />
        </div></section>

        <section className="owner-system-section"><div className="owner-system-section__title"><h2>Integration checks & Redis config</h2><span>integraciones requeridas y opcionales</span></div><div className="grid-2">
          <SystemCard title="Integration checks" eyebrow="real-time checks">
            <div className="integration-list">{orderedChecks(integrationsHealth?.checks ?? []).map((check) => <article className="integration-row" key={check.key}><div><div className="integration-row__title"><strong>{check.label}</strong><StatusPill tone={integrationTone(check)}>{check.status}</StatusPill></div><p>{check.system} · {check.required === false ? "opcional / futuro" : "required"}</p><small>{check.message}</small>{check.nextAction ? <em>Next action: {check.nextAction}</em> : null}</div></article>)}</div>
          </SystemCard>
          <div className="owner-system-stack"><SystemCard title="Redis 8.8.0 — configuración" eyebrow="prepared runtime contract"><div className="config-grid"><span>Connection Timeout</span><strong>1s</strong><span>Read Timeout</span><strong>1s</strong><span>Redis Version</span><strong>8.8.0</strong><span>Queue Driver</span><strong>BullMQ</strong><span>Estado real</span><StatusPill tone={statusTone(workerHealth?.redis.status)}>{workerHealth?.redis.status ?? "unknown"}</StatusPill></div></SystemCard>
          <SystemCard title="BullMQ — estado de colas" eyebrow="workerHealth.queues"><DataTable rows={workerHealth?.queues ?? []} getRowKey={(row) => row.name} columns={[{ key: "name", header: "Cola", render: (row) => row.name },{ key: "waiting", header: "Waiting", render: (row) => row.waiting },{ key: "active", header: "Active", render: (row) => row.active },{ key: "delayed", header: "Delayed", render: (row) => row.delayed },{ key: "failed", header: "Failed", render: (row) => row.failed },{ key: "oldest", header: "Oldest", render: (row) => formatSeconds(row.oldestJobAgeSeconds) }]} /></SystemCard></div>
        </div></section>

        <section className="owner-system-section"><div className="owner-system-section__title"><h2>Cache analytics — prefetching & performance</h2><span>preparado para instrumentación</span></div><div className="grid-3">
          <SystemCard title="Hit / Miss ratio" action={<StatusPill tone="info">propuesto</StatusPill>}><div className="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="44"/><path d="M60 16a44 44 0 1 1-38 22"/></svg><strong>not instrumented</strong></div><MetricBar label="Prefetch hit" value={68} tone="success" text="propuesto"/><MetricBar label="Cold miss" value={22} tone="warning" text="pendiente"/><MetricBar label="Stale" value={10} tone="danger" text="pendiente"/><p className="placeholder-note">Hits, Cold miss y Stale quedan visibles como contrato operativo, no como datos reales.</p></SystemCard>
          <SystemCard title="Latencia & timing" action={<StatusPill tone="warning">pendiente</StatusPill>}><div className="latency-grid"><div><strong>avg</strong><span>not instrumented</span></div><div><strong>p95</strong><span>not instrumented</span></div><div><strong>p99</strong><span>not instrumented</span></div></div><MetricBar label="GET" value={54}/><MetricBar label="SET" value={42}/><MetricBar label="SCAN" value={24}/><MetricBar label="EXPIRE" value={34}/></SystemCard>
          <SystemCard title="Bytes & serialización" action={<StatusPill tone="info">propuesto</StatusPill>}><div className="bytes-callout"><strong>Ratio</strong><span>not instrumented</span></div><div className="config-grid compact"><span>Avg key size</span><strong>pendiente</strong><span>Raw vs Compressed</span><strong>preparado</strong></div><p className="placeholder-note">Faster serialization and compression: bloque listo para métricas de payload.</p></SystemCard>
        </div></section>

        <section className="owner-system-section"><div className="owner-system-section__title"><h2>Calls & throughput — BullMQ + Redis</h2><span>métricas propuestas hasta exponer backend</span></div><div className="grid-2">
          <SystemCard title="Calls / min — últimos 8 puntos" action={<StatusPill tone="info">not instrumented</StatusPill>}><div className="spark-bars">{[28, 46, 36, 62, 54, 78, 48, 66].map((v, i) => <span key={i} style={{ height: `${v}%` }} />)}</div><div className="throughput-table"><div><b>GET</b><span>propuesto</span></div><div><b>SET</b><span>propuesto</span></div><div><b>DEL</b><span>propuesto</span></div><div><b>EXPIRE</b><span>propuesto</span></div></div></SystemCard>
          <SystemCard title="Debug & logging" action={<StatusPill tone="success">Easy debugging & logging</StatusPill>}><div className="debug-table">{[["Redis ops","DEBUG"],["BullMQ jobs","INFO"],["REDIS_STATUS",redisOk ? "INFO" : "WARN"],["Slow queries","WARN"],["Failed jobs",totals.failed > 0 ? "ERROR" : "INFO"]].map(([name, level]) => <div key={name}><span>{name}</span><StatusPill tone={level === "ERROR" ? "danger" : level === "WARN" ? "warning" : "neutral"}>{level}</StatusPill></div>)}</div></SystemCard>
        </div></section>

        <section className="owner-system-section"><div className="owner-system-section__title"><h2>Expansión propuesta</h2><span>placeholders operativos claramente etiquetados</span></div><div className="expansion-grid">{["Redis memory","TTL distribution","Retry rate","Throughput 24h","Por organización","Alertas"].map((title) => <SystemCard key={title} title={title} action={<StatusPill tone="info">propuesto</StatusPill>}><p className="placeholder-note">Preparado para instrumentación: {title.toLowerCase()} con series históricas y umbrales owner.</p></SystemCard>)}</div></section>
      </div>
    </PageShell>
  );
}
