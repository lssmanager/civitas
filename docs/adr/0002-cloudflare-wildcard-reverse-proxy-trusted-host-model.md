# ADR 0002: Cloudflare wildcard, reverse proxy, and trusted host model

- Status: Accepted
- Date: 2026-06-18
- Owners: Civitas architecture / GitHub planning
- Related issues: #92, #91, #87, #90

## Context

Civitas needs to expose many tenant-specific subdomains such as:

- `colegio-a.learnsocialstudies.com`
- `colegio-b.learnsocialstudies.com`
- `institucion-z.learnsocialstudies.com`

These hostnames must all reach the same Civitas application runtime without creating per-tenant infrastructure.

At the same time, host-based tenant resolution becomes a security-sensitive concern because the application will make authentication and routing decisions based on the incoming hostname.

The architecture therefore needs a stable operational model that defines:

- how wildcard public entry works
- how traffic reaches the same origin
- how the reverse proxy forwards tenant-relevant headers
- which hosts Civitas trusts
- how Civitas rejects unrecognized hosts

## Fuente canónica por dominio

- **Cloudflare**: edge entry, wildcard DNS, Tunnel exposure, and public ingress.
- **Reverse proxy**: host matching, trusted forwarding, and delivery to the runtime.
- **Civitas runtime**: trusted host validation, tenant resolution, and request handling.
- **Logto**: authentication and identity, but not public wildcard routing.

## What must not live canonically in PostgreSQL

PostgreSQL must not be treated as the source of truth for:

- Cloudflare edge rules
- reverse-proxy topology
- trusted proxy network boundaries

The database may store tenant host mappings such as `subdomain` and `primary_hostname`, but not infrastructure truth as a substitute for deployed routing.

## Decision

Civitas will use a **single wildcard ingress model** backed by **one shared origin**, a **single reverse-proxy layer**, and a **strict trusted-host validation model in the application runtime**.

### 1. Wildcard ingress is the default public exposure model

Civitas will expose tenant entry through wildcard subdomains under a controlled base domain, initially `*.learnsocialstudies.com`.

This requires:

- wildcard DNS for `*.learnsocialstudies.com`
- one Cloudflare Tunnel or equivalent edge path to the shared origin
- support for fixed product hostnames such as `www`, `api`, and `auth` according to product topology

New tenants must not require individual DNS onboarding under the shared wildcard model.

### 2. All tenant subdomains point to the same runtime

The public edge and reverse proxy must forward all supported tenant subdomains to the same Civitas application runtime.

Civitas resolves the tenant in application code after the request reaches the runtime.

This means the infrastructure must not depend on:

- one router per tenant
- one tunnel per tenant
- one container per tenant
- one deployment per tenant

### 3. Reverse proxy preserves hostname and forwarding headers

The reverse proxy must preserve the original host information needed for tenant resolution.

At minimum it must pass:

- `Host`
- `X-Forwarded-Host`
- `X-Forwarded-Proto`
- `X-Forwarded-For`

The proxy configuration must be wildcard-compatible and must not require manual per-tenant routing rules when all tenants map to the same runtime.

### 4. Civitas enforces a trusted host model

Civitas must treat host-based tenancy as a trusted-input problem.

The runtime must:

- know the allowed base domain or domains
- validate that the incoming host belongs to an allowed public host pattern
- reject unsupported or unexpected hosts
- avoid trusting raw forwarded headers unless `TRUST_PROXY` is explicitly enabled and the proxy boundary is known

Tenant resolution must occur only after the host has passed trusted-host validation.

### 5. Tenant resolution is not delegated to Cloudflare or the proxy

Cloudflare and the reverse proxy only provide shared ingress and forwarding.

They do not decide:

- which organization the user belongs to
- whether a subdomain is active in business terms
- whether branding should be shown
- whether login should proceed
- whether access is allowed after authentication

Those concerns belong to Civitas.

### 6. Host-based routing is primary; query or email routing is not

Production tenant resolution must be based primarily on the hostname.

The runtime must not depend on:

- query parameters like `?tenant=` as the primary production routing signal
- user email entry as the primary tenant-entry mechanism

These can be used only as secondary, diagnostic, or future fallback tools if explicitly designed.

## Architecture implications

### Runtime configuration

Civitas should expose a clear runtime contract, including values such as:

- `PUBLIC_BASE_DOMAIN`
- `TENANT_HOST_MODE=subdomain`
- `TRUST_PROXY=true|false`
- public URLs for application, API, and auth services when applicable
- optional lists of additional fixed allowed hosts

The runtime must fail safely or reject requests when host validation cannot be established.

### Proxy configuration implications

The reverse proxy must be configured using wildcard-compatible host matching, for example through:

- host regular expressions or wildcard rules in Traefik
- regex `server_name` patterns in Nginx
- equivalent patterns in another supported reverse proxy

The chosen proxy is less important than the preserved contract:

- wildcard host acceptance
- single shared origin
- header preservation
- no per-tenant infrastructure churn

### Security implications

Host validation becomes a first-class security control.

Civitas must defend against:

- open host header abuse
- forged forwarded host headers when proxy trust is misconfigured
- accidental processing of unexpected domains
- ambiguous hostnames that do not belong to the expected base domain

### Observability implications

The runtime should log at least:

- incoming hostname
- forwarded hostname when trusted
- tenant-resolution outcome
- trusted-host validation result
- rejection reason for invalid hosts

## Consequences

### Positive consequences

- Tenant onboarding remains operationally lightweight.
- Shared SaaS economics are preserved.
- The infrastructure model stays simple and predictable.
- Tenant-entry UX remains compatible with organization-aware login and branding.

### Tradeoffs

- Trusted host validation must be implemented carefully.
- The application runtime becomes responsible for a critical part of request security.
- Deployment documentation must be explicit to avoid environment-specific drift.

## Alternatives considered

### Alternative A: one Cloudflare Tunnel or app per tenant

Rejected.

Reason:

- causes infrastructure sprawl
- increases onboarding cost and manual work
- contradicts the intended shared-runtime model

### Alternative B: one reverse-proxy router per tenant

Rejected.

Reason:

- operationally brittle
- unnecessary under wildcard tenancy
- scales poorly with tenant growth

### Alternative C: trust any incoming host and resolve later from the database

Rejected.

Reason:

- weakens security
- expands attack surface through host-header abuse
- blurs the boundary between supported and unsupported public hosts

## Implementation guidance

This ADR is implemented through the current backlog:

- #92 defines the base Cloudflare, reverse proxy, and runtime configuration pattern
- #90 provides the owner-side model for `Subdominio app`
- #87 consumes trusted host information to perform tenant resolution and login bootstrap
- #91 groups the phase and sequencing

## Review rule

Any future design, issue, PR, or deployment change touching public ingress, wildcard routing, reverse-proxy behavior, or host-based tenant resolution must be checked against this ADR.

If a proposal:

- requires one tunnel, deploy, or router per tenant
- trusts arbitrary forwarded hosts without an explicit proxy trust model
- resolves tenants before validating that the host is supported
- relies primarily on query params or email entry for production tenant routing

it should be considered architecturally incorrect unless a new ADR explicitly supersedes this one.
