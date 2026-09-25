# Decisión del propietario: repositorio público con fuente normativa y datos de casos

**Fecha:** 2026-09-25
**Estado:** ACEPTADO
**Clasificación:** Precedencia operativa. **NO es fuente normativa.**

---

## Decisión

El repositorio `Dot idk14/cancelaciones-ai` permanece con visibilidad `public`, conservando:

- El PDF normativo `GDM_GAM_PRD_MLG_003` bajo `normative/`.
- Los reportes de casos reales bajo `docs/reports/`.

Esta decisión es del OWNER. No modifica, interpreta ni sustituye ninguna fuente normativa oficial.

## Contexto

En una auditoría del 2026-09-25 se detectó que:

- El commit `becfa9d` llevaba 32 archivos y solo se integró a `main` tras una intervención manual, sin ninguna validación automatizada previa.
- El repositorio expone material sensible: la fuente normativa y reportes de casos que contienen datos personales.

## Invariantes que esta decisión contradice

Se enuncian explícitamente como **contradicción aceptada**, no como permiso:

- `NO_PII_IN_GIT`
- `ONLY_OWNER_PROVIDED_POLICY_SOURCES`

La contradicción es deliberada y queda registrada aquí. No debe interpretarse como autorización para ampliar el conjunto de material expuesto.

## Riesgo asumido

- Exposición pública de material normativo y de casos con datos personales.
- La trazabilidad de *provenance* exigida por `PRESERVE_EVIDENCE_PROVENANCE` queda fuera de un control de acceso real: cualquiera con el enlace puede consultar el material.

## Mitigaciones acordadas

1. No usar los artefactos del repositorio como fuente de autoridad fuera de un entorno controlado.
2. Tratar cualquier material del repositorio como **interno**.

## Clasificación de precedencia

> Precedencia operativa aprobada por OWNER. NO es fuente normativa y NO crea reglas de política. No debe citarse como criterio en ningún dictamen.

## Revisión

Pendiente. El owner puede revertir esta decisión en cualquier momento.
