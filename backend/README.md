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

## Bootstrap del primer owner global

Fase 04 introduce un rol global mínimo, `owner_global`, guardado en PostgreSQL en `users.global_role`.
Este rol pertenece al usuario interno de Civitas vinculado por `users.logto_user_id`; no se toma del token ni de roles de Logto.

El bootstrap del primer owner debe ser explícito y manual. Primero el usuario debe existir en `users` (por ejemplo, iniciando sesión una vez para que `GET /me` lo cree). Después, desde producción o dentro del contenedor backend con `DATABASE_URL` apuntando a la base correcta, ejecuta:

```bash
npm --prefix backend run grant-owner -- --logto-user-id 0guhs45pelhm
```

Si ya estás dentro del directorio `backend`, el equivalente es:

```bash
npm run grant-owner -- --logto-user-id 0guhs45pelhm
```

También se puede usar una variable explícita para scripts de despliegue:

```bash
CIVITAS_OWNER_LOGTO_USER_ID=0guhs45pelhm npm --prefix backend run grant-owner
```

El script es idempotente: volver a ejecutarlo sobre el mismo usuario mantiene `global_role = 'owner_global'` y refresca `updated_at`.
Si no encuentra un usuario existente con ese `logto_user_id` o email, termina con error claro y no crea ni promueve automáticamente a nadie.


### Bootstrap automático opcional para preview/dev

En entornos de preview o desarrollo donde la base PostgreSQL se recrea con frecuencia, el rol `users.global_role = 'owner_global'` puede perderse aunque el usuario Logto siga siendo el mismo. Para esos entornos existe un bootstrap automático y explícito:

```bash
CIVITAS_BOOTSTRAP_OWNER_ENABLED=true
CIVITAS_BOOTSTRAP_OWNER_LOGTO_USER_ID=0guhs45pelhm
```

Reglas de seguridad:

- Solo corre cuando `CIVITAS_BOOTSTRAP_OWNER_ENABLED === "true"`.
- Solo promueve el usuario interno cuyo `users.logto_user_id` coincide exactamente con `CIVITAS_BOOTSTRAP_OWNER_LOGTO_USER_ID`.
- No crea usuarios automáticamente; si el usuario aún no existe, queda pendiente hasta que inicie sesión y se cree vía `GET /me` o un endpoint protegido.
- No promueve usuarios `blocked` o `inactive`.
- Es idempotente y usa el mismo helper `grantOwnerGlobalRole` que el script manual.
- No imprime tokens ni datos sensibles.

El backend intenta este bootstrap al iniciar. Además, después de resolver/crear el usuario interno en endpoints protegidos, si el `logto_user_id` coincide con la variable configurada, aplica el grant automáticamente. Así, en una DB limpia de preview, el primer login del owner vuelve a dejar `/owner` accesible sin depender de roles de Logto.

En producción estable, mantén `CIVITAS_BOOTSTRAP_OWNER_ENABLED=false` y prefiere el script manual `grant-owner` o una herramienta administrativa posterior. Este mecanismo es temporal hasta Fase 29, donde los owners se administrarán desde UI con auditoría.
