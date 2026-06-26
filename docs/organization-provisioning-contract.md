# Civitas organization provisioning contract

The active organization creation flow is Logto-first. `POST /owner/organizations` returns `202` by default with `operationId`, `statusUrl`, `canonicalStatus`, `downstreamStatus`, `correlationId`, and `sourceOfTruth: "logto"`. The final status is read from `sync_operations` and `sync_operation_steps`, not from the legacy bootstrap micro-request tables.

## Data ownership

- **Logto organization top-level:** `name`, `description`.
- **Logto organization `customData`:** `provisioning.appSubdomain`, `provisioning.appBaseDomain`, derived `provisioning.entryUrl`, derived `oidcRedirectUri`, `provisioning.institutionalDomain`, optional legacy `provisioning.slug`, plus `civitasProfile.business`, `civitasProfile.contact`, and `civitasProfile.downstream.crm`.
- **Logto user top-level:** `primaryEmail`, `primaryPhone`, `username`, `name`.
- **Logto user `profile`:** standard OIDC profile claims only: `givenName`, `familyName`, `preferredUsername`.
- **Logto user `customData`:** Civitas business metadata such as `civitasProfile.position` and `civitasProfile.phoneExtension`.
- **FluentCRM:** company/contact commercial payloads, tags, lists, segmentation, and CRM IDs.
- **Civitas PostgreSQL:** operational snapshots, retries, sync status, audit, reconciliation, read-model complements, technical mappings, and downstream errors. PostgreSQL may cache `appSubdomain` for operations, but it is not a parallel organization source of truth.

## Organization entry URL contract

`slug` is not a functional organization entry field. It may remain in payloads only as historical or commercial metadata, and must never be used to construct public hosts, previews, links, or OIDC redirect URIs.

The canonical entry fields are:

- `appSubdomain`: a single lowercase DNS label, for example `flacso`.
- `appBaseDomain`: one of exactly `didaxus.com`, `socialstudies.cloud`, or `learnsocialstudies.com`.
- `entryUrl`: derived only as `https://${appSubdomain}.${appBaseDomain}`.
- `oidcRedirectUri`: derived only as `https://${appSubdomain}.${appBaseDomain}/callback`.

Legacy organizations can be read from an existing `oidcRedirectUri` when its host is a single subdomain under an allowed base domain. If Civitas cannot derive both canonical fields safely, the read model must expose an operational inconsistency instead of inventing a hostname from `name` or `slug`.

## Retry and partial failure semantics

A canonical Logto organization may be created even when FluentCRM fails. In that case the operation is `partial_failed`, `canonicalStatus` stays `completed`, `downstreamStatus` becomes `failed`, and retryable details are recorded on the failed step. The owner UI should preserve the local draft after `202 queued` and can rehydrate from `payloadSnapshotJson.form` if the operation remains queued or partial-failed.

`organizationBootstrapMicroRequests` is retained only for legacy compatibility and targeted migration; pending/conflict UX must use `sync_operations` and `sync_operation_steps` as the active source of functional state.
