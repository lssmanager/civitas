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

## Principle: modular capabilities with standard operational contracts

Civitas must evolve as a platform of modular capabilities, not as a collection of isolated integrations.

Each new capability in the system, for example `payments`, `lms`, `crm`, `community`, `notifications`, `seats`, `reporting` or future operational capabilities, must be introduced through a common pattern composed of:

- an explicit functional contract
- standard input/output schemas
- adapters per provider or external system
- standard observability
- reusable actions, freshness, invalidation and diagnostics
- a coherent operational surface for backend, worker, UI and future tooling

### Core rule

No new capability may introduce its own operational language, an ad hoc error model, an isolated retry system or an API shape incompatible with the common Civitas backbone.

Every capability must integrate using the same operational grammar already defined for the platform.

### Initial connector capabilities catalog

The initial capabilities catalog for Civitas should be treated as a stable platform registry that can grow over time without breaking the backbone:

```yaml
connectors:
  identity:
    description: Logto and future IdP/auth providers

  lms:
    description: Moodle, Canvas, other LMS providers

  crm:
    description: FluentCRM, HubSpot, other CRM providers

  community:
    description: BuddyBoss and future community platforms

  payments:
    description: Stripe, MercadoPago, Bancolombia, PayPal

  email:
    description: Resend, SendGrid, SES, Postmark

  support:
    description: Zendesk, Freshdesk, HelpScout

  scheduling:
    description: Calendly, Google Calendar, Microsoft 365

  notifications:
    description: email, push, SMS and in-app delivery adapters

  storage:
    description: S3-compatible, Cloudflare R2 and local object storage

  analytics:
    description: PostHog, GA4 and internal event pipeline
```

This catalog is not a commitment to implement every provider immediately. It is the reference map for how new capabilities should enter Civitas: by contract, adapter and shared operational semantics rather than by isolated feature-specific integrations.

### Separation between capability and provider

A capability represents a stable product need.
A provider represents one concrete implementation of that capability.

Examples:

- capability `payments`
  - Stripe
  - MercadoPago
  - Bancolombia
  - PayPal
- capability `lms`
  - Moodle
  - Canvas
- capability `crm`
  - FluentCRM
  - HubSpot
- capability `community`
  - BuddyBoss
  - another future platform

The application should speak to the capability through standard contracts; provider-specific details must remain encapsulated inside adapters.

### Relationship with the operational backbone

Every capability integrated in Civitas should be able to expose, when applicable:

- `status`
- `severity`
- `humanMessage`
- `providerCode`
- `providerStatus`
- `nextAction`
- `availableActions`
- `freshness`
- `invalidation`
- live vs snapshot diagnostics
- progress by operation or by entity

This guarantees that backend, worker, UI and future surfaces consume the same operational grammar.

### MCP-like tooling surface

Civitas should remain ready for a composed operational surface, MCP-like in spirit, where internal or external tools can inspect, trigger and chain capabilities through standard contracts rather than ad hoc integrations.

That means:

- capabilities should be discoverable by contract
- actions should be explicit and typable
- states should be observable in a uniform way
- growth should be additive and versionable

### Canonical restriction

Adopting modular capabilities does not change the canonical source by domain.
Each capability must respect the corresponding canonical source and must not duplicate it in PostgreSQL.

### Practical implication

From this principle onward, every new integration or module proposed for Civitas must answer explicitly:

1. what the functional capability is
2. what its standard contract is
3. which system or provider implements it through an adapter
4. how it exposes operational state using the common backbone
5. which canonical source it respects
6. how it extends without breaking consumers

### Summary formula

Civitas grows by:

`stable capability + standard contract + adapter per system + standard observability + reusable actions`

and not by isolated integrations coupled to each other.

## Compatibility and next migration

Legacy fields remain in `/profile`, `/pending-sync`, `/events`, and owner list projections. The new endpoint is the future source for consolidated state. Subsequent phases should migrate owner cards, provider verification panels and polling logic to this endpoint while preserving existing retry and audit APIs until they are folded into explicit operations tooling.

## Phase 7 hardening

Issue #181 is captured in `docs/architecture/operational-contract-phase-7.md`. That document is now the operational source for the standard action catalog, contract versioning semantics, additive extension conventions, RBAC growth guidance, capability/adapter/connector-registry alignment, payments integration rule and the soft-deprecation matrix for legacy endpoints.
