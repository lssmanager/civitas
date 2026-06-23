import "./OwnerSystemPage.css";

import type { ReactNode } from "react";
import { Button } from "react-bootstrap";
import { useOwnerApi, type OwnerIntegrationHealthCheck, type OwnerSystemMetric, type OwnerWorkerHealth } from "../api/owner";
import { useStableResource } from "../shared/hooks/useStableResource";
import { DataTable, ErrorState, LoadingState, PageShell, StatusBadge } from "../shared/ui";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

type StatusPillProps = { children: ReactNode; tone?: Tone; className?: string };

type SystemCardProps = { title: string; eyebrow?: string; children: ReactNode; className?: string; action?: ReactNode; icon?: string };

type MiniKpiProps = { label: string; value: ReactNode; meta: string; tone?: Tone };

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

function SystemCard({ title, eyebrow, children, className = "", action, icon }: SystemCardProps) {
  return (
    <section className={`owner-system-card ${className}`}>
      <div className="owner-system-card__header">
        <div>
          {eyebrow ? <div className="owner-system-card__eyebrow">{eyebrow}</div> : null}
          <h3>{icon ? <span className="owner-system-card__icon">{icon}</span> : null}{title}</h3>
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


const metricTone = (metric?: OwnerSystemMetric): Tone => {
  if (!metric) return "neutral";
  if (["live", "derived"].includes(metric.instrumentationStatus)) return "success";
  if (["sampled", "proposed"].includes(metric.instrumentationStatus)) return "info";
  return "warning";
};

const formatMetricValue = (metric?: OwnerSystemMetric) => {
  if (!metric || metric.value === null || metric.value === undefined || metric.value === "") return metric?.instrumentationStatus ?? "sin dato";
  const suffix = metric.unit && metric.unit !== "count" ? ` ${metric.unit}` : "";
  return `${metric.value}${suffix}`;
};

const metricPercent = (metric?: OwnerSystemMetric) => typeof metric?.value === "number" && Number.isFinite(metric.value) ? safePercent(metric.value) : 0;

function MetricStatus({ metric }: { metric?: OwnerSystemMetric }) {
  return <StatusPill tone={metricTone(metric)}>{metric?.instrumentationStatus ?? "unknown"}</StatusPill>;
}

function MetricNote({ metric }: { metric?: OwnerSystemMetric }) {
  return metric?.note ? <p className="placeholder-note">{metric.note}</p> : null;
}

const queueTotals = (workerHealth?: OwnerWorkerHealth) =>
  workerHealth?.queues.reduce(
    (total, queue) => ({ activeBacklog: total.activeBacklog + queue.waiting + queue.active + queue.delayed, failed: total.failed + queue.failed }),
    { activeBacklog: 0, failed: 0 }
  ) ?? { activeBacklog: 0, failed: 0 };

export function OwnerSystemPage() {
  const ownerApi = useOwnerApi();
  const workerResource = useStableResource({ load: ownerApi.getWorkerHealth, getKey: () => "owner-worker-health", initialParams: undefined });
  const integrationsResource = useStableResource({ load: ownerApi.getIntegrationsHealth, getKey: () => "owner-integrations-health", initialParams: undefined });
  const metricsResource = useStableResource({ load: ownerApi.getSystemMetrics, getKey: () => "owner-system-metrics", initialParams: undefined });
  const retryAll = () => { workerResource.retry(); integrationsResource.retry(); metricsResource.retry(); };

  const workerHealth = workerResource.data;
  const integrationsHealth = integrationsResource.data;
  const systemMetrics = metricsResource.data;
  const requiredChecks = integrationsHealth?.checks.filter((check) => check.required !== false).length ?? 0;
  const okRequiredChecks = integrationsHealth?.checks.filter((check) => check.required !== false && ["ok", "ready", "configured"].includes(check.status)).length ?? 0;
  const generalStatus = buildGeneralStatus(integrationsHealth?.status, workerHealth?.readiness);
  const totals = queueTotals(workerHealth);
  const redisOk = workerHealth?.redis.status === "ok";
  const lastReview = formatCheckedAt(integrationsHealth?.checkedAt ?? workerHealth?.worker.heartbeatAt);

  return (
    <PageShell eyebrow="Owner / sistema" title="System KPI" description="Dashboard operativo compacto para Redis, BullMQ, worker e integraciones críticas." className="owner-system-page">
      {workerResource.isLoading || integrationsResource.isLoading || metricsResource.isLoading ? <LoadingState title="Cargando salud técnica" description="Consultando worker, colas, integraciones y métricas Redis/BullMQ." /> : null}
      {workerResource.error ? <ErrorState title="No se pudo cargar worker health" message={workerResource.error} action={<Button onClick={workerResource.retry}>Reintentar worker</Button>} /> : null}
      {integrationsResource.error ? <ErrorState title="No se pudieron cargar integraciones" message={integrationsResource.error} action={<Button onClick={integrationsResource.retry}>Reintentar integraciones</Button>} /> : null}
      {metricsResource.error ? <ErrorState title="No se pudieron cargar métricas Redis/BullMQ" message={metricsResource.error} action={<Button onClick={metricsResource.retry}>Reintentar métricas</Button>} /> : null}

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
          <SystemCard title="Integration checks" eyebrow="real-time checks" icon="✓">
            <div className="integration-list">{orderedChecks(integrationsHealth?.checks ?? []).map((check) => <article className="integration-row" key={check.key}><div><div className="integration-row__title"><strong>{check.label}</strong><StatusPill tone={integrationTone(check)}>{check.status}</StatusPill></div><p>{check.system} · {check.required === false ? "opcional / futuro" : "required"}</p><small>{check.message}</small>{check.nextAction ? <em>Next action: {check.nextAction}</em> : null}</div></article>)}</div>
          </SystemCard>
          <div className="owner-system-stack"><SystemCard title="Redis 8.8.0 — configuración" eyebrow="prepared runtime contract" icon="⚡"><div className="config-grid"><span>Connection Timeout</span><strong>1s</strong><span>Read Timeout</span><strong>1s</strong><span>Redis Version</span><strong>8.8.0</strong><span>Queue Driver</span><strong>BullMQ</strong><span>Estado real</span><StatusPill tone={statusTone(workerHealth?.redis.status)}>{workerHealth?.redis.status ?? "unknown"}</StatusPill></div></SystemCard>
          <SystemCard title="BullMQ — estado de colas" eyebrow="workerHealth.queues" icon="≡"><DataTable rows={workerHealth?.queues ?? []} getRowKey={(row) => row.name} columns={[{ key: "name", header: "Cola", render: (row) => row.name },{ key: "waiting", header: "Waiting", render: (row) => row.waiting },{ key: "active", header: "Active", render: (row) => row.active },{ key: "delayed", header: "Delayed", render: (row) => row.delayed },{ key: "failed", header: "Failed", render: (row) => row.failed },{ key: "oldest", header: "Oldest", render: (row) => formatSeconds(row.oldestJobAgeSeconds) }]} /></SystemCard></div>
        </div></section>

        <section className="owner-system-section"><div className="owner-system-section__title"><h2>Cache analytics — prefetching & performance</h2><span>métricas reales y estado de instrumentación</span></div><div className="grid-3">
          <SystemCard title="Hit / Miss ratio" icon="◑" action={<MetricStatus metric={systemMetrics?.cacheAnalytics.hitMissRatio} />}><div className="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="44"/><path d="M60 16a44 44 0 1 1-38 22" style={{ strokeDasharray: `${metricPercent(systemMetrics?.cacheAnalytics.hitMissRatio) * 2.76} 276` }}/></svg><strong>{formatMetricValue(systemMetrics?.cacheAnalytics.hitMissRatio)}</strong></div><MetricBar label="Hits" value={metricPercent(systemMetrics?.cacheAnalytics.hitMissRatio)} tone="success" text={formatMetricValue(systemMetrics?.cacheAnalytics.hits)}/><MetricBar label="Misses" value={metricPercent(systemMetrics?.cacheAnalytics.hitMissRatio) ? 100 - metricPercent(systemMetrics?.cacheAnalytics.hitMissRatio) : 0} tone="warning" text={formatMetricValue(systemMetrics?.cacheAnalytics.misses)}/><MetricBar label="Prefetch hit" value={0} tone="warning" text={systemMetrics?.cacheAnalytics.prefetchHit.instrumentationStatus ?? "not_instrumented"}/><MetricNote metric={systemMetrics?.cacheAnalytics.hitMissRatio}/><MetricNote metric={systemMetrics?.cacheAnalytics.prefetchHit}/></SystemCard>
          <SystemCard title="Latencia & timing" icon="⏱" action={<MetricStatus metric={systemMetrics?.latencyAndTiming.pingLatency} />}><div className="latency-grid"><div><strong>ping</strong><span>{formatMetricValue(systemMetrics?.latencyAndTiming.pingLatency)}</span></div><div><strong>p95</strong><span>{formatMetricValue(systemMetrics?.latencyAndTiming.p95)}</span></div><div><strong>p99</strong><span>{formatMetricValue(systemMetrics?.latencyAndTiming.p99)}</span></div></div><MetricBar label="PING" value={systemMetrics?.latencyAndTiming.pingLatency.value && typeof systemMetrics.latencyAndTiming.pingLatency.value === "number" ? Math.min(systemMetrics.latencyAndTiming.pingLatency.value * 5, 100) : 0} text={formatMetricValue(systemMetrics?.latencyAndTiming.pingLatency)}/><MetricBar label="AVG" value={0} text={systemMetrics?.latencyAndTiming.avg.instrumentationStatus ?? "not_instrumented"}/><MetricBar label="P95" value={0} text={systemMetrics?.latencyAndTiming.p95.instrumentationStatus ?? "not_instrumented"}/><MetricNote metric={systemMetrics?.latencyAndTiming.avg}/></SystemCard>
          <SystemCard title="Bytes & serialización" icon="⇅" action={<MetricStatus metric={systemMetrics?.bytesAndSerialization.compressionRatio} />}><div className="bytes-callout"><strong>Ratio</strong><span>{formatMetricValue(systemMetrics?.bytesAndSerialization.compressionRatio)}</span></div><div className="config-grid compact"><span>Avg key size</span><strong>{formatMetricValue(systemMetrics?.bytesAndSerialization.avgKeySize)}</strong><span>Raw vs Compressed</span><strong>{formatMetricValue(systemMetrics?.bytesAndSerialization.rawVsCompressed)}</strong></div><MetricNote metric={systemMetrics?.bytesAndSerialization.avgKeySize}/></SystemCard>
        </div></section>

        <section className="owner-system-section"><div className="owner-system-section__title"><h2>Calls & throughput — BullMQ + Redis</h2><span>derivado desde snapshots operativos cuando hay ventana previa</span></div><div className="grid-2">
          <SystemCard title="Calls / min — últimos 8 puntos" icon="~" action={<MetricStatus metric={systemMetrics?.callsAndThroughput.redisCommandsPerMinute} />}><div className="spark-bars">{(systemMetrics?.series?.last8?.length ? systemMetrics.series.last8 : [{ at: "pending", redisCommandsPerMinute: metricPercent(systemMetrics?.callsAndThroughput.redisCommandsPerMinute), bullmqJobsPerMinute: 0, sampleWindowMinutes: 0 }]).map((point) => <span key={point.at} title={`${point.redisCommandsPerMinute ?? 0} ops/min`} style={{ height: `${Math.max(4, Math.min(100, Number(point.redisCommandsPerMinute ?? 0)))}%` }} />)}</div><div className="throughput-table"><div><b>Redis total commands</b><span>{formatMetricValue(systemMetrics?.callsAndThroughput.redisCommandsProcessed)}</span></div><div><b>Redis ops/min</b><span>{formatMetricValue(systemMetrics?.callsAndThroughput.redisCommandsPerMinute)}</span></div><div><b>BullMQ jobs/min</b><span>{formatMetricValue(systemMetrics?.callsAndThroughput.bullmqJobsPerMinute)}</span></div><div><b>BullMQ completed</b><span>{formatMetricValue(systemMetrics?.callsAndThroughput.totalBullmqCompleted)}</span></div></div><MetricNote metric={systemMetrics?.callsAndThroughput.redisCommandsPerMinute}/></SystemCard>
          <SystemCard title="Debug & logging" icon="⚙" action={<StatusPill tone="success">Easy debugging & logging</StatusPill>}><div className="debug-table"><div><span>Redis ops</span><MetricStatus metric={systemMetrics?.debugAndLogging.redisOps}/></div><div><span>BullMQ jobs</span><MetricStatus metric={systemMetrics?.debugAndLogging.bullmqJobs}/></div><div><span>REDIS_STATUS</span><StatusPill tone={redisOk ? "success" : "warning"}>{redisOk ? "INFO" : "WARN"}</StatusPill></div><div><span>Slow queries</span><MetricStatus metric={systemMetrics?.debugAndLogging.slowQueries}/></div><div><span>Failed jobs: {formatMetricValue(systemMetrics?.debugAndLogging.failedJobs)}</span><MetricStatus metric={systemMetrics?.debugAndLogging.failedJobs}/></div><div><span>Retry rate: {formatMetricValue(systemMetrics?.debugAndLogging.retryRate)}</span><MetricStatus metric={systemMetrics?.debugAndLogging.retryRate}/></div></div></SystemCard>
        </div></section>

        <section className="owner-system-section"><div className="owner-system-section__title"><h2>Expansión propuesta</h2><span>memory live; resto con estados honestos</span></div><div className="expansion-grid"><SystemCard title="Redis memory" action={<MetricStatus metric={systemMetrics?.expansion.redisMemory.usedMemory} />}><p className="placeholder-note">Used: {formatMetricValue(systemMetrics?.expansion.redisMemory.usedMemory)} · Peak: {formatMetricValue(systemMetrics?.expansion.redisMemory.usedMemoryPeak)}</p></SystemCard><SystemCard title="TTL distribution" action={<MetricStatus metric={systemMetrics?.expansion.ttlDistribution} />}><MetricNote metric={systemMetrics?.expansion.ttlDistribution}/></SystemCard><SystemCard title="Retry rate" action={<MetricStatus metric={systemMetrics?.expansion.retryRate} />}><p className="placeholder-note">{formatMetricValue(systemMetrics?.expansion.retryRate)}</p></SystemCard><SystemCard title="Throughput 24h" action={<MetricStatus metric={systemMetrics?.expansion.throughput24h} />}><p className="placeholder-note">Buckets: {systemMetrics?.series?.throughput24h?.length ?? 0} · {formatMetricValue(systemMetrics?.expansion.throughput24h)}</p><MetricNote metric={systemMetrics?.expansion.throughput24h}/></SystemCard><SystemCard title="Por organización" action={<MetricStatus metric={systemMetrics?.expansion.perOrganization} />}><MetricNote metric={systemMetrics?.expansion.perOrganization}/></SystemCard><SystemCard title="Alertas" action={<MetricStatus metric={systemMetrics?.expansion.alerts} />}><MetricNote metric={systemMetrics?.expansion.alerts}/></SystemCard></div></section>
      </div>
    </PageShell>
  );
}
