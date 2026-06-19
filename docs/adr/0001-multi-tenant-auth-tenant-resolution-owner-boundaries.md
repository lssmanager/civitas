# ADR 0001: Multi-tenant auth, tenant resolution, and owner/global boundaries

- Status: Accepted
- Date: 2026-06-18
- Owners: Civitas architecture / GitHub planning
- Related issues: #91, #90, #87, #89, #30, #92, #93

## Context

Civitas needs to support B2B tenant entry with organization-specific subdomains such as `colegio-a.learnsocialstudies.com`, while preserving a strict separation between:

- global product administration
- tenant-scoped administration
- tenant member access
- backend administrative actions executed through Logto Management API

The product must give each organization the perception of an exclusive app experience while still operating as a single multi-tenant platform.

The architecture must also avoid these incorrect patterns:

- one deployment per organization
- one Cloudflare Tunnel per organization
- one reverse-proxy route manually added per organization
- one Logto application per organization as the default model
- owner global treated as implicit member of all organizations
- WordPress session treated as the SSO source for Moodle

## Fuente canónica por dominio

- **Logto**: identity, authentication, organizations, memberships, roles, permissions, enterprise connectors, login branding, and tokens.
- **FluentCRM / WordPress**: commercial relationship, purchase, renewal, plan, and commercial status.
- **Moodle**: courses, enrollments, progress, and academic history.
- **BuddyBoss**: groups and community.
- **Civitas database / middleware**: subdomain mapping, operational metadata, seat policy, branding configuration, audit trail, synchronization status, retries, and cross-system business rules.

## What must not live canonically in PostgreSQL

Civitas must not create local canonical duplicates of:

- organizations already defined in Logto
- roles already defined in Logto
- memberships already defined in Logto
- identity or authentication state that belongs to Logto

Local records may mirror operationally useful identifiers, but they must be anchored to `logto_organization_id` and must not become a parallel source of truth.

## Decision

Civitas will implement multi-tenant authentication and tenant entry using a **single shared application runtime** with **host-based tenant resolution**, **organization-aware login in Logto**, and **strict boundary separation between owner global and tenant-scoped operations**.

### 1. Tenant entry is resolved in Civitas, not in Logto

The public entry URL for a tenant is an operational concern of Civitas.

For example:

- `colegio-a.learnsocialstudies.com`
- `colegio-b.learnsocialstudies.com`

Civitas resolves the incoming hostname to a local organization record and then maps that record to `logto_organization_id`.

Logto organizations do **not** store the tenant entry URL as a native organization property for this architecture. Logto is used to authenticate and render organization-aware login, but the entry door is controlled by Civitas.

### 2. Civitas uses a single deployment and wildcard host strategy

The platform will use:

- wildcard DNS for `*.learnsocialstudies.com`
- a single Cloudflare Tunnel or equivalent edge pattern
- a single reverse proxy layer
- a single frontend/backend deployment

The reverse proxy accepts wildcard hosts and forwards the request to the same Civitas runtime. Tenant resolution then happens in application code based on `Host` or trusted forwarded headers.

This means onboarding a new organization must **not** require:

- a new deploy
- a new tunnel
- a new container
- a new proxy rule per tenant

### 3. Login is initiated in Logto with organization context

After resolving the tenant from the hostname, Civitas starts authentication against Logto with the resolved `organization_id`.

This enables:

- organization-aware login branding
- future enterprise SSO routing
- tenant-aware membership validation
- correct organization token workflows when needed later

The email entered by the user must not be the primary mechanism for determining tenant identity. The hostname is the primary entry signal.

### 4. Branding is presentation, not authorization

Tenant branding may exist in both Civitas and Logto, but it must never be used as a permission signal.

Branding may include:

- display name
- logo / dark logo
- favicon
- color tokens
- login experience branding

A user does not gain access to a tenant because the screen shows that tenant's colors or logo. Final access remains subject to organization membership, seat policy, and commercial status checks.

### 5. Enterprise SSO is organization-scoped and controlled by Civitas

Enterprise SSO for Google Workspace or Microsoft Entra ID is allowed only as an organization-scoped capability governed by Civitas configuration and Logto enterprise connectors.

Enterprise SSO authenticates identity, but does not replace:

- membership validation
- seat validation
- commercial status validation
- downstream provisioning into Moodle or BuddyBoss

JIT provisioning must not be enabled as an unrestricted default. If enabled later, it must be controlled, auditable, and bounded by tenant policy.

### 6. Owner global is not a tenant member by default

Civitas will preserve the architectural distinction between:

- **owner global**
- **organization admin**
- **organization member**

Owner global capabilities are product-level capabilities and must be authorized using global product permissions and global access tokens. They must not require the owner to become a member of each organization.

Tenant-scoped operations must use organization context and, when applicable, organization-scoped permissions or organization tokens.

Backend administrative operations against Logto Management API are a separate layer again. The backend may create or synchronize organizations using machine-to-machine credentials without turning owner global into a tenant member.

### 7. WordPress and Moodle participate in SSO through Logto, not through session sharing

Civitas adopts centralized SSO through Logto.

That means:

- WordPress authenticates through Logto
- Moodle authenticates through Logto
- Civitas authenticates through Logto

WordPress does not hand its internal session to Moodle. Each application creates its own local session after delegating authentication to the same identity provider.

## Architecture implications

### Runtime model

Civitas must support runtime configuration such as:

- `PUBLIC_BASE_DOMAIN`
- `TENANT_HOST_MODE=subdomain`
- `TRUST_PROXY=true`
- public URLs for app, API, and auth when applicable

The backend must validate trusted hosts and reject unrecognized hostnames.

### Data model implications

Civitas may maintain local operational state such as:

- `subdomain`
- `primary_hostname`
- `logto_organization_id`
- branding config
- enterprise SSO config
- seat policy
- sync status
- audit log

These records exist to operate the platform, not to replace Logto as the canonical identity model.

### API boundary implications

Owner endpoints must be product-global, for example:

- owner creates or updates `Subdominio app`
- owner manages branding config
- owner configures enterprise SSO

These endpoints must be guarded by global owner permissions and must not require organization tokens.

Tenant-scoped endpoints must validate organization scope explicitly and must never infer authority from global ownership alone.

## Consequences

### Positive consequences

- New organizations can be onboarded without infrastructure proliferation.
- Tenant entry UX feels dedicated while retaining shared SaaS economics.
- Logto remains the canonical identity and organization system.
- Owner/global capabilities stay cleanly separated from tenant administration.
- Enterprise SSO can be added without changing the base tenant-entry model.

### Tradeoffs

- Civitas must own tenant resolution logic explicitly.
- Host validation and forwarded-header trust become security-critical.
- Branding and enterprise SSO require careful sync between local config and Logto.
- Tenant-aware post-login validation is mandatory; authentication success alone is not enough.

## Alternatives considered

### Alternative A: one Logto application per tenant

Rejected as the default architecture.

Reason:

- multiplies configuration and operational overhead
- makes onboarding slower
- is unnecessary for the target shared-runtime model

### Alternative B: one deployment or tunnel per tenant

Rejected.

Reason:

- causes infrastructure sprawl
- contradicts the intended multi-tenant platform design
- creates unnecessary redeploy and routing work

### Alternative C: derive tenant primarily from user email domain

Rejected as the primary routing model.

Reason:

- delays tenant resolution until after user input
- weakens the dedicated-app experience
- introduces ambiguity for multi-org users or mixed-domain cases

### Alternative D: make owner global a member of every tenant

Rejected.

Reason:

- collapses product-level and tenant-level authorization boundaries
- complicates future impersonation, auditing, and permission models

## Implementation guidance

This ADR is implemented incrementally through the current backlog:

- #90 defines the owner-side persistence and API for `Subdominio app`
- #87 defines tenant resolution and organization-aware login bootstrap
- #89 defines organization branding in Civitas and Logto
- #30 defines controlled enterprise SSO by organization
- #92 defines Cloudflare wildcard, reverse proxy, and runtime configuration
- #93 defines the owner UI to operate these capabilities
- #91 groups the phase and its sequencing

## Review rule

Any future design, issue, PR, or prompt touching multi-tenancy, authentication, tenant entry, organization login, owner operations, or enterprise SSO must be checked against this ADR.

If a proposal:

- treats owner global as implicit member of all organizations
- duplicates Logto organizations canonically in PostgreSQL
- uses branding as authorization
- requires one deployment or tunnel per tenant
- makes tenant resolution depend primarily on email entry

it should be considered architecturally incorrect unless it includes explicit justification and a superseding ADR.
