# Matriz de trazabilidad normativa

| Fuente | Seccion | Paginas | Regla candidata | Archivo destino futuro |
|---|---|---:|---|---|
| GDM_GAM_PRD_MLG_003 v2 | 5.1 | 2 | GDM-5.1-B-001, GDM-5.1-D-001 | `packages/policy-engine` |
| GDM_GAM_PRD_MLG_003 v2 | 5.2 | 3 | GDM-5.2-B-001 | `packages/policy-engine` |
| GDM_GAM_PRD_MLG_003 v2 | 5.3 | 3-5 | GDM-5.3-A-I-001, GDM-5.3-A-II-001, GDM-5.3-A-III-001, GDM-5.3-C-001 | `packages/policy-engine` |
| GDM_GAM_PRD_MLG_003 v2 | 5.4 | 5-6 | GDM-5.4-A-001 | `packages/policy-engine` |
| GDM_GAM_PRD_MLG_003 v2 | 5.5 | 6 | GDM-5.5-A-001 | `packages/policy-engine` |
| GDM_GAM_PRD_MLG_003 v2 | 5.6 | 6-8 | GDM-5.6-A-001 | `packages/policy-engine` |
| GDM_GAM_PRD_MLG_003 v2 | 5.7 | 8-9 | GDM-5.7-D-001 | `packages/policy-engine` |
| GDM_GAM_PRD_MLG_003 v2 | 5.8 | 9-11 | GDM-5.8-A-001, GDM-5.8-G-001 | `packages/policy-engine` |
| GDM_GAM_PRD_MLG_003 v2 | 5.9 | 12 | GDM-5.9-A-001 | `packages/policy-engine` |
| GDM_GAM_PRD_MLG_003 v2 | 5.10 | 13 | GDM-5.10-A-001 | `packages/policy-engine` |
| GDM_GAM_PRD_MLG_003 v2 | 5.12 | 13-14 | GDM-5.12-A-001 | `packages/evidence`, `packages/policy-engine` |

## Phase 6 implementado

| Fuente | Regla | Implementación | Tests | Facts | Estado |
|---|---|---|---|---|---|
| GDM_GAM_PRD_MLG_003 v5 | 5.2 | `packages/policy-engine/src/index.ts` (`GDM-V5-5.2-A-CONTACT-ATTEMPTS`) | `packages/policy-engine/src/index.test.ts` | `contact.callAttempts`, `contact.writtenInteractions` | IMPLEMENTED |
| GDM_GAM_PRD_MLG_003 v5 | 5.8.a | `packages/policy-engine/src/index.ts` (`GDM-V5-5.8-A-UNREACHABLE`) | `packages/policy-engine/src/index.test.ts` | `contact.effectiveContact`, `classroom.hasActivities` | IMPLEMENTED |
| GDM_GAM_PRD_MLG_003 v2/v5 | Shadow evaluation | `packages/policy-engine/src/index.ts` (`compareHistoricalOutcome`) | `packages/policy-engine/src/index.test.ts` | machine outcome, human historical outcome, policy version | IMPLEMENTED |

Reverse trace: cada `EvaluatedRule.source` conserva documento, versión, sección y página; la API persiste la evaluación completa en `engine_runs.evaluation`.
