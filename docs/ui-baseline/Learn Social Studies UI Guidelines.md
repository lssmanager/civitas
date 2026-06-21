# Learn Social Studies UI Guidelines

## Fuente canónica por dominio

- Logto: identidad, autenticación, organizaciones, membresías, roles, permisos y tokens.
- FluentCRM / WordPress: compra, renovación, estado comercial y segmentación CRM.
- Moodle: cursos, matrículas, progreso e historial académico.
- BuddyBoss: grupos, comunidad y membresías sociales.
- Base de datos Civitas: mapeos, auditoría, sincronización, colas y estado operativo.

## Qué no debe vivir canónicamente en PostgreSQL

- Organizaciones paralelas a Logto como verdad principal.
- Roles paralelos a Logto como modelo RBAC principal.
- Membresías canónicas fuera de Logto.

## Estado de esta entrega

Esta base cubre solamente el Nivel 1 visual: shell, navegación, cards, menús, formularios y estados base. No agrega autenticación ni lógica de negocio.

## Paleta aprobada

- Main color: `#1984EE`
- Main support: `#4B9EF1`
- Accent light: `#3CADF1`
- Accent strong: `#2259F2`
- Text: `#031C44`
- Background: `#F3F4F6`
- Surface: `#FAFBFD`
- Surface contrast: `#FFFFFF`
- Secondary gold: `#F3B723`
- Secondary gold strong: `#ED9E1B`

## Reglas visuales clave

- El azul principal gobierna acciones primarias, navegación y foco.
- El amarillo queda restringido a warning, renovación y atención funcional.
- Las cards deben sentirse operativas, no promocionales.
- El sidebar debe sostener navegación persistente con estado activo claro.
- Dropdowns y modales deben ser sobrios, compactos y fáciles de escanear.
- Las tablas deben priorizar lectura rápida con encabezados suaves y ritmo vertical limpio.

## Botones

- Light theme primary button: base `#1984EE`, hover `#ED9E1B`, texto hover `#031C44`.
- Dark theme primary button: base `#4B9EF1`, hover `#F3B723`, active `#ED9E1B`, texto oscuro para conservar contraste.
- Outline buttons: borde azul en light, borde claro en dark, hover cálido de baja intensidad.

## Componentes priorizados

- `Header`
- `Sidebar`
- `Breadcrumb`
- `Cards`
- `Dropdowns`
- `Forms`
- `Badges`
- `Tables`
- `Modals`

## Estructura técnica recomendada

- `Bootstrap` para layout y utilities.
- `React-Bootstrap` para componentes frecuentes.
- CSS propio solo para tokens, branding y acabados.
- Evitar duplicar estilos si Bootstrap ya resuelve estructura o estado base.
