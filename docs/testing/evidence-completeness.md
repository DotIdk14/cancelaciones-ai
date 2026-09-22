# Completitud de evidencia

Una colección observable distingue al menos `COMPLETE`, `PARTIAL` y
`UNKNOWN`. Una colección vacía sólo significa cero registros cuando la fuente
es `COMPLETE`; una vista paginada o una captura parcial no permite afirmar
ausencia.

Para una condición `count >= N`:

- `TRUE` si se observan al menos `N` elementos válidos, incluso con fuente parcial;
- `FALSE` sólo con fuente completa y menos de `N`;
- `UNKNOWN` con fuente parcial o desconocida y menos de `N`.

La extracción conserva los elementos y su provenance. La agregación posterior
puede combinar artifacts compatibles, pero no debe deduplicar eventos sin
identidad suficiente.
