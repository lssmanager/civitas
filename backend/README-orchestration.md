# Civitas orchestration foundation (#106)

This sprint adds the BullMQ + Redis foundation only. Redis is an external service reached with a single URL, e.g. `REDIS_URL=redis://redis:6379` in Docker Compose.

## Scope boundary

Included in #106:

- BullMQ queue configuration and shared Redis connection by `REDIS_URL`.
- A separate worker runtime (`npm run start:worker`).
- Operational tables `sync_operations` and `sync_operation_steps` for future orchestration state, snapshots, retries, correlation and step traces.
- Docker Compose services for `api`, `worker` and `redis`.

Deferred to #107:

- Changing `POST /owner/organizations` to enqueue by default.
- Moving the full Logto + FluentCRM organization bootstrap flow into worker processors.
- Owner-facing provisioning status endpoints tied to the product bootstrap flow.

## Processes

- `npm run migrate`: release/one-off database migration step.
- `npm run start:api`: API process. It validates the database and, by default in compose, does not run migrations when `RUN_MIGRATIONS_ON_STARTUP=false`.
- `npm run start:worker`: BullMQ worker process. It requires `REDIS_URL` and starts the queue runtime.

## Canonical boundary

Logto remains canonical for identity, organizations, memberships and roles. Civitas stores operational snapshots, mappings, status, retries and conflicts in `sync_operations` and `sync_operation_steps`. FluentCRM and WordPress/BuddyBoss are downstream propagation targets for later processors; downstream state must not become canonical identity or permission authority.

## Minimal Redis deployment

Use a separate Redis container/service and set the same URL in API and worker:

```env
REDIS_URL=redis://redis:6379
BULLMQ_PREFIX=civitas
WORKER_CONCURRENCY=2
```

No Sentinel/Cluster configuration is required for this foundation.
