# Architecture Decision Records

Este directorio reúne decisiones arquitectónicas estables de Civitas que deben guiar el backlog, la implementación y la revisión técnica.

## ADRs actuales

- [ADR 0001: Multi-tenant auth, tenant resolution, and owner/global boundaries](./0001-multi-tenant-auth-tenant-resolution-owner-boundaries.md)
- [ADR 0002: Cloudflare wildcard, reverse proxy, and trusted host model](./0002-cloudflare-wildcard-reverse-proxy-trusted-host-model.md)
- [ADR 0003: Organization branding sync between Civitas and Logto](./0003-organization-branding-sync-between-civitas-and-logto.md)

## Uso esperado

Cada ADR debe servir como regla de revisión para:

- diseño de arquitectura
- issues técnicos
- implementación backend y frontend
- revisiones de PR
- decisiones de integración con Logto, Cloudflare, Moodle, BuddyBoss y FluentCRM

Si una propuesta contradice un ADR aceptado, debe justificarse explícitamente y, si corresponde, proponer un nuevo ADR que lo sustituya.
