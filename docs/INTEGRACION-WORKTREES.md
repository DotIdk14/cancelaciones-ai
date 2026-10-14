# Integración de worktrees

Se integraron los commits e751923, 2483765, 05d35b8 y 50a89f5 junto con los cambios locales de conciliación e historial, conservando los checkouts originales.

Las correcciones unifican el historial independiente y el historial integrado al menú contextual; mantienen la selección histórica de solo lectura, los borradores y el visor del expediente. La reasignación de Flokzu recibe el actor autenticado. Las respuestas históricas comprueban identidad y se ignoran después de cambiar de expediente. Las métricas usan el origen del dictamen incluso cuando es null.

Las migraciones pendientes tienen versiones únicas: 20261013100000 (métricas), 20261013103000 (conciliación Flokzu), 20261013110000 (índice de historial) y 20261013120000 (conciliación de solicitudes). No se aplicaron al backend. La publicación en main requiere primero completar el flujo de esquema descrito en MIGRATION-RECONCILIATION.md; el nuevo preflight falla cerrado si su RPC no existe.

Verificación: npm run verify:release pasó con lint, TypeScript, 105 pruebas del contrato de IA, 1.195 pruebas generales aprobadas, tres pruebas de IA en vivo omitidas por configuración y build correcto. Se mantienen 12 Functions. La advertencia de tamaño de bundle de Vite no bloqueó el build.
