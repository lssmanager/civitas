# Civitas

Civitas es una aplicación en monorepo con frontend React y backend Node/Express. Este estado del repositorio mantiene la **Fase 02** del backend: una base técnica verificable con healthcheck y autenticación JWT de Logto para el API, sin activar todavía organizaciones ni multi-tenancy de Civitas.

## Alcance actual

Incluido en esta base:

- Frontend React con Vite (`frontend/`).
- Backend Node/Express (`backend/`).
- PostgreSQL mediante Docker Compose.
- Drizzle ORM configurado en el backend.
- Primera migración SQL mínima para validar el flujo.
- `GET /health` para verificar API y conectividad básica con PostgreSQL.
- `GET /auth/test` protegido por JWT de Logto para validar la integración de autenticación del backend.
- Middleware `requireAuth` que valida access tokens contra JWKS remoto de Logto, issuer y audience/API resource indicator.
- Dockerfiles explícitos para desplegar frontend y backend sin depender de inferencias de Nixpacks.

Fuera del flujo de Fase 02:

- Organizaciones, membresías y multi-tenancy de Civitas.
- Documentos.
- Organization tokens.
- Roles/permisos de dominio.
- Moodle, BuddyBoss, FluentCRM.
- Redis, workers o colas.

La infraestructura base de Express, PostgreSQL, Drizzle, Docker y validación JWT de Logto se conserva para fases posteriores. El código heredado del sample de Logto relacionado con Management API/organizaciones se elimina solo como limpieza de código fuera de alcance; no es una decisión de producto sobre organizaciones, documentos, roles ni multi-tenancy.

## Estructura

```text
.
├── backend/              # API Express, configuración PostgreSQL y Drizzle
│   ├── Dockerfile        # Build/runtime Node para la API
│   ├── db/               # Configuración de conexión y schema Drizzle
│   └── drizzle/          # Migraciones iniciales
├── frontend/             # Aplicación React/Vite
│   └── Dockerfile        # Build Vite y servicio de dist con vite preview
└── docker-compose.yml    # Stack postgres + backend + frontend
```

## Requisitos

- Node.js 20 o superior para desarrollo local sin contenedores.
- npm.
- Docker con Docker Compose.

## Qué hacía Nixpacks y cómo se migró a Docker

Antes, Coolify/Nixpacks infería la instalación, build y runtime desde los `package.json`:

- `backend/package.json`:
  - Instalación: `npm install`/equivalente.
  - Runtime: `npm start`, que ejecuta `node index.js`.
  - Puerto esperado: `PORT` o `3000` por defecto.
  - Variables principales: `DATABASE_URL`, `PORT` y opcionalmente variables `LOGTO_*` heredadas.
- `frontend/package.json`:
  - Instalación: `npm install`/equivalente.
  - Build: `npm run build`, que ejecuta `tsc -b && vite build`.
  - Runtime de preview: `npm run preview`.
  - Puerto local de Vite preview: `5173`.
  - Variables principales: `VITE_API_BASE_URL`, `VITE_ENABLE_LOGTO` y variables `VITE_LOGTO_*` heredadas.

Con Docker Compose esa lógica ya no se infiere. Ahora está declarada explícitamente en:

- `backend/Dockerfile`: instala dependencias de producción con `npm ci --omit=dev`, copia el código, expone `3000` y ejecuta `npm start`.
- `frontend/Dockerfile`: instala dependencias, recibe las variables `VITE_*` como build args, ejecuta `npm run build`, expone `5173` y sirve `dist` con `vite preview`.
- `docker-compose.yml`: define `postgres`, `backend` y `frontend`, sus puertos, variables, healthchecks y dependencias.

## Variables de entorno

### PostgreSQL / Compose

Estas variables pueden configurarse en un `.env` en la raíz o directamente en Coolify:

| Variable | Valor local por defecto | Descripción |
| --- | --- | --- |
| `POSTGRES_DB` | `civitas` | Base creada por la imagen oficial de Postgres. |
| `POSTGRES_USER` | `civitas` | Usuario de Postgres. |
| `POSTGRES_PASSWORD` | `civitas` | Contraseña de Postgres. Cambiar en producción. |
| `POSTGRES_PORT` | `5432` | Puerto publicado en el host para desarrollo local. |

### Backend

Ver `backend/.env.example`.

| Variable | Valor local por defecto | Descripción |
| --- | --- | --- |
| `BACKEND_PORT` | `3000` | Puerto interno que usa Express dentro del contenedor Compose. |
| `BACKEND_PUBLIC_PORT` | `3000` | Puerto publicado en el host/Coolify para la API. |
| `PORT` | `3000` | Puerto usado cuando se ejecuta el backend fuera de Compose. |
| `DATABASE_URL` | `postgres://civitas:civitas@postgres:5432/civitas` en Compose | URL PostgreSQL usada por Drizzle y `/health`. Dentro de Docker debe apuntar al servicio `postgres`, no a `localhost`. |
| `LOGTO_ISSUER` | vacío | Issuer esperado para access tokens de Logto usados por `/auth/test`. |
| `LOGTO_JWKS_URL` | vacío | Endpoint JWKS remoto usado por `requireAuth` para validar JWT de Logto. |
| `LOGTO_API_RESOURCE_INDICATOR` | vacío | Audience/API resource indicator configurado para el API de Civitas en Logto. Debe coincidir con `VITE_API_RESOURCE_INDICATOR`. |

### Frontend

Ver `frontend/.env.example`.

| Variable | Valor local por defecto | Descripción |
| --- | --- | --- |
| `FRONTEND_PUBLIC_PORT` | `5173` | Puerto publicado para servir la SPA. |
| `PREVIEW_ALLOWED_HOSTS` | `civitas.socialstudies.cloud` | Lista separada por comas de dominios públicos adicionales que `vite preview` acepta en el header `Host`. Añade aquí futuros dominios de Coolify. |
| `VITE_API_BASE_URL` | desarrollo: `http://localhost:3000`; producción: `https://civitas.socialstudies.cloud/api` | URL pública del backend para el navegador. En producción/Coolify debe ser la URL pública real de la API y debe existir durante el build de Vite. |
| `VITE_ENABLE_LOGTO` | `false` | Mantiene desactivado el flujo UI autenticado si no se está probando Logto localmente. |
| `VITE_LOGTO_*` | vacío | Variables heredadas opcionales para una futura etapa de autenticación. |

> Importante: las variables `VITE_*` se incrustan en el bundle durante `npm run build`. En Docker/Coolify deben configurarse antes de construir/redeployar la imagen del frontend. `PREVIEW_ALLOWED_HOSTS` se lee en runtime por `vite preview`, por lo que sirve para parametrizar dominios públicos sin cambiar código.

## Ejecutar todo con Docker Compose

Desde la raíz del repositorio:

```bash
docker compose up --build
```

Servicios locales por defecto:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- PostgreSQL: `localhost:5432`

Verifica el backend y la conexión a PostgreSQL:

```bash
curl http://localhost:3000/health
```

Respuesta esperada cuando PostgreSQL está accesible:

```json
{
  "status": "ok",
  "service": "civitas-api",
  "timestamp": "2026-06-12T00:00:00.000Z",
  "database": {
    "status": "connected",
    "host": "postgres",
    "port": 5432,
    "name": "civitas"
  }
}
```

Si PostgreSQL no está disponible, el backend sigue arrancando, pero `/health` responde `503` con estado `degraded` y el detalle de error de conexión.

Para detener el stack:

```bash
docker compose down
```

Para detener el stack y borrar el volumen de datos local:

```bash
docker compose down -v
```

## Levantar solo PostgreSQL para desarrollo híbrido

Si quieres ejecutar backend y frontend en tu host con los scripts npm, levanta únicamente PostgreSQL:

```bash
docker compose up -d postgres
```

Luego instala dependencias y crea archivos `.env` locales:

```bash
cd backend
npm install
cp .env.example .env

cd ../frontend
npm install
cp .env.example .env
```

Ejecuta migraciones si estás trabajando con el schema Drizzle:

```bash
cd backend
npm run db:migrate
```

Levanta el backend en modo desarrollo:

```bash
cd backend
npm run dev
```

Levanta el frontend en modo desarrollo:

```bash
cd frontend
npm run dev
```

En desarrollo híbrido, `backend/.env` debe usar `DATABASE_URL=postgres://civitas:civitas@localhost:5432/civitas`, porque el backend corre en el host. En Compose, el backend usa `postgres://civitas:civitas@postgres:5432/civitas`, porque corre dentro de la red Docker.

## Despliegue en Coolify con Docker Compose

Configura Coolify para desplegar desde `docker-compose.yml` en la raíz del repositorio. El despliegue ya no depende de Nixpacks: Coolify solo necesita construir los Dockerfiles definidos por Compose.

Variables recomendadas en Coolify:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DATABASE_URL=postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB>`
- `BACKEND_PORT=3000`
- `BACKEND_PUBLIC_PORT=3000` o el puerto/ruta que Coolify asigne al servicio backend
- `FRONTEND_PUBLIC_PORT=5173` o el puerto/ruta que Coolify asigne al servicio frontend
- `PREVIEW_ALLOWED_HOSTS=civitas.socialstudies.cloud` para permitir el dominio público del frontend. Si hay más dominios, sepáralos por comas.
- `VITE_API_BASE_URL=https://civitas.socialstudies.cloud/api`
- `VITE_API_RESOURCE_INDICATOR=https://civitas.socialstudies.cloud/api`
- `VITE_ENABLE_LOGTO=true`
- `VITE_LOGTO_ENDPOINT=https://auth.learnsocialstudies.com/`
- `VITE_LOGTO_APP_ID=avc4zf5kjm5rgc5xgsegh`
- `VITE_APP_REDIRECT_URI=https://civitas.socialstudies.cloud/callback`
- `VITE_APP_SIGN_OUT_REDIRECT_URI=https://civitas.socialstudies.cloud`
- `LOGTO_ISSUER=https://auth.learnsocialstudies.com/oidc`, `LOGTO_JWKS_URL=https://auth.learnsocialstudies.com/oidc/jwks` y `LOGTO_API_RESOURCE_INDICATOR=https://civitas.socialstudies.cloud/api` si se va a probar `/auth/test` o `/me` en ese entorno

No uses `http://backend:3000` en `VITE_API_BASE_URL` para producción: esa dirección solo existe dentro de la red Docker. El frontend corre en el navegador del usuario y necesita llamar a una URL pública del backend, por ejemplo `https://api.example.com`.

`vite preview` bloquea peticiones cuyo header `Host` no esté permitido para evitar responder a dominios inesperados detrás de proxies. Por eso Coolify mostraba `Blocked request` al entrar por `civitas.socialstudies.cloud`; el dominio público debe aparecer en `preview.allowedHosts` o en `PREVIEW_ALLOWED_HOSTS`.

Si cambias `VITE_API_BASE_URL` u otra variable `VITE_*`, reconstruye/redeploya el frontend para que el nuevo valor quede dentro del bundle estático. En Vite, estas variables se inyectan en build time; configurarlas solo como variables runtime del contenedor no cambia el JavaScript ya compilado.

## Migraciones Drizzle

El contenedor de backend de producción arranca con `npm start` y no ejecuta migraciones automáticamente. Esto evita que cada reinicio de la aplicación modifique la base de datos sin una acción explícita.

Para ejecutar migraciones en desarrollo híbrido:

```bash
cd backend
npm run db:migrate
```

Para generar nuevas migraciones desde el schema Drizzle cuando el modelo cambie:

```bash
cd backend
npm run db:generate
```

Si se necesita automatizar migraciones en producción, se recomienda hacerlo como paso explícito de despliegue o con un job separado en una tarea futura.

## Verificación rápida

Con `docker compose up --build` ejecutándose:

```bash
curl http://localhost:3000/health
```

Debe responder `status: "ok"` y mostrar `database.status: "connected"`.

```bash
curl -I http://localhost:5173
```

Debe responder `HTTP/1.1 200 OK` y servir la SPA de Vite.

## Deuda técnica anotada

- El backend queda limitado a Fase 02: `/health`, `/auth/test` y `requireAuth` con JWT de Logto.
- Organizaciones, documentos, organization tokens, roles y multi-tenancy quedan fuera del flujo actual y deberán diseñarse en issues posteriores.
- El frontend conserva componentes del sample autenticado detrás de `VITE_ENABLE_LOGTO`; no forman parte del flujo backend de Fase 02.
- La migración inicial solo crea una tabla mínima de verificación técnica. El modelo de dominio real debe definirse en issues posteriores.
- `vite preview` es suficiente para esta migración simple sin Nginx/Traefik. Si más adelante se requiere compresión avanzada, caché fina o headers de seguridad específicos, conviene evaluar un servidor estático dedicado.
