# Production environment normalization for Role Mapping

The `/owner/settings/role-mapping` page reads operational mappings from Civitas PostgreSQL and external catalogs from Logto and WordPress. PostgreSQL stores only mapping state; Logto remains canonical for authorization and WordPress/FluentCRM/BuddyBoss remain external synchronization systems.

## Correct variables for learnsocialstudies.com

Use these values in the production deployment environment:

```dotenv
WORDPRESS_BASE_URL=https://www.learnsocialstudies.com
WORDPRESS_USERNAME=johansebastian.rueda@icloud.com
WORDPRESS_APP_PASSWORD=<wordpress application password>
WORDPRESS_ROLES_ENDPOINT=/wp-json/civitas/v1/roles
WORDPRESS_TIMEOUT_MS=10000

FLUENTCRM_BASE_URL=https://www.learnsocialstudies.com
FLUENTCRM_USERNAME=johansebastian.rueda@icloud.com
FLUENTCRM_APP_PASSWORD=<wordpress application password with FluentCRM permissions>
FLUENTCRM_TIMEOUT_MS=10000
```

## Known bad values to remove

Do not deploy these values:

```dotenv
FLUENTCRM_ROLE_SYNC_MAPPING_JSON=FLUENTCRM_ROLE_SYNC_MAPPING_JSON=
WORDPRESS_BASE_URL=johansebastian.rueda@icloud.com
WORDPRESS_USERNAME=www.learnsocialstudies.com
```

`FLUENTCRM_ROLE_SYNC_MAPPING_JSON` has been removed from Docker Compose and should be deleted from production environment settings. The GUI + PostgreSQL mapping tables are the primary operational path. If a temporary legacy fallback is intentionally needed outside Compose, set the value to only a JSON object, for example:

```dotenv
FLUENTCRM_ROLE_SYNC_MAPPING_JSON={"Teacher-org":{"tags":["teacher"],"lists":[]}}
```

## Operational checks

1. Confirm the runtime `DATABASE_URL` and the migration job `DATABASE_URL` point to the same PostgreSQL database.
2. Run `cd backend && npm run migrate` or keep `RUN_MIGRATIONS_ON_STARTUP=true` so migration `0015_normalize_role_mapping_schemas.sql` creates/repairs `crm_role_mappings` and `wordpress_role_mappings`.
3. Confirm WordPress exposes `GET /wp-json/civitas/v1/roles` and the configured user can authenticate with an Application Password.
