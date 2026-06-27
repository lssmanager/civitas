# Civitas sync worker operations

Civitas treats Logto as canonical and uses `sync_operations` / `sync_operation_steps` as operational work items. Redis/BullMQ is only a delivery backend; `backend/worker.js` also polls queued database operations so records are not orphaned when Redis is unavailable.

## Operation types

| operationType | Processor | First system touched | Snapshot/input | Success | partial_failed / degraded | Retry policy |
| --- | --- | --- | --- | --- | --- | --- |
| `organization_profile_downstream_sync` | `processOrganizationProfileDownstreamSync` | FluentCRM, after Logto customData is already canonical | Logto organization `customData.civitasProfile` + `organization_profiles` operational row | FluentCRM Company is linked/updated and operation is `completed` | Logto remains canonical but FluentCRM conflict/error marks operation `partial_failed` | Retryable for timeouts/downstream errors; not retryable for conflicts/config/auth |
| `member_identity_downstream_sync` | `processMemberIdentityDownstreamSync` | FluentCRM, after Logto user identity is already canonical | Operation metadata with `logtoUserId`, previous/current email, name and phone | FluentCRM Contact updated or no matching contact found safely | FluentCRM errors after Logto success mark `partial_failed` | Retryable for timeout/downstream errors |
| `member_reset_password` | `processMemberResetPassword` | Logto only | Operation metadata with `logtoUserId` | If explicitly enabled, Logto Management API `PATCH /api/users/{userId}/password` regenerates password | If Logto/Civitas policy does not support safe admin reset, operation becomes `unsupported`/`failed_safe`; no local reset is created | Unsupported is not retryable; transient Logto failure can be retryable |
| `provider_verification` | `processProviderVerification` | Logto, FluentCRM and WordPress live APIs | Snapshot with organization, optional `logtoUserId`, email and `fluentcrmCompanyId` hints | Live check returns `all_ok` or an expected first-login state | Missing membership/company/contact/link, provider conflict, timeout or auth errors are surfaced as actionable diagnostics | Retryable for provider timeouts and missing downstream provisioning; auth/config/conflict states require provider review or manual action |
| `manual_retry` | `processSyncOperation` | None | Retry marker metadata | Marker consumed | N/A | Used only as compatibility marker |

## Logto v1.40.1 capability boundaries

Official Logto docs describe password reset in Console as generating a random password and the Management API capability as `PATCH /api/users/{userId}/password` to set/update a password. Civitas keeps this disabled by default (`LOGTO_ENABLE_ADMIN_PASSWORD_RESET !== true`) because a safe user-delivered reset link is not guaranteed by the Management API surface. When disabled, the worker records `unsupported` and does not create a local password reset authority.

MFA signals are read only when Logto user payloads expose fields such as `mfaVerifications`, `mfaEnabled`, `mfa.enabled`, or `twoFactorEnabled`. Session detail and spent-time aggregates are not mirrored locally; when Logto does not provide a reliable field in the current response, Civitas returns `not_available` / `not_loaded` and the UI displays `No disponible`.

## Running integration checks

```bash
cd backend
npm test
```

The worker can run with BullMQ/Redis when `REDIS_URL` is set:

```bash
cd backend
npm run start:worker
```

Without Redis, the worker polls `sync_operations` directly as a safety net, so owner-triggered retries and `provider_verification` operations can still move from `queued` to `running` and then to `completed`/`partial_failed`/`failed`.

## Queue ownership and heartbeat

Two executable queues are worker-owned: `organization.bootstrap` for canonical organization bootstrap and `civitas-sync-operations` for downstream retries, contact upserts and provider verification. `owner-operational-center` is only a UI/audit context and must not be used as an executable queue.

The sync worker writes a heartbeat snapshot to PostgreSQL (`operational_metric_snapshots`, source `sync_worker_heartbeat`). Operational projections use that heartbeat plus `createdAt`/BullMQ timestamps to expose `jobAgeSeconds`, `worker_offline`, `worker_heartbeat_stale` or `stuck_in_queue` instead of leaving queued jobs with an unknown worker state.

## Live provider verification

Owner-triggered `provider_verification` is a worker-owned live check, not a local reconciliation projection. The owner action creates a new `sync_operations` row with `operationType: provider_verification`, records `provider_verification.started` as `queued_for_live_check`, and enqueues it on the sync-operation queue. The worker then records `provider_verification.live` while it queries Logto, FluentCRM and WordPress.

The result snapshot includes `level: live_provider_verification` and a `checks` object with the live facts Civitas observed: Logto organization/user/membership/roles, FluentCRM Company/Contact/company link, WordPress user/id/email match, and the FluentCRM Contact to `wp_user_id` link when both sides exist. Consolidated statuses are functional and UI-actionable: `all_ok`, `missing_logto_membership`, `missing_fluentcrm_company`, `missing_fluentcrm_contact`, `awaiting_first_wordpress_login`, `missing_contact_wp_link`, `provider_conflict_detected`, `provider_timeout`, and `provider_auth_error`.

WordPress user absence is not treated as a canonical identity failure. If Logto membership and FluentCRM provisioning are otherwise correct, Civitas reports `awaiting_first_wordpress_login` so owner can distinguish a normal first-login state from a real reconciliation issue such as `missing_contact_wp_link`.

Owner UI receives worker and queue context (`executionSource`, `queueStatus`, `workerHeartbeatState`, `jobAgeSeconds`) on pending rows, operational log rows and organization profile summaries. This allows the GUI to show whether work was consumed by BullMQ or by the DB polling fallback and to display `contacts_not_started` as a functional downstream state instead of a generic missing-contact message.

## FluentCRM member contact upsert retries

`member_identity_downstream_sync` now retries the same contact upsert contract used by the interactive FluentCRM member synchronization. The payload snapshot should include the Logto user and organization context (`logtoUserId`, `logtoOrganizationId` or operation organization), the current email/name/phone fields when available, and optionally `roleNames` if roles were already resolved. If `roleNames` is omitted, the worker resolves organization roles from Logto before calling FluentCRM.

The worker requires a linked `fluentcrmCompanyId` from the organization profile (or an explicit `companyId`/`fluentcrmCompanyId` in the payload). Missing company linkage is treated as a downstream partial failure, not as an invalid Logto organization. Duplicate FluentCRM contact matches remain non-retryable conflicts; FluentCRM validation errors keep sanitized payload diagnostics only.

Post-Company provisioning contact sync is scheduled asynchronously from the API path. The API response reports the contact sync as `queued`; the background task then updates `organizationProfiles.settings.fluentcrmContactSync` with `queued`, `synced`, `partial_error`, or `conflict` summary data without blocking the organization bootstrap response on downstream CRM latency.

## Contact progress observability

The worker now owns both queue families used by this integration: `organization-bootstrap` jobs and `civitas-sync-operations` retry/downstream jobs. Bootstrap contact propagation is executed inside the organization bootstrap worker after the FluentCRM Company step completes; standalone downstream retries are consumed from the sync-operation queue by `processSyncOperation`.

For FluentCRM contact propagation, the worker records per-contact steps using `fluentcrm_contacts.contact.<n>_of_<total>.<action>`. Each step includes `index`, `total`, `logtoUserId`, `email`, `fluentcrmCompanyId`, `action`, `result`, `retryState`, `requiresHumanAction`, and a functional `humanMessage` such as `Contacto 1/15: enviando a FluentCRM` or `Contacto 3/15: payload inválido, requiere acción humana`.

Final contact summaries include attempted, created, updated, failed, conflicts, retryAutomatic, retryManual, humanActionRequired, startedAt, finishedAt, and durationMs. The public status stays compatible (`synced`, `partial_error`, `conflict`) while `recoveryStatus` distinguishes `retry_pending`, `manual_retry_required`, and `human_action_required`.

## Company-blocked contact sync

If the `fluentcrm_company` step fails or does not return a usable Company id, the worker records the real Company failure diagnostics (`providerCode`, `providerStatus`, `humanMessage`, retryability and suggested action) and then records the contacts step as `contacts_not_started` with `reason: company_sync_failed`. This keeps Logto canonical completion separate from downstream failure and makes it explicit that contact propagation did not begin because the Company dependency was not ready.
