# Fase 08.6 — Baja de usuarios y limpieza downstream en FluentCRM

## Fuentes canónicas

- Logto conserva la identidad de usuario, roles organizacionales y membresía organizacional.
- FluentCRM conserva datos comerciales/CRM y segmentación de comunicación.
- Civitas conserva solo external IDs, auditoría, timestamps, errores operativos y un resumen mínimo de sync/cleanup en `organization_profiles.settings.fluentcrmMemberCleanup`.

## Puntos de baja implementados

La acción explícita `POST /owner/organizations/:organizationId/members/:logtoUserId/deprovision` ejecuta:

1. auditoría de solicitud de baja;
2. baja de membresía en Logto mediante Management API;
3. auditoría del resultado Logto sin mutar roles globales;
4. limpieza downstream en FluentCRM;
5. persistencia local mínima del resultado resumido y auditoría detallada.

## Política de limpieza FluentCRM

La estrategia predeterminada es conservadora: `dissociate_only`.

Con `dissociate_only`, Civitas:

- localiza el contacto por `logtoUserId` o email canónico de Logto;
- si no hay contacto, registra `no_contact_found`;
- si hay duplicados, registra `duplicate_conflict` y no muta contactos;
- remueve la asociación a la Company de la organización cuando el contacto está vinculado a esa Company;
- remueve solo la tag/list determinística de esa organización;
- marca el contacto como `unsubscribed`;
- no afirma que el contacto fue eliminado.

Si `FLUENTCRM_CONTACT_CLEANUP_STRATEGY=hard_delete`, Civitas intenta `hard_delete` solo cuando no detecta membresías restantes del usuario en otras organizaciones Logto. Si el usuario pertenece o puede pertenecer a otra organización, vuelve a `dissociate_only`.

## Multi-organización

Antes de borrar definitivamente, Civitas consulta las organizaciones Logto conocidas y busca membresías restantes del usuario. Si existe membresía restante o no se puede probar exclusividad, no borra el contacto completo. Esta política evita:

- borrar datos de otra organización;
- remover tags/lists globales no relacionadas;
- confundir limpieza CRM con autoridad de permisos.

## Persistencia local mínima

Civitas guarda en `organization_profiles.settings.fluentcrmMemberCleanup` únicamente:

- estado resumido;
- estrategia aplicada;
- `logtoUserId`;
- mensaje operativo;
- timestamp;
- política de persistencia.

Esto no replica perfiles de contacto ni atributos de identidad. El resumen permite mostrar estado operativo en owner UI y diagnosticar fallos sin consultar payloads sensibles de FluentCRM.

## Estados visibles

La UI owner muestra estados legibles:

- `cleanup completed`;
- `cleanup failed`;
- `no CRM contact found`;
- `dissociated only`.

La UI evita decir “datos eliminados” salvo cuando FluentCRM ejecutó `hard_delete` explícito.
