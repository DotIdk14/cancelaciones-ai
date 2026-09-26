# Pruebas del motor normativo

## Principios

- Cada expectativa normativa debe citar documento, versión, sección y página.
- Las pruebas usan facts sintéticos o anonimizados; no se incorpora PII.
- Se comprueban límites y estados desconocidos, no sólo happy paths.
- V2 y V5 se ejecutan con el mismo input para verificar aislamiento.
- Un resultado histórico coincidente no se considera automáticamente exactitud
  de política.

## Cobertura actual

`packages/policy-engine/src/index.test.ts` cubre:

- aislamiento de fuentes V2/V5 y fingerprints distintos;
- facts faltantes que permanecen `UNKNOWN` y generan `BLOCKING`;
- distribución observable de interacciones escritas;
- días hábiles y fin de semana;
- comparación histórica indeterminada;
- incompatibilidad de versión histórica.

La cobertura normativa productiva actual se limita a las reglas implementadas
de 5.2 y 5.8. Las secciones pendientes y las dependencias normativas faltantes
se reportan como tales, no como reglas aprobadas.
