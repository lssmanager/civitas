# Logto customData canonical schema

Logto is the canonical source for organization identity, users, memberships, organization roles, permissions, and `customData`. FluentCRM / WordPress remain canonical only for CRM records, tags, lists, and CRM-side custom fields. The Civitas database stores operational metadata, sync state, queue/audit/reconciliation state, and cross-system mappings only.

## Organization customData

New code must read and write the modern shape below. Functional entry URLs are derived from `appSubdomain` + `appBaseDomain`; `entryUrl` is a denormalized convenience value and must match those two fields.

```json
{
  "customData": {
    "provisioning": {
      "entryUrl": "https://demo.didaxus.com",
      "appSubdomain": "demo",
      "appBaseDomain": "didaxus.com",
      "institutionalDomain": "school.example.edu"
    },
    "civitasProfile": {
      "version": 1,
      "business": {
        "appSubdomain": "demo",
        "appBaseDomain": "didaxus.com",
        "entryUrl": "https://demo.didaxus.com",
        "institutionalDomain": "school.example.edu",
        "website": "https://school.example.edu",
        "nit": "123456789",
        "verificationDigit": "0",
        "country": "CO",
        "state": "Antioquia",
        "city": "Medellín",
        "postalCode": "050001",
        "addressLine1": "Calle 1 #2-3"
      },
      "contact": {
        "owner": "Ada Admin",
        "email": "ada@example.edu",
        "phone": "+573001112233"
      },
      "downstream": {
        "crm": {
          "companyName": "Colegio Demo",
          "tags": ["colegios"],
          "lists": ["onboarding"]
        }
      }
    }
  }
}
```

## User data

Administrative users and contacts are represented with Logto's user fields plus Civitas profile metadata:

```json
{
  "name": "Ana María Pérez Gómez",
  "primaryEmail": "ana@example.edu",
  "primaryPhone": "+573001112233",
  "username": "ana.perez",
  "profile": {
    "givenName": "Ana",
    "middleName": "María",
    "familyName": "Pérez",
    "preferredUsername": "ana.perez"
  },
  "customData": {
    "secondFamilyName": "Gómez",
    "civitasProfile": {
      "position": "Rectora",
      "phoneExtension": "123",
      "source": "owner_organization_provisioning"
    }
  }
}
```

## Deprecated fields

The following keys are compatibility-only and must not be used for new writes:

- `slug`: display/historical only; never functional for URLs, routing, redirects, or owner previews.
- `business.subdomain`: legacy alias; use `business.appSubdomain` and `business.appBaseDomain`.
- `department`: legacy territorial key; persist `state` even when frontend labels say Departamento/Estado/Provincia.
- `baseAdmin*` and `baseAdmin.*`: legacy creation model; use `administrativeContacts[]` as the only active organization-creation user-seeding contract.

## Logto-to-FluentCRM contact projection

FluentCRM contacts are transformed projections of canonical Logto users and organization membership. The standardized mapping is:

- `profile.givenName` + `profile.middleName` -> FluentCRM `first_name`.
- `profile.familyName` + `customData.secondFamilyName` -> FluentCRM `last_name`.
- top-level `name` -> `full_name` and `custom_values.profile_display_name`.
- top-level `primaryEmail` -> `email`.
- top-level `primaryPhone` -> `phone`.
- top-level `username` or `profile.preferredUsername` -> `custom_values.username`.
- effective Logto organization role names -> `custom_values.user_role` and role-derived tags/lists.
- `customData.civitasProfile.position` -> `job_title` and `custom_values.cargo`.
- `customData.civitasProfile.phoneExtension` -> `custom_values.phone_extension`.
- Logto user and organization IDs -> `custom_values.logto_user_id` and `custom_values.logto_id_organization`.

Every contact sync result should record `payloadSummary`, `fieldsSent`, `missingFields`, `providerStatus`, `providerCode`, and a conflict/validation reason in `sync_operation_steps.outputJson` or `lastErrorJson` so owner-facing screens can render per-contact diagnostics without treating PostgreSQL as a second contact truth.
