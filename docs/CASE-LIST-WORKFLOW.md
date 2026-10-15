# Listado operativo de expedientes

La navegación se deriva en lectura con `src/lib/case-workflow.ts`. No cambia
`cases.status`, el assessment ni la revisión humana. El endpoint y los contadores
usan la misma clasificación; los filtros y el cursor incluyen la etapa elegida.

| Pestaña o lista | Condición persistida |
| --- | --- |
| Borradores | Cero evidencias y sin cierre humano final |
| En curso / Por auditar | Tiene evidencias y necesita una auditoría vigente; incluye preparación y auditoría en curso |
| En curso / Dictamen del Asesor | Dictamen IA vigente, sin revisión del Asesor |
| En curso / Cierre del Coordinador | Revisión del Asesor registrada, sin decisión del Coordinador |
| Completados | Decisión final del Coordinador registrada |
| Errores | Estado técnico `ERROR`, con evidencias y sin cierre humano final |

Todo conserva la lectura global existente. Los Asesores ven su trabajo propio
en En curso y sus revisiones finalizadas en Completados. Los errores abiertos
del Asesor se limitan a sus casos propios. Borradores conserva el alcance de
lectura general. Coordinador y Gerente conservan supervisión global, pero la
lista de cierre del Coordinador solo se ofrece y admite por API a quien tiene
`canFinalizeAnyCase`. Las guardas de escritura siguen siendo independientes.

Un cierre humano es terminal: conserva su lugar en Completados aunque la
proyección técnica del caso diga `ERROR` o no queden evidencias. El estado
mostrado en Todo distingue una auditoría terminada de un caso cerrado.

## Revisión de `codex/historial-auditorias-flujo`

Se inspeccionaron el commit base `b767b21` y sus cambios sin commit en el worktree
`auditoria-historial-flujo/cancelaciones-ai`, sin modificarlo.

Se integraron dos mejoras compatibles:

- El historial distingue auditoría vigente y anterior, manteniendo la revisión
  asociada a su auditoría original.
- El listado dice «Pendiente de nueva auditoría» cuando el dictamen anterior
  perdió vigencia, y lo clasifica en Por auditar si no hay revisión humana.

No se integró la propuesta de revisión por auditoría: elimina la unicidad por
caso, exige una migración pendiente y cambia el flujo humano actual. Sus bloqueos
de edición/reprocesamiento y la selección de comparación dependen de ese cambio;
el worktree no añade pruebas para validarlo. La comparación vigente sigue
usando el `audit_id` inmutable de la revisión. Aplicar solo esas piezas podría
desvincular una resolución histórica o impedir su comparación.

Este cambio del listado no requiere migraciones ni modifica recursos remotos.
