# Fase 07 — plan de tres PRs Logto-first

## Principio común
Logto sigue siendo la fuente canónica de organizaciones, memberships, roles y permisos tenant-scoped. PostgreSQL conserva únicamente metadata operativa, reconciliación, auditoría, mappings y estado del bootstrap.

## PR 1 — Normalización y reconciliación Logto-first
**Responsabilidad:** estabilizar el flujo canónico de organizaciones antes de ampliar el provisioning.

Incluye:
- Parseo tolerante de respuestas no JSON de Logto Management API.
- Etapas persistidas del bootstrap: organización Logto creada, metadata enlazada, creator membership pendiente/completo, rol admin pendiente/faltante, bootstrap incompleto, sincronizado/reconciliado.
- Modelado explícito del rol faltante `organization_admin` como estado operativo recuperable, no como duplicación PostgreSQL-first del rol.
- Directorio owner con una fila por organización canónica de Logto y perfiles internos asociados como metadata de reconciliación.
- Auditoría de eventos parciales reales y errores por etapa.

No incluye branding, dominios avanzados, settings completos ni reorganización amplia de navegación.

## PR 2 — Provisionamiento ampliado de organización (#51)
**Responsabilidad:** extender el payload y la metadata operativa inicial de organización, asumiendo PR 1 estable.

Incluye:
- `slug`, dominio/subdominio admin y branding básico (`logo_url`, `favicon_url`, `primary_color`, `primary_color_dark`).
- Toggle de login experience por organización.
- Roles predeterminados iniciales como intención local hasta que Logto/plantillas los materialicen.
- Configuración inicial OIDC por organización y referencia segura de secreto (`oidc_application_secret` no se expone en respuestas).
- `settings` scaffold por organización para fases siguientes.

No incluye portal completo organization-admin, memberships, organization token real ni cambios grandes de navegación.

## PR 3 — Reorganización owner portal / árbol de navegación
**Responsabilidad:** limpiar la IA owner para soportar una fase larga sin mezclar backend canónico.

Incluye:
- Owner dashboard más liviano en `/owner`.
- Vista dedicada para “Organizaciones Logto / Civitas”.
- Renombrar “Auditoría” a `Logs`.
- Árbol desplegable Owner: Resumen, Organizaciones, Select Organization, Logs y Settings placeholder.
- Breadcrumbs consistentes con rutas SPA sin cambiar el modelo de sesión.

No incluye cambios al modelo Logto ni contratos backend salvo lectura mínima necesaria.

## Dependencias y orden
1. PR 1 reduce el riesgo de duplicados y bootstrap parcial antes de persistir más metadata.
2. PR 2 depende de los estados estables de PR 1 para no confundir configuración avanzada con canonicidad.
3. PR 3 depende de que las vistas existan y se puedan mover sin reabrir el contrato backend.

## Riesgos residuales
- La creación real de roles/plantillas Logto y application secrets requiere configuración operativa fuera de Civitas.
- Los campos OIDC avanzados quedan como scaffold local hasta implementar provisioning real contra Logto.
- La reconciliación automática de duplicados debe mantenerse conservadora para no borrar metadata operativa por error.
