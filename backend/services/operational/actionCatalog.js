const OPERATIONAL_ACTION_CATALOG_VERSION = "2026-06-issue-181-action-catalog-v1";

const OPERATIONAL_ACTION_DEFINITIONS = Object.freeze({
  retry: Object.freeze({
    action: "retry",
    semantics: "Request another execution attempt for a retryable operational failure or terminal failure that can be replayed safely.",
    useWhen: "A worker operation, provider sync or downstream step is retryable and does not require prior human remediation.",
    backend: "Expose only when the target operation is known, retryable, idempotent or guarded by an idempotency key; enqueue through the standard operational retry path.",
    frontend: "Render as an explicit retry CTA when the current user is allowed to trigger operational retries; otherwise show it as an available diagnostic action.",
  }),
  verify_provider: Object.freeze({
    action: "verify_provider",
    semantics: "Refresh provider truth through a live or near-live provider check without asserting local canon.",
    useWhen: "A block is stale, degraded, failed, unknown or needs confirmation from Logto, FluentCRM, WordPress or another adapter/provider.",
    backend: "Route through the capability/provider adapter verification path and record freshness, providerCode and providerStatus.",
    frontend: "Render as refresh/verify provider; do not imply data mutation unless the endpoint explicitly documents a mutation.",
  }),
  open_organization: Object.freeze({
    action: "open_organization",
    semantics: "Navigate to the organization operational surface anchored by Logto organization id.",
    useWhen: "The block references a concrete organization and the user can inspect tenant-scoped state.",
    backend: "Include when organizationId/logtoOrganizationId is available; never use it to grant tenant access by itself.",
    frontend: "Navigate to the organization console or deep link; preserve global owner and organization-scoped boundaries.",
  }),
  wait_first_wordpress_login: Object.freeze({
    action: "wait_first_wordpress_login",
    semantics: "No immediate system action is required until a first WordPress login creates/links downstream state.",
    useWhen: "WordPress user linkage is legitimately pending first login rather than failed provisioning.",
    backend: "Represent as waiting/pending diagnostic state, not as retryable failure.",
    frontend: "Show explanatory pending copy and avoid retry CTAs unless another action is also present.",
  }),
  manual_retry_required: Object.freeze({
    action: "manual_retry_required",
    semantics: "A retry might be possible but only after manual operator review or correction.",
    useWhen: "Automatic retry is unsafe because data conflict, missing provider precondition or policy review is required.",
    backend: "Do not enqueue automatically; expose diagnostics and require explicit manual resolution metadata.",
    frontend: "Show operator-facing remediation and avoid one-click retry unless a privileged manual flow is active.",
  }),
  human_action_required: Object.freeze({
    action: "human_action_required",
    semantics: "A human must resolve a policy, data or provider condition before the system can progress.",
    useWhen: "The next step is outside automatic worker control or needs owner/admin/operator decision.",
    backend: "Attach safe details and policy metadata without creating a local authorization canon.",
    frontend: "Highlight as a blocking/manual action and link to the relevant operational surface when available.",
  }),
  none: Object.freeze({
    action: "none",
    semantics: "No actionable recommendation is available for this block.",
    useWhen: "The block is healthy, informational, or all useful actions are intentionally unavailable.",
    backend: "Use as fallback only when no other action applies.",
    frontend: "Render no CTA or a passive healthy/informational state.",
  }),
});

const ACTIONS = Object.freeze(Object.fromEntries(Object.keys(OPERATIONAL_ACTION_DEFINITIONS).map((action) => [action.toUpperCase(), action])));
const OPERATIONAL_ACTIONS = Object.freeze(Object.keys(OPERATIONAL_ACTION_DEFINITIONS));

function isKnownOperationalAction(action) {
  return typeof action === "string" && Object.hasOwn(OPERATIONAL_ACTION_DEFINITIONS, action);
}

function normalizeOperationalActionList(actions = []) {
  const normalized = [...new Set(actions.filter((action) => typeof action === "string" && action.length > 0))];
  return normalized.length ? normalized : [ACTIONS.NONE];
}

module.exports = { ACTIONS, OPERATIONAL_ACTIONS, OPERATIONAL_ACTION_CATALOG_VERSION, OPERATIONAL_ACTION_DEFINITIONS, isKnownOperationalAction, normalizeOperationalActionList };
