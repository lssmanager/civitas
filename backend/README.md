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


## Production migrations

The production `npm start` command runs `node scripts/migrate.js` before `node index.js`.
This applies pending Drizzle SQL migrations from `backend/drizzle` using the same `DATABASE_URL` that the API uses, so deploys create tables such as `users` before protected endpoints like `GET /me` query them.

To run migrations manually from the backend container or a local shell with `DATABASE_URL` set:

```bash
npm run migrate
```

## Autorización owner global

Desde Fase 05, el portal owner usa Logto RBAC sobre el API Resource global de Civitas (`LOGTO_API_RESOURCE_INDICATOR`) como fuente de verdad de autorización. PostgreSQL mantiene el usuario interno y los datos de producto, pero `users.global_role` queda como campo legacy/deprecated y ya no autoriza `/owner`.

Configura en Logto el API Resource:

```text
https://civitas.socialstudies.cloud/api
```

Permisos/scopes esperados para esta fase:

- `owner:read` para `GET /owner/me`.
- `organizations:read` para `GET /owner/organizations`.
- `organizations:create` para `POST /owner/organizations`.

Crea/asigna el rol global de usuario `owner_global` en Logto con esos permisos y asígnalo al usuario owner. Al recrear la DB de preview/dev, el owner conserva acceso porque los scopes vienen en el access token de Logto; no hace falta reescribir `users.global_role`.

El script `grant-owner` queda solo como herramienta legacy de diagnóstico/migración para instalaciones antiguas que todavía tengan datos en `users.global_role`; no es el mecanismo oficial de autorización owner para Fase 05.
