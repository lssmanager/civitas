# Learn Social Studies UI Baseline

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

## Restricción de esta entrega

Esta base trabaja únicamente el Nivel 1 de la hoja técnica: UI base sin autenticación. No introduce lógica de negocio ni contradice las reglas canónicas del proyecto.

## Dirección visual

- Azul principal para acciones primarias y navegación.
- Celestes para profundidad y superficies activas.
- Amarillo reservado a warning, renovación y señales de atención.
- Texto oscuro profundo sobre fondos muy claros.
- Cards con borde sutil, radio corto y una sola intención por bloque.
- La composición base debe sentirse operativa, no promocional: layout sobrio, grid estable, superficies limpias y jerarquía clara.
- Sidebar oscuro para navegación principal; contenido sobre superficies blancas con separación sutil.
- Hero o encabezado de contexto corto, con una sola idea principal y una columna lateral de apoyo, no un collage visual.
- Dropdowns, badges y modales deben verse discretos y funcionales; evitar efectos pesados y exceso de sombra.
- Botón primario en light theme: base `#1984EE`, hover `#ED9E1B` con texto oscuro para sostener mejor contraste visual.
- Botón primario en dark theme: base `#4B9EF1` con texto oscuro; hover `#F3B723` con texto oscuro para una respuesta más clara sobre fondos profundos.

## Reglas de composición por componente

- `Header`: marca visible, búsqueda, contexto activo y una sola acción primaria. Altura objetivo entre `68px` y `76px`.
- `Sidebar`: navegación principal persistente, bloques cortos, estado activo evidente y sin iconografía ornamental innecesaria.
- `Card`: encabezado fijo, cuerpo respirable, borde fino y fondo blanco. No usar gradients decorativos dentro de cards operativos.
- `Dropdown`: menú compacto, alineado al trigger, sin más de dos niveles y con acciones destructivas separadas del resto.
- `Forms`: labels claros, campos blancos, borde visible, focus azul y botones alineados al final.
- `Badges`: azules para estado informativo, amarillos para warning y rojos solo para error o bloqueo.
- `Tabla base`: encabezados suaves en mayúscula pequeña, filas limpias y columnas compactas para estado o métricas.
- `Modal`: solo para confirmación, revisión corta o creación rápida. No usar formularios largos en modal.

## Qué cambió tras la corrección visual

- Se eliminó el exceso de ruido visual en hero, tarjetas y fondos.
- Se redujo el protagonismo de efectos para priorizar estructura y lectura.
- Se pasó de una demo expresiva a una base visual más cercana a dashboard real.
- Se reforzó el uso del amarillo como acento funcional y no como color dominante.

## Estructura prevista para React-Bootstrap

- `Navbar`, `Container`, `Row`, `Col` para shell general.
- `Card`, `Table`, `ListGroup`, `Dropdown`, `Breadcrumb`, `Badge`, `Modal`, `Form` para componentes.
- CSS propio solo para tokens, branding y acabados.

## Nota de entorno

En este workspace el acceso al registro de paquetes está restringido. El código quedó preparado para Vite + React + Bootstrap, pero las dependencias no pudieron instalarse localmente aquí.
