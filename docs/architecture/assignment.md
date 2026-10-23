> Referencia operativa con antecedentes históricos. Estado remoto del 23/10/2026: [informe vigente](../audits/cleanup-report.md). Para adquisición actual usar [Flokzu directo](../architecture/flokzu.md); no usar instrucciones retiradas de Excel o revisión administrativa.

# Asignación y vinculación de expedientes

La creación conserva `created_by` y guarda el responsable en `assigned_to`.
El Asesor se asigna a sí mismo. Coordinación puede elegir un Asesor o usar el
reparto por menor carga pendiente. El reparto excluye pruebas, fichas consolidadas
y revisiones finalizadas. Sin Asesores disponibles, el expediente queda sin asignar.
Un CaVe capturado en el alta manual conserva la capacidad del creador para
terminar la carga de archivos hasta la primera sincronización de datos Flokzu;
el Asesor asignado también puede trabajar. Un ticket ya sincronizado mantiene
la propiedad operativa exclusiva del responsable, como antes.

La creación, importación y vinculación comparten un bloqueo transaccional.
El identificador de petición permite recuperar una creación sin repetirla.
Un CaVe ya registrado produce conflicto, nunca otra ficha. Para crear un manual
cuando la matrícula tiene un expediente sin finalizar, se requiere confirmar
explícitamente que corresponde a otra solicitud. La matrícula conserva ceros
iniciales y no se convierte en una clave única de solicitudes.

## Importación diaria

La vista previa consulta coincidencias manuales de la matrícula. Propone vincular
solo si hay un manual reciente (siete días), nombre coincidente y un solo ticket
nuevo para esa matrícula en el archivo. La confirmación muestra esa propuesta y
permite sustituirla por otro expediente o confirmar una solicitud distinta.
Con varias coincidencias, nombres diferentes, expedientes antiguos o finalizados,
la selección es obligatoria. El servidor vuelve a comprobar el conjunto al
confirmar: un cambio concurrente exige generar otra vista previa.

Vincular completa el CaVe y los datos administrativos sobre el ID manual.
Preserva creador, responsable, estado, originales, auditorías y revisiones.
No se ejecuta IA al importar, asignar o consolidar.

## Reparación administrativa

`merge_empty_flokzu_shell` permite consolidar una ficha importada vacía sobre el
manual con trabajo. Exige matrícula y nombre coincidentes, proximidad temporal,
ausencia de otras solicitudes y ninguna auditoría en curso. La ficha secundaria
se archiva mediante `merged_into_case_id`; su identidad anterior y ambos
snapshots quedan en `case_merge_events`. Los eventos originales no se borran.
Si Flokzu restringe un manual que ya estaba activo, se conserva su actividad y
se marca una discrepancia para Coordinación, conforme a la elección del propietario.

`link_manual_cave_reference` completa un CaVe que aparece inequívocamente en el
nombre de un archivo original y todavía no existe en otro expediente.
`consolidate_confirmed_cases` se reserva para identidad confirmada por el
propietario; conserva cada archivo y dictamen en su expediente de procedencia.
El historial permite consultarlos y cuenta una sola solicitud. El secundario
deja de aparecer en las listas operativas y no admite nuevas auditorías.

Estos RPC solo son ejecutables por `project_admin`. No permiten que el navegador
se atribuya la autoría de una reparación administrativa. La tabla de eventos
conserva el usuario técnico que ejecutó la operación, el motivo y los snapshots.

## Migraciones y verificación

Se añaden cuatro migraciones incrementales, `20261014180000` a `20261014180300`.
Se aplican individualmente con el runner oficial después de verificar el ledger,
según `MIGRATION-RECONCILIATION.md`. No se reejecuta el baseline.

Las pruebas PostgreSQL locales ejecutan los cuatro archivos y comprueban reparto,
permisos, recuperación, vinculación, ambigüedades, conservación de originales,
consolidación e identidad de solicitudes. La suite de aplicación, lint y build
comprueban el contrato existente. Los datos reales y las exportaciones de
respaldo se conservan fuera de Git.

## Cierre en producción — 14 de octubre de 2026

Los cuatro archivos se aplicaron por el runner oficial en el backend aislado y
después en producción. El ensayo remoto verificó asignación, vinculación sobre
el mismo ID, preservación del autor y responsable, y repetición idempotente de
la confirmación. El fixture sintético quedó marcado `is_test=true`; se retiró
la membresía temporal de ensayo.

La reparación real archivó tres fichas importadas vacías, completó cuatro CaVe
y conservó dos manuales activos con discrepancia administrativa, conforme a la
elección expresa del propietario. La cuarta ficha secundaria identificada al
inicio ya había sido eliminada por otra operación antes de la reparación; se
completó el CaVe del expediente que permanecía. No se recrearon registros.

La comprobación de integridad comparó cantidades y huellas antes/después de la
misma operación: 22 evidencias (ID, expediente, hash, ruta y nombre), siete
auditorías completas, una revisión completa y siete comentarios completos.
Todas coincidieron. No se iniciaron llamadas de IA. Las exportaciones privadas
anteriores y posteriores, y las comprobaciones, están en
`tmp/assignment-repair/` del checkout original y están excluidas de Git.

La reparación y las protecciones de base están activas. Los cambios de interfaz
y endpoints se entregan en `codex/asignacion-contactos-sin-duplicados`; publicar
esa rama es un paso independiente. Los secundarios siguen consultables como
historial y la nueva lista operativa los excluye.
