# Civitas organization provisioning contract

The active organization creation flow is Logto-first. `POST /owner/organizations` returns `202` by default with `operationId`, `statusUrl`, `canonicalStatus`, `downstreamStatus`, `correlationId`, and `sourceOfTruth: "logto"`. The final status is read from `sync_operations` and `sync_operation_steps`, not from the legacy bootstrap micro-request tables.

## Data ownership

- **Logto organization top-level:** `name`, `description`.
- **Logto organization `customData`:** `provisioning.appSubdomain`, `provisioning.appBaseDomain`, derived `provisioning.entryUrl`, derived `oidcRedirectUri`, `provisioning.institutionalDomain`, optional legacy `provisioning.slug`, plus `civitasProfile.business`, `civitasProfile.contact`, and `civitasProfile.downstream.crm`.
- **Logto user top-level:** `primaryEmail`, personal `primaryPhone` only when it uniquely identifies the user without an extension, `username`, `name`.
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

## Bootstrap identity reconciliation and observability notes

The owner console bootstrap keeps Logto as the canonical source for identity, organizations, memberships, roles and tenant context. Civitas persists only operational sync state, audit trail, external mappings and reconciliation outcomes anchored to `logto_organization_id`; it must not create local mirror users or organizations to bypass Logto.

When provisioning administrative contacts, Civitas first resolves the Logto user by primary email. Many schools share one PBX/main phone across several contacts and identify people only by extension; Logto treats `primary_phone` as a unique basic user property, so that shared number must not be sent as top-level `primaryPhone` when an extension is present. Repeated test submissions can also reuse a personal phone with a different email, so blindly calling `POST /users` with a reused phone can return `422`. The conservative recovery is now:

1. resolve the requested user by email;
2. keep shared phone lines with extensions in Logto `customData.civitasProfile` and FluentCRM contact data instead of Logto top-level `primaryPhone`;
3. for personal phones without extension, detect whether the requested phone already belongs to another Logto user;
4. create or update the email-owned user while omitting only the conflicting `primaryPhone` when that conflict is recoverable;
5. record the omitted field and conflicting Logto user id in audit/operation metadata;
6. if Logto still rejects a `POST /users` validation, preserve sanitized validation details and classify the incident as `logto`.

This favors continuity for a valid organization bootstrap without inventing alternate local identities. If the user cannot be reconciled safely, the operation fails as a functional, non-retryable Logto validation incident. `/owner` should be read as business-facing sync state (queued, canonical, downstream, failed), while `/owner/system` should distinguish queue backlog/worker/Redis health from executed job failures. Logto validation failures block downstream FluentCRM; FluentCRM failures after canonical completion are partial failures because Logto remains authoritative.

### Tradeoffs evaluated

- **Email-only resolution vs email plus phone reconciliation:** email remains the identity anchor for the requested admin; shared organization lines with extensions are not Logto `primaryPhone`, and phone lookup is used only for extension-less personal phones to prevent avoidable `422` uniqueness failures.
- **Block on identity conflict vs controlled degradation:** Civitas continues when it can either model a shared line outside the unique top-level phone field or omit a non-authoritative conflicting personal phone while preserving traceability; it does not link a different phone-owned user to the requested email.
- **Hide validation details vs operational diagnostics:** public error bodies expose sanitized validation fields, codes and messages, while secrets and request payloads stay redacted.
- **Retry `422` vs fail fast:** Logto/FluentCRM 4xx validation incidents are marked non-retryable; transient timeouts and 5xx remain retryable.
- **Logto-only fix vs FluentCRM payload changes:** no broad FluentCRM payload change is required for this fix; downstream code already runs only after canonical Logto completion and records company/contact failures separately.

## FluentCRM contacts after Company provisioning

After Civitas ensures or links the FluentCRM Company for a Logto organization, it immediately schedules the reusable Logto-member-to-FluentCRM contact synchronization so the provisioning request does not wait on every downstream contact call. Logto remains the canonical source for organization membership and roles; Civitas reads current organization members and organization-scoped roles from Logto, maps those roles to FluentCRM tags/lists, and persists only the operational summary in `organizationProfiles.settings.fluentcrmContactSync`.

Administrative contact assignments are retained in the provisioning response for visibility, but contact writes are performed through the member synchronization pass to avoid duplicate or divergent upserts for the same Logto user.
