# Civitas operational backbone contract — Phase 1 / issue #175

`ConsolidatedOperationalResponse` is the canonical operational backbone for owner UI, backend, worker, observability and future RBAC/tooling surfaces. It is introduced at `GET /owner/organizations/:organizationId/operational-state` without replacing legacy profile, pending-sync or audit endpoints yet.

## Backbone and boundaries

Canonical sources stay separate: Logto owns identity, organizations, memberships, global roles and tenant roles; FluentCRM/WordPress owns companies, contacts, tags/lists and local WP user links when they exist; PostgreSQL owns operational runtime, snapshots, retries, audit trail and live verification results only. Local rows must anchor to `logto_organization_id` / `logto_user_id` and must not become parallel identity or authorization canon.

This pass formalizes the contract, schema, TypeScript types, examples and reusable backend assemblers. It does **not** migrate every UI screen, implement final RBAC, or replace all legacy endpoint shapes.

## Shape

The top-level response contains `organization`, `summary`, `canonical`, `fluentcrm`, `wordpress`, `worker`, `liveVerification`, `contactProgress`, `polling` and `latestEventIds`. Operational blocks share: `status`, `severity`, `humanMessage`, `providerCode`, `providerStatus`, `nextAction`, `availableActions`, `freshness` and `invalidation`.

## Freshness

`freshness.source` is one of `live_provider_check`, `worker_runtime`, `local_reconciled` or `persisted_snapshot`. `checkedAt` plus `staleAfterSeconds` produces `isStale`; live provider and worker blocks set `shouldAutoRefresh` when stale because those are safe to refresh/poll. `persisted_snapshot` is always stale fallback and must never be displayed as live verification.

## Invalidation

Blocks declare `invalidateOnOperationIds`, `invalidateOnStatuses`, `invalidatedAt` and `lastEventId`. Consumers should invalidate on queue-state changes, new relevant operations, and terminal/failure statuses for `provider_verification`, `fluentcrm_company` and `fluentcrm_contacts`.

## Dominance rules

1. `worker_runtime` dominates while an operation is active.
2. `live_provider_check` dominates `local_reconciled` when no active worker runtime supersedes it.
3. `persisted_snapshot` is fallback only.

These rules are implemented in backend helpers and frontend helper `dominanceRank`.

## Action model

The baseline action catalog is `retry`, `verify_provider`, `open_organization`, `wait_first_wordpress_login`, `manual_retry_required`, `human_action_required` and `none`. `nextAction` is the primary recommendation; `availableActions` is the complete compatible list. New actions may be appended as strings; consumers must ignore unknown actions they cannot render.

## Growth strategy

The contract supports new sub-blocks through additive top-level fields or `details` sub-objects, new actions through an extensible string action model, and future tooling/MCP-like surfaces by composing blocks rather than creating isolated helper responses. RBAC growth keeps owner-global capabilities separate from organization-scoped roles; the contract may add `authorizationContext` later without moving Logto authority into PostgreSQL.

## Compatibility and next migration

Legacy fields remain in `/profile`, `/pending-sync`, `/events`, and owner list projections. The new endpoint is the future source for consolidated state. Subsequent phases should migrate owner cards, provider verification panels and polling logic to this endpoint while preserving existing retry and audit APIs until they are folded into explicit operations tooling.
