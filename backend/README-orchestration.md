# Civitas orchestration worker

This sprint introduces a separate BullMQ worker for long-running multi-system operations. Redis is an external service reached with a single URL, e.g. `REDIS_URL=redis://redis:6379` in Docker Compose.

## Processes

- `npm run migrate`: release/one-off database migration step.
- `npm run start:api`: API process. It validates the database and, by default in compose, does not run migrations when `RUN_MIGRATIONS_ON_STARTUP=false`.
- `npm run start:worker`: BullMQ worker process. It requires `REDIS_URL` and processes `organization.bootstrap` jobs.

## Canonical boundary

Logto remains canonical for identity, organizations, memberships and roles. Civitas stores operational snapshots, mappings, status, retries and conflicts in `sync_operations` and `sync_operation_steps`. FluentCRM and WordPress/BuddyBoss are downstream propagation targets; downstream failure marks an operation `partial_failed` without invalidating a completed Logto phase.

## Minimal Redis deployment

Use a separate Redis container/service and set the same URL in API and worker:

```env
REDIS_URL=redis://redis:6379
BULLMQ_PREFIX=civitas
WORKER_CONCURRENCY=2
```

No Sentinel/Cluster configuration is required for this foundation.
