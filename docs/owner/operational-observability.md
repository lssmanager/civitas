# Observabilidad operativa owner

`/owner` muestra salud funcional: operaciones pendientes, en ejecución, fallos parciales, fallos reintentables, organizaciones con propagación downstream incompleta e incidentes legibles. No muestra profundidad de cola, locks, payloads, stack traces ni métricas Redis como experiencia principal.

La fuente canónica de negocio sigue siendo Logto para identidad y organizaciones. Civitas persiste estado operativo en `organization_profiles`, `sync_operations` y `sync_operation_steps`; Redis/BullMQ se trata como sustrato técnico.

## Traducción funcional

El backend centraliza la traducción en `services/operationalObservability.js`:

- heartbeat stale con backlog técnico => “La sincronización está detenida; las solicitudes nuevas pueden quedar pendientes.”
- canonical completo con downstream en error/conflicto/pendiente => “Hay organizaciones creadas canónicamente con sincronización externa incompleta.”
- worker sin backlog peligroso => “Sincronización operativa al día.”

## Separación técnica

`GET /owner/operations/summary` alimenta el resumen funcional. `GET /owner/system/worker-health` y `/owner/system` exponen señales técnicas para soporte/infra: heartbeat, Redis, estados crudos de cola y oldest job age.
