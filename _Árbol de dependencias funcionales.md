## **26\. Árbol de dependencias funcionales y arquitectura de despliegue**

### **26.1 Decisión general**

El sistema debe construirse con dependencias explícitas.

No se debe implementar una función compleja si sus dependencias funcionales todavía no existen.

Regla:

Primero identidad.  
Después usuario interno.  
Después owner.  
Después organización.  
Después membresía.  
Después sillas.  
Después invitaciones.  
Después sincronización.  
Después workers.  
Después auditoría avanzada, suplantación, reportes y SSO empresarial.

### **26.2 Árbol de dependencias funcionales**

Base técnica  
├── Monorepo / estructura inicial  
├── Docker Compose local  
├── PostgreSQL  
├── Drizzle ORM  
├── Backend Node/Express  
├── Frontend React  
└── Healthcheck

UI base  
├── Bootstrap 5  
├── React-Bootstrap  
├── Layout  
├── Sidebar  
├── Header  
├── Cards  
├── Tables  
├── Forms  
└── Estados: loading / empty / error

Autenticación  
├── Logto tenant configurado  
├── Logto React SDK  
├── Login  
├── Logout  
├── Ruta privada frontend  
└── Validación JWT backend

Usuario interno  
├── Tabla users  
├── logto\_user\_id  
├── email  
├── status  
├── GET /me  
└── creación automática al primer login

Owner portal  
├── Usuario interno  
├── Rol global owner\_global  
├── requireOwner backend  
├── /owner frontend  
└── Dashboard owner básico

Organización interna  
├── Owner portal  
├── Tabla organizations  
├── name único  
├── subdomain único  
├── status  
├── seat\_total  
├── POST /owner/organizations  
└── GET /owner/organizations

Auditoría mínima  
├── Usuario interno  
├── Owner portal  
├── Tabla audit\_logs  
├── actor\_user\_id  
├── action  
├── result  
└── organización afectada

Organización Logto  
├── Organización interna  
├── Logto Management API  
├── M2M credentials  
├── create organization en Logto  
├── logto\_organization\_id  
└── sync\_status

FluentCRM Company  
├── Organización interna  
├── Cliente FluentCRM API  
├── buscar company  
├── crear company  
├── fluentcrm\_company\_id  
└── manejo de duplicados

Membership  
├── Usuario interno  
├── Organización interna  
├── Organización Logto  
├── Tabla memberships  
├── role  
├── status  
└── relación usuario-organización

Invitar organization admin  
├── Owner portal  
├── Organización interna  
├── Organización Logto  
├── Membership  
├── Logto Management API  
├── tabla invitations  
├── asignar role organization\_admin  
└── audit log

Portal organización  
├── Membership  
├── Organización activa  
├── organization token  
├── validación organization\_id  
├── /org/:organizationId  
└── dashboard organización

Sillas  
├── Organización interna  
├── Membership  
├── Tabla seat\_assignments  
├── seat\_total  
├── seat\_used  
├── asignar silla  
├── liberar silla  
└── audit log

Invitaciones B2B  
├── Portal organización  
├── Membership  
├── Sillas  
├── Permiso invite:member  
├── Logto Management API  
├── tabla invitations  
├── asignar rol  
├── asignar silla  
└── audit log

Selector de organización  
├── Usuario interno  
├── Membership  
├── múltiples organizaciones  
├── GET /me/organizations  
├── /select-organization  
└── organization token

RBAC fino  
├── Logto organization template  
├── Roles de organización  
├── Scopes/permisos  
├── PermissionGuard frontend  
├── requirePermission backend  
└── validación por organization\_id

SyncEvent  
├── Organización  
├── Membership  
├── Sillas  
├── Invitaciones  
├── Tabla sync\_events  
├── estado pending/processing/success/failed  
└── vista owner sync

Moodle usuario  
├── SyncEvent  
├── Usuario interno  
├── Moodle API client  
├── moodle\_user\_id  
├── crear/buscar usuario Moodle  
└── registrar resultado

Moodle matrícula  
├── Moodle usuario  
├── Organización  
├── Curso  
├── Grupo/cohorte  
├── course\_access  
├── enrolment  
└── validación tenant

BuddyBoss grupo  
├── SyncEvent  
├── Organización  
├── WordPress/BuddyBoss API client  
├── buddyboss\_group\_id  
├── crear grupo  
├── agregar miembro  
└── mapear rol

Workers  
├── SyncEvent  
├── Redis  
├── BullMQ  
├── sync-worker  
├── reintentos  
├── backoff  
└── reintento manual owner

Reconciliación  
├── Workers  
├── Logto API  
├── FluentCRM API  
├── Moodle API  
├── BuddyBoss API  
├── comparar estados  
└── generar SyncEvents correctivos

Bulk invitations  
├── Sillas  
├── Invitations  
├── Workers  
├── CSV parser  
├── validación previa  
├── previsualización  
└── errores por fila

Auditoría avanzada  
├── AuditLog mínimo  
├── IP  
├── user agent  
├── before/after  
├── motivo  
├── filtros  
└── exportación controlada

Step-up verification  
├── Autenticación  
├── MFA  
├── Acciones sensibles  
├── verificationRecordId si aplica  
├── expiración  
└── bloqueo sin verificación reciente

Suplantación owner  
├── Owner portal  
├── Auditoría avanzada  
├── Step-up verification  
├── Impersonation session  
├── motivo obligatorio  
├── banner frontend  
└── bloqueo de acciones críticas

Reportes  
├── Datos limpios  
├── Organización  
├── Membership  
├── Sillas  
├── Moodle progress  
├── Workers si son pesados  
├── permisos de exportación  
└── aislamiento tenant

SSO empresarial  
├── Logto organizaciones  
├── Organization admin estable  
├── Sillas  
├── Dominios verificados  
├── Conector OIDC/SAML  
├── política de ingreso  
└── auditoría

JIT provisioning  
├── SSO empresarial  
├── dominio verificado  
├── rol predeterminado  
├── validación de sillas  
├── aprobación si aplica  
└── SyncEvent

### **26.3 Árbol resumido por dependencias críticas**

Logto login  
└── Usuario interno  
    └── Owner portal  
        └── Organización interna  
            ├── Organización Logto  
            ├── FluentCRM Company  
            └── Membership  
                ├── Organization admin  
                │   └── Portal organización  
                │       ├── Sillas  
                │       │   └── Invitaciones B2B  
                │       ├── Selector de organización  
                │       └── RBAC fino  
                └── SyncEvent  
                    ├── Moodle usuario  
                    │   └── Moodle matrícula  
                    ├── BuddyBoss grupo  
                    └── Workers  
                        ├── Reintentos  
                        ├── Reconciliación  
                        └── Bulk invitations

### **26.4 Decisión Docker vs Nixpacks**

La decisión recomendada es usar ambos, pero con responsabilidades distintas.

### **Desarrollo local**

Usar Docker Compose.

Debe levantar:

* Frontend.  
* Backend.  
* PostgreSQL.  
* Redis.  
* Worker.  
* Adminer o pgAdmin opcional.  
* Mailhog opcional para pruebas de correo.

Razón:

El equipo necesita un entorno reproducible.  
No debe depender de que cada desarrollador tenga PostgreSQL, Redis o versiones exactas instaladas localmente.

### **Producción MVP rápida**

Nixpacks puede usarse si la plataforma de despliegue lo soporta y se quiere acelerar.

Útil para:

* Deploy inicial.  
* Staging rápido.  
* Validar demo.  
* Servicios Node simples.  
* Frontend estático.  
* Backend API sencillo.

Pero Nixpacks no reemplaza el diseño de arquitectura.

### **Producción controlada**

Usar Dockerfile propio.

Recomendado para:

* Backend API.  
* Worker.  
* Procesos con dependencias específicas.  
* Control de build.  
* Healthchecks.  
* Seguridad.  
* Versiones fijas.  
* Reproducibilidad.  
* CI/CD serio.

### **Decisión final**

Docker Compose para desarrollo local.  
Dockerfile propio para producción controlada.  
Nixpacks solo como vía rápida de despliegue si la plataforma lo facilita.

No depender exclusivamente de Nixpacks para un sistema con workers, Redis, PostgreSQL e integraciones externas.

### **26.5 Servicios Docker recomendados**

services:  
  frontend  
  backend  
  worker  
  postgres  
  redis  
  adminer  
  mailhog

### **26.6 Responsabilidad de cada servicio**

#### **frontend**

Responsabilidad:

* React.  
* Vite.  
* UI owner.  
* UI organización.  
* UI cuenta.  
* Login con Logto.  
* Consumo de backend API.

Depende de:

* backend.  
* Logto externo.

#### **backend**

Responsabilidad:

* API principal.  
* Validación JWT.  
* Reglas de negocio.  
* Organización.  
* Membership.  
* Sillas.  
* Invitaciones.  
* Auditoría.  
* Integraciones con Logto, FluentCRM, Moodle y BuddyBoss.

Depende de:

* postgres.  
* redis.  
* Logto externo.  
* WordPress/FluentCRM externo.  
* Moodle externo.  
* BuddyBoss externo.

#### **worker**

Responsabilidad:

* Procesar SyncEvents.  
* Reintentos.  
* Sincronizar Moodle.  
* Sincronizar BuddyBoss.  
* Reconciliar datos.  
* Procesar invitaciones masivas.  
* Generar reportes pesados.

Depende de:

* postgres.  
* redis.  
* backend shared code.  
* APIs externas.

#### **postgres**

Responsabilidad:

* Base operativa del middleware.  
* Organizaciones.  
* Usuarios.  
* Memberships.  
* Sillas.  
* Invitaciones.  
* SyncEvents.  
* AuditLogs.

#### **redis**

Responsabilidad:

* Cola BullMQ.  
* Jobs.  
* Locks.  
* Reintentos.  
* Estado temporal de workers si aplica.

#### **adminer / pgAdmin**

Responsabilidad:

* Inspección local de base de datos.  
* Solo desarrollo local.

#### **mailhog**

Responsabilidad:

* Pruebas locales de emails.  
* Invitaciones.  
* Magic links.  
* Notificaciones.

Solo desarrollo local.

### **26.7 Docker Compose inicial recomendado**

services:  
  frontend:  
    build:  
      context: ./frontend  
      dockerfile: Dockerfile.dev  
    command: npm run dev \-- \--host 0.0.0.0  
    ports:  
      \- "5173:5173"  
    volumes:  
      \- ./frontend:/app  
      \- frontend\_node\_modules:/app/node\_modules  
    environment:  
      VITE\_API\_URL: http://localhost:3000  
      VITE\_LOGTO\_ENDPOINT: ${VITE\_LOGTO\_ENDPOINT}  
      VITE\_LOGTO\_APP\_ID: ${VITE\_LOGTO\_APP\_ID}  
    depends\_on:  
      \- backend

  backend:  
    build:  
      context: ./backend  
      dockerfile: Dockerfile.dev  
    command: npm run dev  
    ports:  
      \- "3000:3000"  
    volumes:  
      \- ./backend:/app  
      \- backend\_node\_modules:/app/node\_modules  
    environment:  
      NODE\_ENV: development  
      PORT: 3000  
      DATABASE\_URL: postgres://postgres:postgres@postgres:5432/middleware  
      REDIS\_URL: redis://redis:6379  
      LOGTO\_ENDPOINT: ${LOGTO\_ENDPOINT}  
      LOGTO\_M2M\_APP\_ID: ${LOGTO\_M2M\_APP\_ID}  
      LOGTO\_M2M\_APP\_SECRET: ${LOGTO\_M2M\_APP\_SECRET}  
      FLUENTCRM\_BASE\_URL: ${FLUENTCRM\_BASE\_URL}  
      FLUENTCRM\_USERNAME: ${FLUENTCRM\_USERNAME}  
      FLUENTCRM\_APP\_PASSWORD: ${FLUENTCRM\_APP\_PASSWORD}  
    depends\_on:  
      postgres:  
        condition: service\_healthy  
      redis:  
        condition: service\_started

  worker:  
    build:  
      context: ./backend  
      dockerfile: Dockerfile.dev  
    command: npm run worker:dev  
    volumes:  
      \- ./backend:/app  
      \- backend\_node\_modules:/app/node\_modules  
    environment:  
      NODE\_ENV: development  
      DATABASE\_URL: postgres://postgres:postgres@postgres:5432/middleware  
      REDIS\_URL: redis://redis:6379  
      LOGTO\_ENDPOINT: ${LOGTO\_ENDPOINT}  
      LOGTO\_M2M\_APP\_ID: ${LOGTO\_M2M\_APP\_ID}  
      LOGTO\_M2M\_APP\_SECRET: ${LOGTO\_M2M\_APP\_SECRET}  
      FLUENTCRM\_BASE\_URL: ${FLUENTCRM\_BASE\_URL}  
      FLUENTCRM\_USERNAME: ${FLUENTCRM\_USERNAME}  
      FLUENTCRM\_APP\_PASSWORD: ${FLUENTCRM\_APP\_PASSWORD}  
    depends\_on:  
      postgres:  
        condition: service\_healthy  
      redis:  
        condition: service\_started

  postgres:  
    image: postgres:16-alpine  
    restart: unless-stopped  
    environment:  
      POSTGRES\_DB: middleware  
      POSTGRES\_USER: postgres  
      POSTGRES\_PASSWORD: postgres  
    ports:  
      \- "5432:5432"  
    volumes:  
      \- postgres\_data:/var/lib/postgresql/data  
    healthcheck:  
      test: \["CMD-SHELL", "pg\_isready \-U postgres \-d middleware"\]  
      interval: 5s  
      timeout: 5s  
      retries: 10

  redis:  
    image: redis:7-alpine  
    restart: unless-stopped  
    ports:  
      \- "6379:6379"

  adminer:  
    image: adminer:latest  
    restart: unless-stopped  
    ports:  
      \- "8080:8080"  
    depends\_on:  
      \- postgres

  mailhog:  
    image: mailhog/mailhog:latest  
    restart: unless-stopped  
    ports:  
      \- "8025:8025"  
      \- "1025:1025"

volumes:  
  postgres\_data:  
  frontend\_node\_modules:  
  backend\_node\_modules:

### **26.8 Dockerfile dev para backend**

FROM node:22-alpine

WORKDIR /app

COPY package\*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD \["npm", "run", "dev"\]

### **26.9 Dockerfile dev para frontend**

FROM node:22-alpine

WORKDIR /app

COPY package\*.json ./

RUN npm install

COPY . .

EXPOSE 5173

CMD \["npm", "run", "dev", "--", "--host", "0.0.0.0"\]

### **26.10 Dockerfile producción backend**

FROM node:22-alpine AS deps

WORKDIR /app

COPY package\*.json ./

RUN npm ci

FROM node:22-alpine AS builder

WORKDIR /app

COPY \--from=deps /app/node\_modules ./node\_modules  
COPY . .

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE\_ENV=production

COPY package\*.json ./  
COPY \--from=deps /app/node\_modules ./node\_modules  
COPY \--from=builder /app/dist ./dist

EXPOSE 3000

CMD \["node", "dist/server.js"\]

### **26.11 Dockerfile producción worker**

El worker puede usar la misma imagen del backend, cambiando el comando.

FROM node:22-alpine AS deps

WORKDIR /app

COPY package\*.json ./

RUN npm ci

FROM node:22-alpine AS builder

WORKDIR /app

COPY \--from=deps /app/node\_modules ./node\_modules  
COPY . .

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE\_ENV=production

COPY package\*.json ./  
COPY \--from=deps /app/node\_modules ./node\_modules  
COPY \--from=builder /app/dist ./dist

CMD \["node", "dist/worker.js"\]

### **26.12 Dockerfile producción frontend**

FROM node:22-alpine AS builder

WORKDIR /app

COPY package\*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM nginx:alpine AS runner

COPY \--from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD \["nginx", "-g", "daemon off;"\]

### **26.13 Alternativa con Nixpacks**

Nixpacks puede usarse para desplegar servicios Node si la plataforma lo soporta.

Casos adecuados:

* Frontend React.  
* Backend Node simple.  
* Worker Node simple.  
* Staging.  
* Demo rápida.

Casos donde preferir Dockerfile:

* Producción.  
* Healthchecks personalizados.  
* Dependencias del sistema.  
* Monorepo complejo.  
* Worker separado.  
* Build reproducible.  
* Seguridad.  
* Optimización de imagen.  
* Control exacto de comandos.

### **26.14 Estrategia recomendada por entorno**

| Entorno | Estrategia |
| ----- | ----- |
| Local | Docker Compose |
| Demo rápida | Nixpacks permitido |
| Staging | Dockerfile preferido, Nixpacks aceptable |
| Producción MVP | Dockerfile propio |
| Producción madura | Dockerfile propio \+ CI/CD \+ healthchecks |

### **26.15 Regla final**

Docker no es opcional para este proyecto.

El sistema depende de varios servicios:

* Frontend.  
* Backend.  
* Worker.  
* PostgreSQL.  
* Redis.  
* Integraciones externas.

Por eso, Node.js solo no es suficiente como estrategia de ejecución.

Node.js es el runtime.  
Docker es el entorno reproducible.  
Docker Compose es la orquestación local.  
Nixpacks es una ayuda de despliegue rápido.  
Dockerfile propio es la estrategia controlada para producción.

