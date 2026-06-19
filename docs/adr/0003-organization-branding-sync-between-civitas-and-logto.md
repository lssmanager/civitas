# ADR 0003: Organization branding sync between Civitas and Logto

- Status: Accepted
- Date: 2026-06-18
- Owners: Civitas architecture / GitHub planning
- Related issues: #89, #93, #91, #87, #30

## Context

Civitas needs each organization to feel like it is entering its own application experience, especially when using tenant-specific subdomains such as `colegio-a.learnsocialstudies.com`.

That experience spans at least two rendering surfaces:

- **Civitas** itself, including pre-login tenant entry, shell layout, favicon, and in-app tenant presentation
- **Logto**, including the organization-aware login experience and enterprise SSO entry flows

Because both surfaces can display organization branding, the platform needs a stable rule for:

- where branding configuration lives operationally
- how it is synchronized
- which system renders which parts
- how fallback works when branding is incomplete
- how branding remains separate from authorization

## Fuente canónica por dominio

- **Logto**: login experience rendering, organization-aware authentication flows, and authentication-surface branding.
- **Civitas database / middleware**: operational branding configuration, asset references, sync status, and owner-controlled branding workflow.
- **FluentCRM / WordPress**: optional commercial source for suggested logo or website metadata, not authoritative runtime branding.
- **Moodle / BuddyBoss**: downstream user-facing systems that may later consume branding cues, but are not the authority for tenant brand state.

## What must not live canonically in PostgreSQL

PostgreSQL must not become a duplicate source of truth for:

- identity or authentication state
- organization permissions
- authorization logic derived from branding

Local branding configuration exists to operate the Civitas and Logto experience, not to replace Logto's identity model or security model.

## Decision

Civitas will treat **local branding configuration as the operational source of truth**, and will synchronize the relevant subset of that configuration to Logto for authentication-surface rendering.

### 1. Branding has two rendering surfaces and one operational source

Branding exists in two places visually:

- Civitas renders tenant branding in the application experience
- Logto renders tenant branding in the login experience

However, Civitas will maintain the editable operational configuration so that product operators do not have to manage duplicate manual branding states in both systems.

### 2. Branding is anchored to the organization through `logto_organization_id`

Every organization branding record must be tied to the corresponding Civitas organization and to `logto_organization_id`.

This prevents branding from floating independently of the canonical organization model.

### 3. Branding is presentation, not authorization

Branding must never be used as a security or permission signal.

The presence of:

- a logo
- a tenant-specific color palette
- a favicon
- an organization display name

must not imply:

- valid membership
- valid organization context
- valid seat entitlement
- valid commercial status

Those remain separate checks.

### 4. Tenant branding must resolve before login begins

When a user enters through a tenant subdomain, Civitas resolves the tenant first and then loads the organization branding for the current host.

The tenant experience must not wait for the user to type an email before showing the correct visual context.

### 5. Logto branding is driven by organization-aware login

Logto organization branding is rendered only when Civitas starts login with organization context.

That means:

- tenant resolution must happen first in Civitas
- Civitas starts login with `organization_id`
- Logto then renders the organization-aware login surface

Branding sync is meaningful only within that organization-aware authentication flow.

### 6. Civitas owns fallback behavior

If organization branding is incomplete or sync to Logto has not completed, Civitas must define deterministic fallback behavior.

Fallback order:

1. organization-specific branding
2. Civitas product-default branding
3. system-safe minimal fallback

The UI must not break or show blank states because one branding asset is missing.

### 7. Sync failures must not destroy local configuration

When sync to Logto fails, Civitas keeps the local branding configuration as the current operational record and records sync failure state.

This means:

- local save can succeed
- sync status can be `failed`
- operators can retry sync
- audit entries record the failure

The platform should avoid blocking all local edits just because the external sync step failed.

### 8. External systems may suggest branding but do not override it automatically

WordPress or FluentCRM may provide a website URL, company name, or a logo candidate.

These inputs may be used as:

- suggestions
- prefill values
- onboarding aids

They must not automatically overwrite approved tenant branding without an explicit owner-controlled workflow.

## Architecture implications

### Data model implications

Civitas should keep operational branding data such as:

- display name
- logo reference
- dark logo reference
- favicon reference
- color tokens
- optional controlled CSS extensions if ever allowed
- sync status, sync error, sync timestamp
- update actor and audit metadata

### Frontend implications

Civitas should load branding before rendering the tenant shell.

The frontend should:

- resolve tenant from the current host
- load branding for that tenant
- apply favicon and theme tokens
- avoid flash-of-wrong-branding between tenants
- expose clear fallback behavior when branding is incomplete

### Backend implications

The backend should:

- store the editable branding configuration
- validate assets and branding inputs
- expose owner-global APIs to manage branding
- translate local branding into the subset that Logto accepts
- manage retries and sync status

### Owner workflow implications

Branding management belongs to owner-global product administration in the current architecture.

This keeps tenant-entry, branding, and enterprise SSO governance in the same operational surface and avoids distributing cross-tenant configuration into tenant-scoped administration too early.

## Consequences

### Positive consequences

- Operators manage branding in one place.
- Civitas and Logto present a more coherent tenant experience.
- The architecture avoids manual drift between local UI branding and login branding.
- The system remains resilient when external sync temporarily fails.

### Tradeoffs

- Sync logic must be maintained explicitly.
- Asset validation and storage become product concerns.
- The platform must define clear fallback behavior to avoid confusing cross-surface inconsistencies.

## Alternatives considered

### Alternative A: manage branding only inside Logto

Rejected.

Reason:

- does not cover the Civitas application shell adequately
- creates friction for owner-side operations
- weakens the ability to show tenant branding before login bootstrap inside Civitas

### Alternative B: manage branding separately in Civitas and Logto by hand

Rejected.

Reason:

- creates drift risk
- duplicates operational work
- makes troubleshooting much harder

### Alternative C: let CRM or website metadata override runtime branding automatically

Rejected.

Reason:

- branding approval is a product concern, not just a commercial-data concern
- automatic overwrite can break carefully curated tenant identity

## Implementation guidance

This ADR is implemented through the current backlog:

- #89 defines the branding data model, sync flow, and tenant-aware frontend behavior
- #93 defines the owner UI used to manage branding
- #87 provides the tenant-resolution prerequisite for host-aware branding loading
- #30 depends on coherent branding for enterprise SSO flows
- #91 groups the phase and sequencing

## Review rule

Any future design, issue, PR, or prompt touching organization branding in Civitas or Logto must be checked against this ADR.

If a proposal:

- makes branding a permission signal
- requires operators to manage branding separately in Civitas and Logto with no sync model
- lets CRM metadata overwrite approved branding automatically
- defers tenant branding until after email entry instead of host-based tenant resolution

it should be considered architecturally incorrect unless a superseding ADR is accepted.
