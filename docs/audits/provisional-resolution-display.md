# Resolución orientativa visible con evidencia insuficiente

El contrato del Skill ya guarda `audit.provisionalResolution` para `EVIDENCIA_INSUFICIENTE`: resultado orientativo, motivo, sección y referencias a evidencia. La interfaz lo mostraba únicamente en una vista de revisión del Coordinador, de modo que no era visible al consultar el dictamen habitual.

`ProvisionalResolutionNotice` presenta ese dato persistido tanto en la pestaña Dictamen como junto al resultado del menú de contexto, incluidas consultas históricas. El resultado formal permanece `EVIDENCIA_INSUFICIENTE`, con la etiqueta de orientación provisional y una advertencia de que no está confirmada. Se muestran el motivo, sección V5, nombres de las evidencias referenciadas y títulos de los faltantes bloqueantes. No se asigna una probabilidad a esta alternativa ni se promete que será la resolución final.

Las auditorías sin orientación registrada lo indican sin inventar una. Los resultados distintos de evidencia insuficiente no muestran esta sección. No se modifican el assessment, revisiones humanas, métricas, API, permisos, Policy, Skill ni base de datos. No hay inferencias adicionales ni reauditoría de históricos.

Verificación: pruebas de presentación en ambos puntos de entrada, conservación del resultado original, consultas históricas y ausencia de llamadas de auditoría desde el nuevo bloque.
