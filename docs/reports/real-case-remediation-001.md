# Real Case Remediation 001

## Alcance

Esta remediación revisa la auditoría `458a00ad-274b-4240-a55c-026dca7ec207`
sin incorporar el dictamen humano como evidencia. No se genera `Dictamen.pdf`
ni se avanza a Phase 7.

## ROOT CAUSES

- La extracción anterior guardaba un hecho por resultado visual y no consolidaba
  hechos del mismo tipo entre artifacts.
- La visión devolvía conteos numéricos, pero no eventos con fecha, canal y
  procedencia.
- La UI renderizaba cada fila almacenada; por eso repetía llamadas e
  interacciones y mostraba conteos distintos como si fueran equivalentes.
- La regla de nivel académico usaba la rama no licenciatura cuando faltaba el
  nivel.
- La pantalla procesaba jobs persistidos al abrir el expediente.

## CONTACT EXTRACTION

La corrida observada antes de la remediación contenía, sin datos personales:

- `student.level`: `Estudiante`, repetido desde resultados visuales.
- `contact.callAttempts`: conteos observados `15` y `7`.
- `contact.writtenInteractions`: conteos observados `7` y `6`.
- No había una colección consolidada de eventos con `channel`, `dateTime`,
  `status` y referencia individual a la región de la evidencia.

Esos conteos no podían tratarse como un total completo. La nueva estructura
conserva eventos observables, `observedCount`, `sourceCompleteness` y warnings.

## PARTIAL EVIDENCE HANDLING

Se detectan indicadores de paginación, páginas, scroll, controles de navegación
y rangos de registros. Esas colecciones se marcan como
`POTENTIALLY_PARTIAL` y `PARTIAL`; las filas visibles no representan todo el
universo. Si sólo existe un conteo sin eventos verificables, queda `UNKNOWN`.

## FACTS BEFORE

Los hechos llegaban como filas independientes por artifact y podían repetirse.
El motor recibía conteos o listas vacías sin una marca de completitud. La
ausencia de una colección no distinguía entre “cero contactos” y “colección no
extraída”.

## FACTS AFTER

- Se agregan llamadas e interacciones de todos los artifacts relevantes.
- Se deduplica sólo por canal, fecha/hora y estado cuando existe esa identidad.
- Se conservan `CALL`, `EMAIL`, `WHATSAPP` y `OTHER_WRITTEN`.
- Las colecciones tienen `COMPLETE`, `PARTIAL` o `UNKNOWN`.
- Se materializan nombre, matrícula, último acceso y accesos de plataforma si
  aparecen explícitamente.
- `NEVER` se conserva como observable; no se inventa modalidad de evaluación.
- La UI muestra una sola tarjeta por dato QA. Si persisten conteos incompatibles,
  muestra la discrepancia y no elige uno como total definitivo.

## ENGINE RESULT BEFORE

La corrida previa terminó `INDETERMINATE` y requería revisión. No podía
confirmar contacto efectivo ni actividad académica. También seleccionaba la
rama no licenciatura aunque el nivel no identificaba una categoría normativa
suficiente.

## ENGINE RESULT AFTER

Una colección `PARTIAL` o `UNKNOWN` produce `UNKNOWN` para cantidad y
distribución. La ausencia de nivel produce
`GDM-V5-5.8-A-ACADEMIC-LEVEL-UNKNOWN`, sin aplicar silenciosamente
`NON-LICENCIATURA`.

La nueva corrida debe conservar la corrida original, congelarse como nuevo
Fact Run y crear un Engine Run independiente. La ejecución local fue bloqueada
por la conectividad de OpenRouter (`fetch failed`); no se declara una corrida
remediada completada ni se usa un resultado parcial.

## HUMAN REFERENCE DIFFERENCES

CaVe-30390 permanece fuera de la Fact Run. Sólo es referencia histórica,
incluyendo sus discrepancias conocidas de fecha, intentos mínimos, comentario
BO y outcome humano. No se declara correcto o incorrecto automáticamente.

## TESTS

Fixtures sintéticos cubren seis correos, paginación, ausencia de colección,
agregación multi-artifact, nivel académico ausente y valores académicos
`NEVER`/modalidad desconocida.

Validaciones ejecutadas:

- `pnpm --filter @cancelaciones/policy-engine typecheck`
- `pnpm --filter @cancelaciones/web typecheck`
- `pnpm --filter @cancelaciones/policy-engine test`
- `pnpm --filter @cancelaciones/web lint`
- `pnpm --filter @cancelaciones/web test`

Todas pasaron.

## REMAINING UNCERTAINTIES

- Las imágenes reales necesitan una nueva ejecución visual desde una red con
  acceso a OpenRouter.
- Los conteos antiguos no pueden reconstruirse como eventos sin releer las
  evidencias originales.
- Contacto efectivo y nivel académico sólo deben derivarse de observables
  suficientes.

## PHASE 7 READINESS

**NO LISTO.** No avanzar a Phase 7 ni generar `Dictamen.pdf` hasta ejecutar una
nueva Fact Run y Engine Run sobre las evidencias originales, congelarlas,
compararlas con la corrida original y revisar las incertidumbres restantes.
