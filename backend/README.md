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

Production deploys must run migrations before starting the API. The backend Docker image does this with `npm run migrate && npm run start:api`, and platforms that deploy from the repository should use the same release/start sequence.

`npm run migrate` applies pending Drizzle SQL migrations from `backend/drizzle` using the same `DATABASE_URL` that the API uses, so deploys create tables such as `users`, `sync_operations`, and `sync_operation_steps` before protected endpoints like `GET /me` query them. `RUN_MIGRATIONS_ON_STARTUP` remains `false` by default; set it to `true` only on platforms that cannot run a separate release command.

To run migrations manually from the backend container or a local shell with `DATABASE_URL` set:

```bash
npm run migrate
```

## Bootstrap del primer owner global

La autorización owner global vigente es Logto-first: el portal owner y las APIs
owner se habilitan con scopes globales del API resource de Civitas, por ejemplo
`owner:read`, `owner:manage`, `organizations:read` y `organizations:create`.
No depende de pertenecer a una organization ni del rol de organización `Admin-org`.

`Admin-org` pertenece únicamente a la plantilla de organizaciones de Logto y se
usa durante el bootstrap tenant-scoped para asignar el rol inicial al miembro
base/creador dentro de la organización recién creada. Ese rol no reemplaza los
scopes globales owner.

Para bootstrap operativo del primer owner, asigna en Logto los scopes globales
del API resource de Civitas al usuario/rol global correspondiente y fuerza una
renovación de sesión para que el access token incluya dichos scopes. PostgreSQL
solo conserva el usuario interno y metadata operativa; no es la fuente de
autorización owner global.

## Seguridad Logto para usuarios de organizaciones

Civitas separa estrictamente los permisos globales de plataforma de los roles de
organización. El rol global `owner_global` está reservado exclusivamente para
owners internos de Civitas y nunca debe configurarse como rol por defecto para
usuarios normales, administradores de colegio, docentes o estudiantes.

Configuración esperada en Logto:

- No configurar `owner_global` como default role de nuevos usuarios.
- Crear y mantener `Admin-org` y `Student-org` como roles de la plantilla de
  organizaciones de Logto.
- Asignar `Admin-org` al base admin solo dentro de su organización.
- Asignar `Student-org` (u otros roles organizacionales equivalentes) vía JIT
  solo dentro de la organización.
- Reservar `owner_global` y scopes globales como `owner:read` únicamente para
  owners de plataforma Civitas.

El backend también valida el base admin durante el alta de organizaciones: por
defecto `CIVITAS_ALLOWED_ORG_USER_GLOBAL_ROLES` es una lista vacía, por lo que
cualquier rol global detectado en un usuario de organización se considera una
configuración insegura. Si Logto asigna externamente `owner_global` a un
usuario recién creado por el alta, Civitas intenta removerlo con la Management
API, registra auditoría y falla el bootstrap con un error crítico. Si el usuario
ya existía, Civitas no muta sus roles globales: registra auditoría y falla el
bootstrap para evitar que un owner legítimo pierda permisos por accidente.

El portal owner sigue protegido con tokens globales: los tokens organizacionales
son rechazados y `/owner/*` requiere el scope global `owner:read`.
