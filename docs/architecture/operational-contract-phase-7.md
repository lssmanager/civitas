# Civitas operational backbone — Phase 7 / issue #181

Phase 7 hardens the operational backbone so future RBAC, connector registry work (#186), capability adapters (#184), payments and MCP-like tooling do not reintroduce isolated backend, worker or UI contracts.

## Standard action catalog

The canonical machine-readable catalog lives in `backend/services/operational/actionCatalog.js` and is mirrored in frontend contract constants. It is additive: new actions may be introduced as strings, but existing meanings cannot be changed in place.

| Action | When to use | Backend interpretation | Frontend interpretation |
| --- | --- | --- | --- |
| `retry` | Retryable worker/provider/downstream failure. | Enqueue through standard operational retry with idempotency/retryability checks. | Show retry CTA only when authorized; otherwise diagnostic. |
| `verify_provider` | Stale, degraded, failed or unknown provider state. | Run capability/provider verification and record freshness/provider status. | Render refresh/verify provider, not an implicit mutation. |
| `open_organization` | A block references a concrete organization. | Include as navigation metadata only; it never grants access. | Navigate to organization console while preserving scope boundaries. |
| `wait_first_wordpress_login` | WordPress linkage is pending first login. | Waiting diagnostic, not retryable failure. | Explain pending state and avoid retry-only UX. |
| `manual_retry_required` | Retry needs operator remediation first. | Do not auto-enqueue; require manual resolution metadata. | Show privileged/manual remediation. |
| `human_action_required` | Policy/data/provider condition needs a person. | Attach safe policy details without local permission canon. | Highlight blocker and route to the proper operational surface. |
| `none` | Healthy or no useful action exists. | Fallback only when no action applies. | Render no CTA/passive state. |

## Contract versioning strategy

`contractVersion` is a platform compatibility signal. Current version: `2026-06-issue-181-phase-7`. `contractMetadata` carries `actionCatalogVersion`, backward compatibility and the extension policy so versioning is visible in code/schema, not only prose.

Compatible changes:

- add optional top-level blocks such as `capabilities`, `seats`, `provisioningPolicies`, `impersonation`, `advancedRbacDiagnostics`, `externalTools` or `authorizationContext`;
- add fields inside `details`, `runtime`, `compatibility`, `contractMetadata` or future block objects;
- add new action strings while preserving the existing catalog semantics;
- add new provider codes/statuses that consumers can display as diagnostics.

Breaking changes:

- removing or renaming required phase-1/phase-7 fields;
- changing the meaning of an existing action, freshness source or severity in a non-compatible way;
- changing canonical ownership (for example making PostgreSQL authoritative for Logto permissions);
- requiring existing consumers to understand a new block/action before they can safely render the current contract.

Breaking changes require a new major/versioned surface or negotiated endpoint. Examples and schema validation must be updated in the same PR as contract changes.

## Extensibility conventions

Future blocks are additive and should use `OperationalBlock` shape where operational state is exposed. Recommended names:

- `seats`: license/seat counts and allocation diagnostics;
- `provisioningPolicies`: policy decisions and required manual remediations;
- `impersonation`: audited support/owner impersonation availability and safety status;
- `advancedRbacDiagnostics`: derived diagnostics for Logto roles, memberships and permission gaps;
- `externalTools`: MCP-like/tooling capability status and actions;
- `authorizationContext`: read-only authorization hints derived from Logto tokens/Management API.

Absence means “not implemented/not applicable”, not failure. Consumers must ignore unknown blocks and unknown actions that they cannot render.

## RBAC growth without duplicate canon

Logto remains canonical for users, organizations, memberships, global roles, organization roles and permissions. Civitas PostgreSQL may store only operational state, retries, action outcomes, policy metadata and compatibility diagnostics.

RBAC surfaces must distinguish:

- **owner global capabilities**: global owner/operator actions over operational tooling and cross-tenant diagnostics;
- **organization admin actions**: tenant-scoped actions allowed by Logto organization roles/permissions;
- **organization member diagnostics**: visible read-only diagnostics appropriate to the member context.

Future RBAC UI, worker checks and tooling must read the same operational contract and adapter diagnostics instead of creating separate action maps or PostgreSQL permission models.

## Capability + contract + adapter + observability

Every new capability must declare:

1. functional capability name (`payments`, `lms`, `crm`, `community`, `notifications`, `seats`, `reporting`, tooling, etc.);
2. provider(s) via connector registry (#186);
3. standard input/output schemas;
4. provider adapter (#184);
5. operational block(s) using status, severity, provider status, freshness, invalidation and standard actions;
6. canonical source boundaries.

`payments` must preserve commercial canon: payment provider(s) own payment processor state, FluentCRM/WordPress remain downstream commercial/operational systems where applicable, and Civitas stores only operational synchronization, action results, retries and diagnostics.

## Legacy endpoint compatibility matrix

| Endpoint/surface | Phase 7 status | Guidance |
| --- | --- | --- |
| `GET /owner/organizations/:organizationId/operational-state` | Primary operational backbone | New operational surfaces consume this first. |
| Organization profile console data | Primary for editable profile fields; secondary for operational state | Use for profile editing, but operational cards should read the backbone. |
| Pending sync / provider verification endpoints | Secondary/debug or action-specific fallback | Keep for existing flows; fold diagnostics into operational blocks over time. |
| Owner audit/events/logs | Primary audit history; secondary for current state | Keep as event history and troubleshooting, not current-state contract. |
| Worker/queue health aggregate | Primary system health; input to backbone | Continue feeding worker blocks and polling decisions. |
| Future RBAC/capability/tooling endpoints | Must consume/extend backbone | No ad hoc operational contracts; add compatible blocks/actions or version intentionally. |

No destructive deprecation occurs in Phase 7. The map is a soft-deprecation plan: migrate display/current-state consumers to the consolidated backbone while retaining specialized endpoints for mutation, audit history and debug detail.

## Follow-ups

- #184 should implement concrete capability adapter interfaces using this contract grammar.
- #186 should publish connector registry metadata that maps capability/provider/adapters into discoverable operational blocks.
- Future payments/RBAC work should add blocks and schemas additively, with examples and compatibility tests in the same change.
