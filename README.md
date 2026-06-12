# Civitas

Civitas es una aplicación en monorepo con frontend React y backend Node/Express. Este estado del repositorio establece el **Nivel 0**: una base técnica local pequeña y verificable antes de introducir autenticación, organizaciones o integraciones externas.

## Alcance actual

Incluido en esta base local:

- Frontend React con Vite (`frontend/`).
- Backend Node/Express (`backend/`).
- PostgreSQL local mediante Docker Compose.
- Drizzle ORM configurado en el backend.
- Primera migración SQL mínima para validar el flujo.
- `GET /health` para verificar API y conectividad básica con PostgreSQL.

Fuera de alcance en este nivel:

- Login, Logto, organizaciones, roles, membresías.
- Moodle, BuddyBoss, FluentCRM.
- Redis, workers o colas.

El código heredado del sample de Logto se conserva en rutas protegidas para no bloquear trabajo futuro, pero el flujo local documentado abajo no depende de Logto.

## Estructura

```text
.
├── backend/              # API Express, configuración PostgreSQL y Drizzle
│   ├── db/               # Configuración de conexión y schema Drizzle
│   └── drizzle/          # Migraciones iniciales
├── frontend/             # Aplicación React/Vite
└── docker-compose.yml    # PostgreSQL local
```

## Requisitos

- Node.js 20 o superior.
- npm.
- Docker con Docker Compose.

## Configuración inicial

Instala dependencias en cada paquete:

```bash
cd backend
npm install

cd ../frontend
npm install
```

Crea los archivos de entorno locales desde los ejemplos:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Los valores por defecto apuntan a:

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:5173`
- PostgreSQL: `postgres://civitas:civitas@localhost:5432/civitas`

## Levantar PostgreSQL local

Desde la raíz del repositorio:

```bash
docker compose up -d postgres
```

Este compose levanta solo PostgreSQL para mantener el entorno base simple. El frontend y backend se ejecutan fuera de Compose con los scripts npm de desarrollo, lo que evita reconstrucciones de contenedores durante esta etapa.

## Ejecutar migraciones

Con PostgreSQL levantado:

```bash
cd backend
npm run db:migrate
```

Para generar nuevas migraciones desde el schema Drizzle cuando el modelo cambie:

```bash
cd backend
npm run db:generate
```

## Levantar backend

```bash
cd backend
npm run dev
```

El backend arranca en `http://localhost:3000`. No requiere variables de Logto para iniciar ni para responder `GET /health`.

## Verificar healthcheck

Con PostgreSQL y backend activos:

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
    "host": "localhost",
    "port": 5432,
    "name": "civitas"
  }
}
```

Si PostgreSQL no está disponible, el backend sigue arrancando, pero `/health` responde `503` con estado `degraded` y el detalle de error de conexión.

## Levantar frontend

```bash
cd frontend
npm run dev
```

El frontend carga en `http://localhost:5173` y, por defecto, usa `VITE_ENABLE_LOGTO=false`. En este modo muestra una pantalla local de Nivel 0 y consulta `GET /health` mediante `VITE_API_BASE_URL`.

## Variables de entorno

### Backend

Ver `backend/.env.example`:

- `PORT`: puerto HTTP del backend.
- `DATABASE_URL`: URL de conexión PostgreSQL usada por Drizzle y por el healthcheck.
- Variables `LOGTO_*`: opcionales y comentadas; no son requeridas para este issue.

### Frontend

Ver `frontend/.env.example`:

- `VITE_API_BASE_URL`: URL base del backend.
- `VITE_ENABLE_LOGTO=false`: mantiene desactivado el sample heredado de Logto para el flujo base.
- Variables `VITE_LOGTO_*`: opcionales y comentadas; reservadas para una futura etapa de autenticación.

## Deuda técnica anotada

- Las rutas heredadas `/organizations` y `/documents` todavía representan el sample de Logto y deberán rediseñarse cuando se implemente autenticación y organizaciones reales de Civitas.
- El frontend conserva componentes del sample autenticado detrás de `VITE_ENABLE_LOGTO`; no forman parte del flujo de Nivel 0.
- La migración inicial solo crea una tabla mínima de verificación técnica. El modelo de dominio real debe definirse en issues posteriores.
