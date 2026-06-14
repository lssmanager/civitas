# Civitas Backend

Backend Node/Express de Civitas para **Fase 02**.

## Alcance activo

Incluido en esta fase:

- `GET /health`: healthcheck de API y conectividad PostgreSQL.
- `GET /auth/test`: smoke test protegido para validar un access token JWT emitido por Logto para el API de Civitas.
- `requireAuth`: middleware compartido que valida JWT con JWKS remoto de Logto, issuer y audience/API resource indicator.
- Drizzle/PostgreSQL como infraestructura base mínima para fases posteriores.

Fuera del flujo actual:

- Organizaciones y membresías.
- Documentos.
- Organization tokens.
- Roles/permisos de dominio.
- Multi-tenancy de Civitas.

La infraestructura base de Express, Drizzle, PostgreSQL, Docker y variables `LOGTO_*` necesarias para validar JWT se conserva porque será necesaria para fases posteriores. El código heredado del sample multi-tenant de Logto que gestionaba tokens de Management API fue removido como limpieza de código fuera de alcance; no representa una decisión de producto sobre organizaciones o multi-tenancy.

## Variables principales

Copia `.env.example` y configura:

```bash
cp .env.example .env
```

Variables requeridas para `/auth/test`:

- `LOGTO_ISSUER`
- `LOGTO_JWKS_URL`
- `LOGTO_API_RESOURCE_INDICATOR`

`/health` solo requiere `DATABASE_URL`.

## Desarrollo

```bash
npm install
npm run dev
```

## Checks

```bash
npm test
```
