---
name: Cancelaciones AI
description: Espacio de operación para expedientes, evidencias y auditorías trazables.
colors:
  background: "#0b1112"
  surface-1: "#11191a"
  surface-2: "#172122"
  surface-3: "#202c2d"
  border: "rgba(168, 193, 186, 0.15)"
  text-primary: "#edf4f1"
  text-secondary: "#b5c3bd"
  text-muted: "#90a19a"
  accent: "#71d7c1"
  accent-strong: "#8ae3cf"
  accent-ink: "#10221e"
  success: "#75d2a3"
  warning: "#f0c274"
  danger: "#f18388"
  chart-origin-country: "#8ab9ee"
  chart-origin-channel: "#c0a1e5"
typography:
  body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "21px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  label:
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
  mono:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
    fontSize: "11px"
rounded:
  control: "8px"
  surface: "12px"
  floating: "16px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "38px"
  panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.surface}"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    height: "42px"
  status-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.warning}"
    rounded: "6px"
    padding: "3px 7px"
  dock:
    backgroundColor: "rgba(20, 29, 30, 0.97)"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.floating}"
    padding: "7px"
---

# Design System: Cancelaciones AI

## Overview

**Creative North Star: “Mesa de operación”**

La interfaz se organiza como un registro de flujo de casos: cada expediente debe conservar su identidad mientras el usuario se mueve entre lista, evidencias, dictamen y revisión. La densidad de información sirve a la operación diaria; las jerarquías distinguen el volumen auditado, lo que requiere atención y los resultados, sin convertir cada dato en una tarjeta dominante.

El mundo se construye con grafito, superficies apenas separadas, texto claro y verde petróleo para navegación, selección y acciones principales. La cabecera y el dock forman un shell compacto; tablas, controles y paneles mantienen una gramática compartida en las rutas. El producto se presenta en español y el acceso sigue siendo exclusivamente con Google.

**Key Characteristics:**
- Registro de casos con identidad y estados fáciles de localizar.
- Alta densidad de lectura con superficies contenidas y bordes discretos.
- Navegación inferior visible y filtrada por capacidades.
- Color semántico además de texto para distinguir estados.

## Colors

Grafito verdoso como base, texto marfil frío y un acento menta-petróleo de alto contraste; los estados usan tonos diferenciados y las series de origen tienen colores propios.

### Primary
- **Verde petróleo claro** (`#71d7c1`): foco, selección, acción principal, énfasis de marca y navegación activa.
- **Verde petróleo luminoso** (`#8ae3cf`): hover de la acción principal.
- **Tinta verde oscura** (`#10221e`): texto sobre el acento para conservar contraste.

### Secondary
- **Éxito verde** (`#75d2a3`): resolución favorable y estado exitoso.
- **Advertencia ámbar** (`#f0c274`): atención pendiente y vista previa local.
- **Error coral** (`#f18388`): errores y resultados desfavorables.
- **Azul de país** (`#8ab9ee`) y **lila de canal** (`#c0a1e5`): series separadas de origen en gráficas.

### Neutral
- **Grafito base** (`#0b1112`): fondo de aplicación.
- **Grafito de superficie** (`#11191a`): panel, cabecera y superficie base.
- **Grafito elevado** (`#172122`): controles, fondos internos y superficies secundarias.
- **Grafito profundo** (`#202c2d`): superficies terciarias, botones secundarios y chips.
- **Borde mineral** (`rgba(168, 193, 186, 0.15)`): separación discreta.
- **Marfil frío** (`#edf4f1`): texto principal.
- **Salvia clara** (`#b5c3bd`): texto secundario.
- **Salvia media** (`#90a19a`): texto auxiliar y etiquetas.

### Named Rules
**La Regla de Atención Operativa.** El acento identifica selección, foco o acción; los tonos semánticos distinguen resultados y no sustituyen la etiqueta textual del estado.

## Typography

**Display Font:** Inter (con `ui-sans-serif`, system-ui y sans-serif del sistema como fallback).
**Body Font:** Inter (con fallbacks de sistema).
**Label/Mono Font:** Inter para etiquetas; SFMono-Regular, Consolas y Liberation Mono para IDs y contenido monoespaciado.

**Character:** Sans-serif funcional, compacta y neutral; los números tabulares facilitan la comparación de métricas y fechas. La jerarquía se expresa sobre todo con peso, escala y espaciado, no con tipografías decorativas.

### Hierarchy
- **Display** (650, `clamp(28px, 4vw, 40px)`, `1.12`): título principal de acceso.
- **Headline** (650, `21px`, `1.2`): encabezados de vista y paneles importantes.
- **Title** (600–650, `13–16px`): título de panel, controles y elementos de tabla.
- **Body** (400, `14–16px`, `1.5`): lectura general y explicaciones.
- **Label** (550–650, `9–12px`, normalmente `1.1–1.2`): etiquetas de métricas, columnas, navegación y controles; algunas se muestran en mayúsculas.

### Named Rules
**La Regla de Lectura Escaneable.** Reserva números tabulares para datos cuantitativos; usa etiquetas compactas para metadatos, pero mantén fechas, resultados y texto explicativo legibles.

## Layout

El shell ocupa el viewport y separa cabecera, área de trabajo desplazable y dock como franja inferior propia; el dock no se superpone al contenido. La cabecera y el contenido se centran hasta un máximo de `1680px`. En escritorio, expedientes usa tabla y panel de vista previa; el detalle distribuye evidencias, visor y dictamen/revisión en columnas. Entre `761px` y `1100px`, el resumen coloca el total auditado en una fila y las métricas de atención en tres columnas. A `760px` o menos, el detalle y el resumen se apilan, el dock se reparte en el ancho disponible y las tablas conservan una región desplazable horizontal.

El ritmo observado usa pasos frecuentes de `4`, `8`, `12` y `16px`, con separaciones mayores de `20–24px` entre grupos. La cabecera mide `60px`; el contenido usa padding horizontal de `16px`, que se reduce a `14px` en móvil. El dock deja margen inferior con `safe-area-inset-bottom`.

## Elevation & Depth

La profundidad es principalmente tonal: fondo y tres niveles de superficie, además de bordes de bajo contraste. El panel común tiene una sombra corta y discreta; los menús flotantes y el dock usan sombras difusas más amplias para separarse de la superficie de trabajo.

### Shadow Vocabulary
- **Panel** (`0 1px 2px rgba(0,0,0,.16)`): separación sutil al reposo.
- **Menu** (`0 12px 34px rgba(0, 0, 0, 0.32)`): tooltips y elementos flotantes.
- **Dock** (`0 16px 42px rgba(0, 0, 0, 0.4)`): franja de navegación inferior.

### Named Rules
**La Regla de Profundidad Tonal.** Usa superficies y bordes para estructurar el contenido; reserva las sombras mayores para elementos flotantes identificables.

## Shapes

Los controles emplean radio de `8px`; paneles y superficies usan `12px`; el elemento flotante más amplio, el dock, usa `16px`. Las filas y controles pequeños pueden usar radios de `6–9px`. Los bordes son finos y de bajo contraste; líneas divisorias organizan tablas, pestañas y cabeceras. La zona de carga de archivos usa borde discontinuo para indicar que acepta archivos.

## Components

### Buttons
- **Shape:** `8px` (`--radius-control`), altura mínima de `38px`.
- **Primary:** fondo verde petróleo `#71d7c1`, tinta `#10221e`, padding base `8px 16px`.
- **Hover / Focus:** el primario aclara a `#8ae3cf`; foco visible de `2px` con offset de `2px`; el botón activo baja `1px`.
- **Secondary / Ghost / Danger:** secundario en superficie terciaria con borde; ghost con texto secundario que gana contraste al hover; danger con borde y fondo coral translúcido.
- **Icon buttons:** mínimo `40×40px`, con nombre accesible obligatorio.

### Chips
- **Style:** badges compactos con texto y borde de tono semántico; neutral usa superficie terciaria, y los tonos de marca/estado usan fondos translúcidos.
- **State:** pestañas seleccionadas se distinguen por fondo verde petróleo tenue y texto de acento; el estado siempre conserva su etiqueta.

### Cards / Containers
- **Corner Style:** `12px` para paneles, `8–10px` en piezas internas.
- **Background:** `surface-1`; el nivel `surface-2` diferencia contenido o controles anidados.
- **Shadow Strategy:** sombra baja para paneles; superficies y bordes realizan la mayor parte de la separación.
- **Border:** borde mineral de bajo contraste; divisores solo en encabezado, pie y filas.
- **Internal Padding:** `14–18px` en paneles y `14–16px` en métricas.

### Inputs / Fields
- **Style:** fondo `surface-2`, borde mineral, radio `8px`; campos principales tienen altura cercana a `42px`.
- **Focus:** contorno verde petróleo de `2px` con offset de `2px`; el buscador cambia el borde al recibir foco interno.
- **Error / Disabled:** errores conservan fondo y borde coral, mensaje explicativo y acción de reintento cuando aplica; deshabilitados reducen opacidad.

### Navigation
- **Style:** el dock centrado presenta icono Lucide, etiqueta visible y nombre accesible. Enlaces dependen de capacidades de sesión; la ruta activa conserva un punto de acento.
- **Hover / Focus:** ampliación moderada con movimiento breve entre el icono activo y sus vecinos; tooltip en puntero o foco; foco de teclado visible.
- **Mobile:** distribución horizontal compacta con etiquetas, sin ampliación dependiente de hover.

### Tables and evidence
Las tablas usan encabezados pequeños, cifras tabulares y divisores tenues; cada contenedor es una región accesible que permite desplazamiento horizontal con teclado. La evidencia seleccionada se marca con borde y superficie de acento. El detalle conserva el vínculo visual entre evidencia y dictamen mientras el contenido se desplaza.

### Loading and status
Los skeletons son neutros y discretos. Los estados de carga se anuncian semánticamente; los estados vacíos se presentan como tales y los errores conservan prioridad sobre carga o vacío. Las transiciones de control duran `140ms` o `210ms`, y se reducen con `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** usar los tokens de grafito y verde petróleo de `src/index.css` para mantener continuidad entre rutas.
- **Do** dejar el dock en la franja propia del shell y filtrar sus entradas por capacidades.
- **Do** separar visualmente volumen auditado, atención y resultados en las métricas.
- **Do** mantener texto claro junto al color de los estados y conservar el foco visible.
- **Do** respetar `prefers-reduced-motion` y los espacios seguros inferiores.

### Don't:
- **Don't** presentar datos faltantes como cero ni ocultar errores con estados favorables.
- **Don't** usar el acento como sustituto único del contenido o de la etiqueta de un estado.
- **Don't** convertir la tabla densa de escritorio en tarjetas ambiguas en móvil; conserva su región de scroll.
- **Don't** mostrar rutas o acciones que excedan las capacidades disponibles.
