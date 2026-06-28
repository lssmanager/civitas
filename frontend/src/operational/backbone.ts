import type { OperationalAction, OperationalBlock, OperationalFreshness, OperationalSeverity, ConsolidatedOperationalResponse } from "../contracts/operational";
import type { OwnerAuditLog } from "../api/owner";

export const actionLabel: Record<string, string> = {
  retry: "Reintentar",
  retry_company: "Reintentar Company",
  retry_contacts: "Reintentar contactos",
  verify_provider: "Verificar proveedor",
  open_organization: "Abrir organización",
  open_settings: "Abrir settings",
  wait_first_wordpress_login: "Esperar primer login WordPress",
  manual_retry_required: "Revisión manual",
  human_action_required: "Acción humana requerida",
  manual_resolution: "Resolución manual",
  none: "Sin acción",
};

export const sourceLabel = (source?: string | null) => source === "live_provider_check" ? "live" : source === "worker_runtime" ? "worker" : source === "local_reconciled" ? "local" : source === "persisted_snapshot" ? "snapshot" : source || "sin fuente";
export const severityVariant = (severity?: OperationalSeverity | string | null) => severity === "success" ? "success" : severity === "critical" || severity === "danger" ? "danger" : severity === "warning" ? "warning" : severity === "info" ? "info" : "secondary";
export const statusVariant = (status?: string | null) => ["success", "healthy", "all_ok", "linked", "synced", "alive"].includes(String(status)) ? "success" : ["critical", "failed", "error", "stuck_in_queue", "worker_offline", "provider_auth_error"].includes(String(status)) ? "danger" : ["warning", "queued", "running", "pending", "backlog_growing", "worker_heartbeat_stale", "missing_fluentcrm_company", "awaiting_first_wordpress_login"].includes(String(status)) ? "warning" : "secondary";
export const formatDateTime = (value?: string | null) => value ? new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Sin dato";

export type CompactOperationalState = {
  canonicalStatus: string;
  fluentcrmStatus: string;
  wordpressStatus: string;
  blocker: OperationalBlock;
  nextAction: OperationalAction;
  availableActions: OperationalAction[];
  dominantSource: string | null;
  freshness?: OperationalFreshness;
  providerCode: string | null;
  providerStatus: string | number | null;
};

const severityRank = (severity?: string) => severity === "critical" ? 4 : severity === "warning" ? 3 : severity === "info" ? 2 : severity === "success" ? 1 : 0;
export const getPrimaryBlocker = (state: ConsolidatedOperationalResponse): OperationalBlock =>
  [state.canonical, state.fluentcrm, state.wordpress, state.worker, state.liveVerification, state.contactProgress]
    .filter(Boolean)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0] || state.canonical;

export const compactOperationalState = (state: ConsolidatedOperationalResponse): CompactOperationalState => {
  const blocker = getPrimaryBlocker(state);
  return {
    canonicalStatus: state.canonical.status,
    fluentcrmStatus: state.fluentcrm.status,
    wordpressStatus: state.wordpress.status,
    blocker,
    nextAction: state.summary.nextAction,
    availableActions: state.summary.availableActions,
    dominantSource: state.summary.dominantSource,
    freshness: blocker.freshness,
    providerCode: blocker.providerCode,
    providerStatus: blocker.providerStatus,
  };
};

export type OperationalLogPlane = "live" | "worker" | "local" | "audit";
export const getLogPlane = (row: OwnerAuditLog): OperationalLogPlane => {
  const source = String(row.executionSource || row.metadata?.executionSource || row.metadata?.source || "");
  const step = String(row.stepName || row.metadata?.stepName || row.action || "");
  if (row.rowType === "administrative_event") return "audit";
  if (/provider_verification|live/i.test(step) || /live_provider_check/i.test(source)) return "live";
  if (row.rowType === "operational_step" || row.queueName || row.jobId || /bullmq|worker|queue|runtime/i.test(source)) return "worker";
  if (row.rowType === "retry_event" || row.rowType === "projected_pending" || /local|reconciled|db_poll_fallback/i.test(source)) return "local";
  return "audit";
};
export const getVerificationLevel = (row: OwnerAuditLog) => String(row.metadata?.verificationLevel || row.metadata?.freshnessSource || row.metadata?.source || row.executionSource || getLogPlane(row));
