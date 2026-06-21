# Civitas sync worker operations

Civitas treats Logto as canonical and uses `sync_operations` / `sync_operation_steps` as operational work items. Redis/BullMQ is only a delivery backend; `backend/worker.js` also polls queued database operations so records are not orphaned when Redis is unavailable.

## Operation types

| operationType | Processor | First system touched | Snapshot/input | Success | partial_failed / degraded | Retry policy |
| --- | --- | --- | --- | --- | --- | --- |
| `organization_profile_downstream_sync` | `processOrganizationProfileDownstreamSync` | FluentCRM, after Logto customData is already canonical | Logto organization `customData.civitasProfile` + `organization_profiles` operational row | FluentCRM Company is linked/updated and operation is `completed` | Logto remains canonical but FluentCRM conflict/error marks operation `partial_failed` | Retryable for timeouts/downstream errors; not retryable for conflicts/config/auth |
| `member_identity_downstream_sync` | `processMemberIdentityDownstreamSync` | FluentCRM, after Logto user identity is already canonical | Operation metadata with `logtoUserId`, previous/current email, name and phone | FluentCRM Contact updated or no matching contact found safely | FluentCRM errors after Logto success mark `partial_failed` | Retryable for timeout/downstream errors |
| `member_reset_password` | `processMemberResetPassword` | Logto only | Operation metadata with `logtoUserId` | If explicitly enabled, Logto Management API `PATCH /api/users/{userId}/password` regenerates password | If Logto/Civitas policy does not support safe admin reset, operation becomes `unsupported`/`failed_safe`; no local reset is created | Unsupported is not retryable; transient Logto failure can be retryable |
| `manual_retry` | `processSyncOperation` | None | Retry marker metadata | Marker consumed | N/A | Used only as compatibility marker |

## Logto v1.40.1 capability boundaries

Official Logto docs describe password reset in Console as generating a random password and the Management API capability as `PATCH /api/users/{userId}/password` to set/update a password. Civitas keeps this disabled by default (`LOGTO_ENABLE_ADMIN_PASSWORD_RESET !== true`) because a safe user-delivered reset link is not guaranteed by the Management API surface. When disabled, the worker records `unsupported` and does not create a local password reset authority.

MFA signals are read only when Logto user payloads expose fields such as `mfaVerifications`, `mfaEnabled`, `mfa.enabled`, or `twoFactorEnabled`. Session detail and spent-time aggregates are not mirrored locally; when Logto does not provide a reliable field in the current response, Civitas returns `not_available` / `not_loaded` and the UI displays `No disponible`.

## Running integration checks

```bash
cd backend
npm test
```

The worker can run with BullMQ/Redis when `REDIS_URL` or `BULLMQ_REDIS_URL` is set:

```bash
cd backend
npm run start:worker
```

Without Redis, the worker polls `sync_operations` directly as a safety net.
