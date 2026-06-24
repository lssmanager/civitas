import "./OwnerSystemPage.css";

import { Button } from "react-bootstrap";
import {
  useOwnerApi,
  type OwnerIntegrationHealthCheck,
  type OwnerSystemMetric,
  type OwnerWorkerHealth,
} from "../api/owner";
import { useStableResource } from "../shared/hooks/useStableResource";
import {
  DashboardPanel,
  DataTable,
  ErrorState,
  KpiGrid,
  LoadingState,
  MetricCard,
  PageShell,
  SectionCard,
  StatusPill,
  SystemCheckCard,
} from "../shared/ui";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const integrationTone = (check: OwnerIntegrationHealthCheck): Tone => {
  if (check.severity === "success") return "success";
  if (check.severity === "danger") return "danger";
  if (check.severity === "secondary") return "neutral";
  return "warning";
};

const statusTone = (status?: string): Tone => {
  if (["ok", "ready", "success", "healthy"].includes(status ?? ""))
    return "success";
  if (["error", "degraded", "failed", "down"].includes(status ?? ""))
    return "danger";
  if (
    [
      "unknown",
      "attention",
      "pending_integration",
      "not_configured",
      "stale",
    ].includes(status ?? "")
  )
    return "warning";
  return "neutral";
};

const formatCheckedAt = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "Sin dato";
const formatSeconds = (value: number) =>
  value > 60 ? `${Math.round(value / 60)}m` : `${value}s`;
const safePercent = (value: number) => Math.min(100, Math.max(0, value));

const buildGeneralStatus = (
  integrationsStatus?: string,
  readiness?: string,
) => {
  if (readiness === "ready" && integrationsStatus === "ok") return "ok";
  if (readiness === "degraded" || integrationsStatus === "degraded")
    return "degraded";
  if (integrationsStatus === "attention") return "attention";
  return readiness ?? integrationsStatus ?? "unknown";
};

const statusToPillStatus = (tone: Tone) => {
  if (tone === "success") return "ok";
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  if (tone === "info") return "info";
  return "neutral";
};

const metricToneToCardTone = (
  tone: Tone,
): "primary" | "success" | "warning" | "danger" => {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "danger") return "danger";
  return "primary";
};

type MetricBarProps = {
  label: string;
  value: number;
  text?: string;
  tone?: Tone;
};

function MetricBar({ label, value, text, tone = "info" }: MetricBarProps) {
  return (
    <div className="civitas-owner-system-meter">
      <div className="civitas-owner-system-meter__label">
        <span>{label}</span>
        <strong>{text ?? `${value}%`}</strong>
      </div>
      <div className="civitas-owner-system-meter__track">
        <span
          className={`civitas-owner-system-meter__fill civitas-owner-system-meter__fill--${tone}`}
          style={{ width: `${safePercent(value)}%` }}
        />
      </div>
    </div>
  );
}

const wantedSystems = [
  "Redis / BullMQ",
  "Logto Management API",
  "FluentCRM",
  "WordPress",
  "Moodle",
];

const orderedChecks = (checks: OwnerIntegrationHealthCheck[]) =>
  [...checks].sort((a, b) => {
    const ai = wantedSystems.findIndex(
      (name) =>
        a.label.includes(name) ||
        a.system.includes(name) ||
        a.key.toLowerCase().includes(name.toLowerCase().split(" ")[0]),
    );
    const bi = wantedSystems.findIndex(
      (name) =>
        b.label.includes(name) ||
        b.system.includes(name) ||
        b.key.toLowerCase().includes(name.toLowerCase().split(" ")[0]),
    );
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

const metricTone = (metric?: OwnerSystemMetric): Tone => {
  if (!metric) return "neutral";
  if (["live", "derived"].includes(metric.instrumentationStatus))
    return "success";
  if (["sampled", "proposed"].includes(metric.instrumentationStatus))
    return "info";
  return "warning";
};

const formatMetricValue = (metric?: OwnerSystemMetric) => {
  if (
    !metric ||
    metric.value === null ||
    metric.value === undefined ||
    metric.value === ""
  )
    return metric?.instrumentationStatus ?? "sin dato";
  const suffix =
    metric.unit && metric.unit !== "count" ? ` ${metric.unit}` : "";
  return `${metric.value}${suffix}`;
};

const metricPercent = (metric?: OwnerSystemMetric) =>
  typeof metric?.value === "number" && Number.isFinite(metric.value)
    ? safePercent(metric.value)
    : 0;

function MetricStatus({ metric }: { metric?: OwnerSystemMetric }) {
  return (
    <StatusPill
      status={statusToPillStatus(metricTone(metric))}
      label={metric?.instrumentationStatus ?? "unknown"}
    />
  );
}

function MetricNote({ metric }: { metric?: OwnerSystemMetric }) {
  return metric?.note ? (
    <p className="civitas-owner-system-note">{metric.note}</p>
  ) : null;
}

const queueTotals = (workerHealth?: OwnerWorkerHealth) =>
  workerHealth?.queues.reduce(
    (total, queue) => ({
      activeBacklog:
        total.activeBacklog + queue.waiting + queue.active + queue.delayed,
      failed: total.failed + queue.failed,
    }),
    { activeBacklog: 0, failed: 0 },
  ) ?? { activeBacklog: 0, failed: 0 };

export function OwnerSystemPage() {
  const ownerApi = useOwnerApi();
  const workerResource = useStableResource({
    load: ownerApi.getWorkerHealth,
    getKey: () => "owner-worker-health",
    initialParams: undefined,
  });
  const integrationsResource = useStableResource({
    load: ownerApi.getIntegrationsHealth,
    getKey: () => "owner-integrations-health",
    initialParams: undefined,
  });
  const metricsResource = useStableResource({
    load: ownerApi.getSystemMetrics,
    getKey: () => "owner-system-metrics",
    initialParams: undefined,
  });
  const retryAll = () => {
    workerResource.retry();
    integrationsResource.retry();
    metricsResource.retry();
  };

  const workerHealth = workerResource.data;
  const integrationsHealth = integrationsResource.data;
  const systemMetrics = metricsResource.data;
  const requiredChecks =
    integrationsHealth?.checks.filter((check) => check.required !== false)
      .length ?? 0;
  const okRequiredChecks =
    integrationsHealth?.checks.filter(
      (check) =>
        check.required !== false &&
        ["ok", "ready", "configured"].includes(check.status),
    ).length ?? 0;
  const generalStatus = buildGeneralStatus(
    integrationsHealth?.status,
    workerHealth?.readiness,
  );
  const totals = queueTotals(workerHealth);
  const redisOk = workerHealth?.redis.status === "ok";
  const lastReview = formatCheckedAt(
    integrationsHealth?.checkedAt ?? workerHealth?.worker.heartbeatAt,
  );

  return (
    <PageShell
      eyebrow="Owner / sistema"
      title="System KPI"
      description="Dashboard operativo compacto para Redis, BullMQ, worker e integraciones críticas."
      className="civitas-owner-system-page"
    >
      {workerResource.isLoading ||
      integrationsResource.isLoading ||
      metricsResource.isLoading ? (
        <LoadingState
          title="Cargando salud técnica"
          description="Consultando worker, colas, integraciones y métricas Redis/BullMQ."
        />
      ) : null}
      {workerResource.error ? (
        <ErrorState
          title="No se pudo cargar worker health"
          message={workerResource.error}
          action={
            <Button onClick={workerResource.retry}>Reintentar worker</Button>
          }
        />
      ) : null}
      {integrationsResource.error ? (
        <ErrorState
          title="No se pudieron cargar integraciones"
          message={integrationsResource.error}
          action={
            <Button onClick={integrationsResource.retry}>
              Reintentar integraciones
            </Button>
          }
        />
      ) : null}
      {metricsResource.error ? (
        <ErrorState
          title="No se pudieron cargar métricas Redis/BullMQ"
          message={metricsResource.error}
          action={
            <Button onClick={metricsResource.retry}>Reintentar métricas</Button>
          }
        />
      ) : null}

      <div className="civitas-owner-system-dashboard">
        <div className="civitas-owner-system-topbar">
          <div>
            <h1>Civitas — System KPI Dashboard</h1>
            <p>
              civitas.socialstudies.cloud · owner/system · última revisión{" "}
              {lastReview}
            </p>
          </div>
          <div className="civitas-owner-system-topbar__actions">
            <StatusPill
              status={statusToPillStatus(statusTone(generalStatus))}
              label={`Estado general: ${generalStatus}`}
            />
            <Button
              size="sm"
              variant="outline-primary"
              onClick={integrationsResource.retry}
            >
              Verificar conexión CRM
            </Button>
            <Button size="sm" variant="primary" onClick={retryAll}>
              Revisar todo
            </Button>
          </div>
        </div>

        <div
          className={`civitas-owner-system-alert civitas-owner-system-alert--${redisOk ? "ok" : "warn"}`}
        >
          <strong>Redis / BullMQ:</strong>{" "}
          {redisOk
            ? "conectado y listo para coordinar jobs."
            : `requiere atención (${workerHealth?.redis.status ?? "unknown"}).`}{" "}
          <span>Los timeouts cortos protegen el panel owner.</span>
        </div>

        <section className="civitas-owner-system-section">
          <div className="civitas-owner-system-section__title">
            <h2>Resumen general</h2>
            <span>datos reales de health endpoints</span>
          </div>
          <KpiGrid>
            <MetricCard
              label="Servicios ok"
              value={`${okRequiredChecks}/${requiredChecks}`}
              hint="checks requeridos saludables"
              tone={
                okRequiredChecks === requiredChecks && requiredChecks > 0
                  ? "success"
                  : "warning"
              }
            />
            <MetricCard
              label="Worker heartbeat"
              value={workerHealth?.worker.heartbeatStale ? "stale" : "ok"}
              hint={`último: ${formatCheckedAt(workerHealth?.worker.heartbeatAt)}`}
              tone={workerHealth?.worker.heartbeatStale ? "warning" : "success"}
            />
            <MetricCard
              label="Colas activas"
              value={totals.activeBacklog}
              hint={`${totals.failed} failed · waiting + active + delayed`}
              tone={metricToneToCardTone(
                totals.failed > 0 ? "warning" : "info",
              )}
            />
            <MetricCard
              label="Readiness"
              value={workerHealth?.readiness ?? "unknown"}
              hint="workerHealth.readiness"
              tone={metricToneToCardTone(statusTone(workerHealth?.readiness))}
            />
          </KpiGrid>
        </section>

        <section className="civitas-owner-system-section">
          <div className="civitas-owner-system-section__title">
            <h2>Integration checks & Redis config</h2>
            <span>integraciones requeridas y opcionales</span>
          </div>
          <div className="civitas-owner-system-grid civitas-owner-system-grid--2">
            <DashboardPanel
              title="Integration checks"
              badge={<StatusPill status="info" label="real-time checks" />}
            >
              <div className="civitas-owner-system-check-list">
                {orderedChecks(integrationsHealth?.checks ?? []).map(
                  (check) => (
                    <SystemCheckCard
                      key={check.key}
                      title={check.label}
                      system={check.system}
                      required={check.required !== false}
                      status={statusToPillStatus(integrationTone(check))}
                      badgeLabel={check.status}
                      message={check.message}
                      nextAction={check.nextAction}
                    />
                  ),
                )}
              </div>
            </DashboardPanel>
            <div className="civitas-owner-system-stack">
              <DashboardPanel
                title="Redis 8.8.0 — configuración"
                badge={
                  <StatusPill
                    status="primary"
                    label="prepared runtime contract"
                  />
                }
              >
                <div className="civitas-owner-system-config-grid">
                  <span>Connection Timeout</span>
                  <strong>1s</strong>
                  <span>Read Timeout</span>
                  <strong>1s</strong>
                  <span>Redis Version</span>
                  <strong>8.8.0</strong>
                  <span>Queue Driver</span>
                  <strong>BullMQ</strong>
                  <span>Estado real</span>
                  <StatusPill
                    status={statusToPillStatus(
                      statusTone(workerHealth?.redis.status),
                    )}
                    label={workerHealth?.redis.status ?? "unknown"}
                  />
                </div>
              </DashboardPanel>
              <DashboardPanel
                title="BullMQ — estado de colas"
                badge={<StatusPill status="info" label="workerHealth.queues" />}
              >
                <DataTable
                  rows={workerHealth?.queues ?? []}
                  getRowKey={(row) => row.name}
                  columns={[
                    { key: "name", header: "Cola", render: (row) => row.name },
                    {
                      key: "waiting",
                      header: "Waiting",
                      render: (row) => row.waiting,
                    },
                    {
                      key: "active",
                      header: "Active",
                      render: (row) => row.active,
                    },
                    {
                      key: "delayed",
                      header: "Delayed",
                      render: (row) => row.delayed,
                    },
                    {
                      key: "failed",
                      header: "Failed",
                      render: (row) => row.failed,
                    },
                    {
                      key: "oldest",
                      header: "Oldest",
                      render: (row) => formatSeconds(row.oldestJobAgeSeconds),
                    },
                  ]}
                />
              </DashboardPanel>
            </div>
          </div>
        </section>

        <section className="civitas-owner-system-section">
          <div className="civitas-owner-system-section__title">
            <h2>Cache analytics — prefetching & performance</h2>
            <span>métricas reales y estado de instrumentación</span>
          </div>
          <div className="civitas-owner-system-grid civitas-owner-system-grid--3">
            <SectionCard
              title="Hit / Miss ratio"
              icon="◑"
              action={
                <MetricStatus
                  metric={systemMetrics?.cacheAnalytics.hitMissRatio}
                />
              }
            >
              <div className="civitas-owner-system-ring">
                <svg viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="44" />
                  <path
                    d="M60 16a44 44 0 1 1-38 22"
                    style={{
                      strokeDasharray: `${metricPercent(systemMetrics?.cacheAnalytics.hitMissRatio) * 2.76} 276`,
                    }}
                  />
                </svg>
                <strong>
                  {formatMetricValue(
                    systemMetrics?.cacheAnalytics.hitMissRatio,
                  )}
                </strong>
              </div>
              <MetricBar
                label="Hits"
                value={metricPercent(
                  systemMetrics?.cacheAnalytics.hitMissRatio,
                )}
                tone="success"
                text={formatMetricValue(systemMetrics?.cacheAnalytics.hits)}
              />
              <MetricBar
                label="Misses"
                value={
                  metricPercent(systemMetrics?.cacheAnalytics.hitMissRatio)
                    ? 100 -
                      metricPercent(systemMetrics?.cacheAnalytics.hitMissRatio)
                    : 0
                }
                tone="warning"
                text={formatMetricValue(systemMetrics?.cacheAnalytics.misses)}
              />
              <MetricBar
                label="Prefetch hit"
                value={0}
                tone="warning"
                text={
                  systemMetrics?.cacheAnalytics.prefetchHit
                    .instrumentationStatus ?? "not_instrumented"
                }
              />
              <MetricNote metric={systemMetrics?.cacheAnalytics.hitMissRatio} />
              <MetricNote metric={systemMetrics?.cacheAnalytics.prefetchHit} />
            </SectionCard>
            <SectionCard
              title="Latencia & timing"
              icon="⏱"
              action={
                <MetricStatus
                  metric={systemMetrics?.latencyAndTiming.pingLatency}
                />
              }
            >
              <div className="civitas-owner-system-latency-grid">
                <div>
                  <strong>ping</strong>
                  <span>
                    {formatMetricValue(
                      systemMetrics?.latencyAndTiming.pingLatency,
                    )}
                  </span>
                </div>
                <div>
                  <strong>p95</strong>
                  <span>
                    {formatMetricValue(systemMetrics?.latencyAndTiming.p95)}
                  </span>
                </div>
                <div>
                  <strong>p99</strong>
                  <span>
                    {formatMetricValue(systemMetrics?.latencyAndTiming.p99)}
                  </span>
                </div>
              </div>
              <MetricBar
                label="PING"
                value={
                  systemMetrics?.latencyAndTiming.pingLatency.value &&
                  typeof systemMetrics.latencyAndTiming.pingLatency.value ===
                    "number"
                    ? Math.min(
                        systemMetrics.latencyAndTiming.pingLatency.value * 5,
                        100,
                      )
                    : 0
                }
                text={formatMetricValue(
                  systemMetrics?.latencyAndTiming.pingLatency,
                )}
              />
              <MetricBar
                label="AVG"
                value={0}
                text={
                  systemMetrics?.latencyAndTiming.avg.instrumentationStatus ??
                  "not_instrumented"
                }
              />
              <MetricBar
                label="P95"
                value={0}
                text={
                  systemMetrics?.latencyAndTiming.p95.instrumentationStatus ??
                  "not_instrumented"
                }
              />
              <MetricNote metric={systemMetrics?.latencyAndTiming.avg} />
            </SectionCard>
            <SectionCard
              title="Bytes & serialización"
              icon="⇅"
              action={
                <MetricStatus
                  metric={systemMetrics?.bytesAndSerialization.compressionRatio}
                />
              }
            >
              <div className="civitas-owner-system-bytes-callout">
                <strong>Ratio</strong>
                <span>
                  {formatMetricValue(
                    systemMetrics?.bytesAndSerialization.compressionRatio,
                  )}
                </span>
              </div>
              <div className="civitas-owner-system-config-grid compact">
                <span>Avg key size</span>
                <strong>
                  {formatMetricValue(
                    systemMetrics?.bytesAndSerialization.avgKeySize,
                  )}
                </strong>
                <span>Raw vs Compressed</span>
                <strong>
                  {formatMetricValue(
                    systemMetrics?.bytesAndSerialization.rawVsCompressed,
                  )}
                </strong>
              </div>
              <MetricNote
                metric={systemMetrics?.bytesAndSerialization.avgKeySize}
              />
            </SectionCard>
          </div>
        </section>

        <section className="civitas-owner-system-section">
          <div className="civitas-owner-system-section__title">
            <h2>Calls & throughput — BullMQ + Redis</h2>
            <span>
              derivado desde snapshots operativos cuando hay ventana previa
            </span>
          </div>
          <div className="civitas-owner-system-grid civitas-owner-system-grid--2">
            <SectionCard
              title="Calls / min — últimos 8 puntos"
              icon="~"
              action={
                <MetricStatus
                  metric={
                    systemMetrics?.callsAndThroughput.redisCommandsPerMinute
                  }
                />
              }
            >
              <div className="civitas-owner-system-spark-bars">
                {(systemMetrics?.series?.last8?.length
                  ? systemMetrics.series.last8
                  : [
                      {
                        at: "pending",
                        redisCommandsPerMinute: metricPercent(
                          systemMetrics?.callsAndThroughput
                            .redisCommandsPerMinute,
                        ),
                        bullmqJobsPerMinute: 0,
                        sampleWindowMinutes: 0,
                      },
                    ]
                ).map((point) => (
                  <span
                    key={point.at}
                    title={`${point.redisCommandsPerMinute ?? 0} ops/min`}
                    style={{
                      height: `${Math.max(4, Math.min(100, Number(point.redisCommandsPerMinute ?? 0)))}%`,
                    }}
                  />
                ))}
              </div>
              <div className="civitas-owner-system-key-table">
                <div>
                  <b>Redis total commands</b>
                  <span>
                    {formatMetricValue(
                      systemMetrics?.callsAndThroughput.redisCommandsProcessed,
                    )}
                  </span>
                </div>
                <div>
                  <b>Redis ops/min</b>
                  <span>
                    {formatMetricValue(
                      systemMetrics?.callsAndThroughput.redisCommandsPerMinute,
                    )}
                  </span>
                </div>
                <div>
                  <b>BullMQ jobs/min</b>
                  <span>
                    {formatMetricValue(
                      systemMetrics?.callsAndThroughput.bullmqJobsPerMinute,
                    )}
                  </span>
                </div>
                <div>
                  <b>BullMQ completed</b>
                  <span>
                    {formatMetricValue(
                      systemMetrics?.callsAndThroughput.totalBullmqCompleted,
                    )}
                  </span>
                </div>
              </div>
              <MetricNote
                metric={
                  systemMetrics?.callsAndThroughput.redisCommandsPerMinute
                }
              />
            </SectionCard>
            <SectionCard
              title="Debug & logging"
              icon="⚙"
              action={
                <StatusPill status="ok" label="Easy debugging & logging" />
              }
            >
              <div className="civitas-owner-system-key-table">
                <div>
                  <span>Redis ops</span>
                  <MetricStatus
                    metric={systemMetrics?.debugAndLogging.redisOps}
                  />
                </div>
                <div>
                  <span>BullMQ jobs</span>
                  <MetricStatus
                    metric={systemMetrics?.debugAndLogging.bullmqJobs}
                  />
                </div>
                <div>
                  <span>REDIS_STATUS</span>
                  <StatusPill
                    status={redisOk ? "ok" : "warning"}
                    label={redisOk ? "INFO" : "WARN"}
                  />
                </div>
                <div>
                  <span>Slow queries</span>
                  <MetricStatus
                    metric={systemMetrics?.debugAndLogging.slowQueries}
                  />
                </div>
                <div>
                  <span>
                    Failed jobs:{" "}
                    {formatMetricValue(
                      systemMetrics?.debugAndLogging.failedJobs,
                    )}
                  </span>
                  <MetricStatus
                    metric={systemMetrics?.debugAndLogging.failedJobs}
                  />
                </div>
                <div>
                  <span>
                    Retry rate:{" "}
                    {formatMetricValue(
                      systemMetrics?.debugAndLogging.retryRate,
                    )}
                  </span>
                  <MetricStatus
                    metric={systemMetrics?.debugAndLogging.retryRate}
                  />
                </div>
              </div>
            </SectionCard>
          </div>
        </section>

        <section className="civitas-owner-system-section">
          <div className="civitas-owner-system-section__title">
            <h2>Expansión propuesta</h2>
            <span>memory live; resto con estados honestos</span>
          </div>
          <div className="civitas-owner-system-expansion-grid">
            <SectionCard
              title="Redis memory"
              action={
                <MetricStatus
                  metric={systemMetrics?.expansion.redisMemory.usedMemory}
                />
              }
            >
              <p className="civitas-owner-system-note">
                Used:{" "}
                {formatMetricValue(
                  systemMetrics?.expansion.redisMemory.usedMemory,
                )}{" "}
                · Peak:{" "}
                {formatMetricValue(
                  systemMetrics?.expansion.redisMemory.usedMemoryPeak,
                )}
              </p>
            </SectionCard>
            <SectionCard
              title="TTL distribution"
              action={
                <MetricStatus
                  metric={systemMetrics?.expansion.ttlDistribution}
                />
              }
            >
              <MetricNote metric={systemMetrics?.expansion.ttlDistribution} />
            </SectionCard>
            <SectionCard
              title="Retry rate"
              action={
                <MetricStatus metric={systemMetrics?.expansion.retryRate} />
              }
            >
              <p className="civitas-owner-system-note">
                {formatMetricValue(systemMetrics?.expansion.retryRate)}
              </p>
            </SectionCard>
            <SectionCard
              title="Throughput 24h"
              action={
                <MetricStatus metric={systemMetrics?.expansion.throughput24h} />
              }
            >
              <p className="civitas-owner-system-note">
                Buckets: {systemMetrics?.series?.throughput24h?.length ?? 0} ·{" "}
                {formatMetricValue(systemMetrics?.expansion.throughput24h)}
              </p>
              <MetricNote metric={systemMetrics?.expansion.throughput24h} />
            </SectionCard>
            <SectionCard
              title="Por organización"
              action={
                <MetricStatus
                  metric={systemMetrics?.expansion.perOrganization}
                />
              }
            >
              <MetricNote metric={systemMetrics?.expansion.perOrganization} />
            </SectionCard>
            <SectionCard
              title="Alertas"
              action={<MetricStatus metric={systemMetrics?.expansion.alerts} />}
            >
              <MetricNote metric={systemMetrics?.expansion.alerts} />
            </SectionCard>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
