# Civitas orchestration worker (#106 foundation + #107 owner bootstrap)

Civitas now uses BullMQ + Redis to move the long owner organization bootstrap out of the HTTP request cycle. Redis is an external service reached with a single URL, e.g. `REDIS_URL=redis://redis:6379` in Docker Compose.

## Runtime processes

- `npm run migrate`: release/one-off database migration step.
- `npm run start:api`: API process. In compose it should not compete for migrations when `RUN_MIGRATIONS_ON_STARTUP=false`.
- `npm run start:worker`: BullMQ worker process. It requires `REDIS_URL` and processes `organization.bootstrap` jobs.

## Owner bootstrap flow

`POST /owner/organizations` validates and normalizes the request, creates a `sync_operations` row, snapshots the payload, enqueues `organization.bootstrap`, and returns `202 Accepted` with `operationId`, `statusUrl`, `canonicalStatus`, `downstreamStatus`, `correlationId`, and `organizationId` when already known.

The worker then runs:

1. canonical Logto bootstrap via existing provisioning services;
2. local `organization_profiles` reconciliation as operational state;
3. downstream FluentCRM company/contact propagation;
4. final operation/step status persistence.

## Canonical boundary

- Logto is canonical for identity, organizations, memberships, organization roles, global roles, usernames, permissions and tokens.
- Civitas DB stores operational snapshots, mappings, correlation, retries, step traces, errors and reconciliation state in `sync_operations` and `sync_operation_steps`.
- FluentCRM, WordPress and BuddyBoss are downstream systems. If downstream fails after Logto succeeds, the operation is `partial_failed` with `canonicalStatus=completed` and `downstreamStatus=failed`; the Logto result is not rolled back.

## Status APIs

- `GET /owner/operations/:operationId`
- `GET /owner/organizations/:organizationId/provisioning-status`

Both expose global status, canonical/downstream phase status, current step, completed/failed steps, retryability, correlation id and safe last error details.

## Minimal Redis deployment

Use a separate Redis container/service and set the same URL in API and worker:

```env
REDIS_URL=redis://redis:6379
BULLMQ_PREFIX=civitas
WORKER_CONCURRENCY=2
```

No Sentinel/Cluster configuration is required for this sprint.

## Rollback flag

`ORGANIZATION_BOOTSTRAP_ORCHESTRATION=false` keeps the previous inline path available only as a controlled rollback path. The default behavior is the queued worker-backed flow.
