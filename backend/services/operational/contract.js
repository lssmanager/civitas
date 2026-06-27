const ACTIONS = Object.freeze({ RETRY: "retry", VERIFY_PROVIDER: "verify_provider", OPEN_ORGANIZATION: "open_organization", WAIT_FIRST_WORDPRESS_LOGIN: "wait_first_wordpress_login", MANUAL_RETRY_REQUIRED: "manual_retry_required", HUMAN_ACTION_REQUIRED: "human_action_required", NONE: "none" });
const FRESHNESS_SOURCES = Object.freeze({ LIVE_PROVIDER_CHECK: "live_provider_check", WORKER_RUNTIME: "worker_runtime", LOCAL_RECONCILED: "local_reconciled", PERSISTED_SNAPSHOT: "persisted_snapshot" });
const ACTIVE_OPERATION_STATUSES = new Set(["queued", "running", "downstream_running", "canonical_completed", "processing", "active", "waiting", "delayed"]);
const TERMINAL_FAILURE_STATUSES = new Set(["failed", "partial_failed", "error", "conflict"]);
const SOURCE_STALE_SECONDS = Object.freeze({ live_provider_check: 120, worker_runtime: 30, local_reconciled: 300, persisted_snapshot: 0 });
function toIso(value) { return value?.toISOString?.() ?? value ?? null; }
function buildFreshness({ source = FRESHNESS_SOURCES.LOCAL_RECONCILED, checkedAt = new Date(), staleAfterSeconds, now = new Date(), refreshReason = null } = {}) {
  const effectiveStaleAfter = staleAfterSeconds ?? SOURCE_STALE_SECONDS[source] ?? 300;
  const checkedIso = toIso(checkedAt);
  const checkedMs = checkedIso ? new Date(checkedIso).getTime() : 0;
  const ageSeconds = checkedMs ? Math.max(0, Math.floor((new Date(now).getTime() - checkedMs) / 1000)) : null;
  const isStale = source === FRESHNESS_SOURCES.PERSISTED_SNAPSHOT || !checkedMs || ageSeconds > effectiveStaleAfter;
  const shouldAutoRefresh = source === FRESHNESS_SOURCES.LIVE_PROVIDER_CHECK ? isStale : source === FRESHNESS_SOURCES.WORKER_RUNTIME ? isStale : false;
  return { source, checkedAt: checkedIso, staleAfterSeconds: effectiveStaleAfter, isStale, shouldAutoRefresh, refreshReason: refreshReason || (isStale ? `${source}_stale` : null) };
}
function buildInvalidation({ invalidateOnOperationIds = [], invalidateOnStatuses = ["queued", "running", "completed", "failed", "partial_failed"], invalidatedAt = null, lastEventId = null } = {}) {
  return { invalidateOnOperationIds: [...new Set(invalidateOnOperationIds.filter(Boolean))], invalidateOnStatuses, invalidatedAt: toIso(invalidatedAt), lastEventId };
}
function dominanceRank(source, active = false) { if (source === FRESHNESS_SOURCES.WORKER_RUNTIME && active) return 400; if (source === FRESHNESS_SOURCES.LIVE_PROVIDER_CHECK) return 300; if (source === FRESHNESS_SOURCES.LOCAL_RECONCILED) return 200; if (source === FRESHNESS_SOURCES.PERSISTED_SNAPSHOT) return 100; return 0; }
function chooseDominantBlock(candidates = []) { return [...candidates].filter(Boolean).sort((a, b) => dominanceRank(b.freshness?.source, b.runtime?.isActive) - dominanceRank(a.freshness?.source, a.runtime?.isActive))[0] || null; }
function normalizeActions({ status, retryable = false, requiresHumanAction = false, organizationId = null, providerStatus = null, explicit = [] } = {}) {
  const actions = new Set(explicit.filter(Boolean));
  if (organizationId) actions.add(ACTIONS.OPEN_ORGANIZATION);
  if (retryable || TERMINAL_FAILURE_STATUSES.has(status)) actions.add(ACTIONS.RETRY);
  if (requiresHumanAction) actions.add(ACTIONS.HUMAN_ACTION_REQUIRED);
  if (providerStatus === "awaiting_first_wordpress_login") actions.add(ACTIONS.WAIT_FIRST_WORDPRESS_LOGIN);
  if (status !== "ok" && status !== "healthy") actions.add(ACTIONS.VERIFY_PROVIDER);
  if (!actions.size) actions.add(ACTIONS.NONE);
  return [...actions];
}
function buildOperationalBlock({ status = "unknown", severity = "info", humanMessage = null, providerCode = null, providerStatus = null, nextAction = null, availableActions, freshness, invalidation, details = {}, runtime = null } = {}) {
  const actions = availableActions || normalizeActions({ status, providerStatus, retryable: details.retryable, requiresHumanAction: details.requiresHumanAction, organizationId: details.organizationId });
  return { status, severity, humanMessage, providerCode, providerStatus, nextAction: nextAction || actions[0] || ACTIONS.NONE, availableActions: actions, freshness: freshness || buildFreshness(), invalidation: invalidation || buildInvalidation(), details, ...(runtime ? { runtime } : {}) };
}
function severityRank(severity) { return { critical: 4, warning: 3, info: 2, success: 1 }[severity] || 0; }
function buildSummary(blocks = {}) {
  const values = Object.values(blocks).filter(Boolean);
  const worst = values.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0] || null;
  const active = values.some((b) => b.freshness?.source === FRESHNESS_SOURCES.WORKER_RUNTIME && ["queued", "running", "degraded", "stalled"].includes(b.status));
  return { status: worst?.severity === "critical" ? "requires_action" : active ? "in_progress" : worst?.status || "unknown", severity: worst?.severity || "info", humanMessage: worst?.humanMessage || "Estado operacional consolidado disponible.", dominantSource: worst?.freshness?.source || null, nextAction: worst?.nextAction || ACTIONS.NONE, availableActions: [...new Set(values.flatMap((b) => b.availableActions || []))] };
}
function buildPolling({ blocks = {}, activeOperationIds = [] } = {}) {
  const shouldPoll = activeOperationIds.length > 0 || Object.values(blocks).some((b) => b?.freshness?.shouldAutoRefresh);
  return { shouldPoll, intervalSeconds: activeOperationIds.length ? 10 : shouldPoll ? 30 : 0, reason: activeOperationIds.length ? "active_worker_runtime" : shouldPoll ? "stale_live_or_worker_block" : "stable", activeOperationIds };
}
function buildConsolidatedOperationalResponse({ organization, canonical, fluentcrm, wordpress, worker, liveVerification, contactProgress, latestEventIds = {}, generatedAt = new Date(), compatibility = {} } = {}) {
  const blocks = { canonical, fluentcrm, wordpress, worker, liveVerification, contactProgress };
  return { contractVersion: "2026-06-issue-175-phase-1", generatedAt: toIso(generatedAt), organization, summary: buildSummary(blocks), canonical, fluentcrm, wordpress, worker, liveVerification, contactProgress, polling: buildPolling({ blocks, activeOperationIds: worker?.details?.activeOperationIds || [] }), latestEventIds, compatibility };
}
module.exports = { ACTIONS, ACTIVE_OPERATION_STATUSES, FRESHNESS_SOURCES, buildConsolidatedOperationalResponse, buildFreshness, buildInvalidation, buildOperationalBlock, buildPolling, buildSummary, chooseDominantBlock, normalizeActions };
