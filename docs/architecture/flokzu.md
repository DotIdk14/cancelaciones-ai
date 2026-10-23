# Consulta directa de Flokzu

La importación Excel está retirada: no hay pantalla, parser XLSX, endpoint multipart ni dependencia ExcelJS. Las tablas de lotes y revisión administrativa, sus RPC y las columnas que bloqueaban auditorías fueron retiradas mediante migración. Las migraciones históricas se conservan para reproducir el esquema.

## Crear expediente

1. Abre **Nueva auditoría** e introduce una matrícula de exactamente nueve dígitos, conservando sus ceros iniciales.
2. Consulta Flokzu. Se muestran todos los trámites encontrados; solo los identificadores CaVe se pueden incorporar como expedientes de cancelación. No se elige un ticket automáticamente.
3. Elige el CaVe. Un Coordinador puede elegir responsable; el Asesor se asigna a sí mismo conforme al RPC existente.
4. Crea el expediente. El servidor vuelve a comprobar que el ticket pertenece a la matrícula y trae el nombre del origen. No acepta nombres ni archivos arbitrarios para crear un expediente.

El servidor consulta los formularios existentes de n8n por POST. No requiere cambios en Apps Script ni credenciales administrativas de n8n. La respuesta HTML se interpreta con un parser sin ejecutar JavaScript; cualquier campo obligatorio ausente, matrícula distinta o adjunto inaccesible impide completar la carga.

## Contenido y procedencia

Se conserva la información administrativa y todos los campos de la tabla, comentarios de cada área, adjuntos e imágenes incrustadas. Los archivos solo se descargan desde los dos hosts de almacenamiento Flokzu permitidos, sin seguir redirecciones. Se validan los bytes, MIME, tamaño por archivo, cantidad y volumen total antes de escribir. Los enlaces temporales se usan para descargar; sus firmas y tokens no se persisten.

Los originales se guardan como evidencias con hash. `flokzu_data.acquisition.assets` registra ID de evidencia, origen sin query, campo, nombre y hash. Los comentarios importados quedan separados de la bitácora humana local. Solo BO/HelpDesk alimentan el contexto administrativo del auditor y permanecen como afirmaciones no acreditadas. Un dictamen histórico no es política ni resolución humana de la aplicación.

## Recuperación y límites

La identidad de creación se conserva en sessionStorage. La clave externa evita dos expedientes para el mismo CaVe; los archivos usan IDs deterministas por expediente, origen y hash. Una carga interrumpida queda `INCOMPLETE`, impide auditar y se recupera al repetir la matrícula y ticket. Solo pasa a `COMPLETE` después de confirmar todas las evidencias. No se inicia IA de auditoría al crear; el audio utiliza la preparación y cuota existentes.

Los casos existentes se identifican por su CaVe. Si están en DRAFT o tienen cero evidencias realmente guardadas, y el actor tiene capacidad de importación o es el responsable con escritura, respetando los bloqueos de revisión, se actualizan en el mismo expediente los datos administrativos, nombre y archivos. Se conservan originales y procedencia anteriores; no se duplica el expediente. La existencia de una auditoría anterior no impide recuperar archivos en esos dos supuestos: se conserva el intento y nunca se vuelve a ejecutar automáticamente. Los expedientes finalizados por el Coordinador o con una auditoría en curso mantienen sus bloqueos. Si ya tienen auditoría y no necesitan sincronización, se ofrece un enlace directo `#/casos/:id?audit=:auditId` al intento más reciente no retirado y no se modifica el expediente. Los demás casos se abren en consulta. La presencia de auditoría se comprueba nuevamente después de descargar y antes de guardar. La tarea o el estado reportados por Flokzu son datos de contexto: no bloquean la auditoría ni exigen una reactivación administrativa. El Asesor asignado trabaja con los permisos normales del expediente.

La ruta de colección existente sirve la consulta y creación: se mantienen las 12 Functions, sin migraciones ni nuevos servicios.

## Verificación

`npm run lint`, `npm test` y `npm run build`. Las pruebas usan exclusivamente datos sintéticos. Las comprobaciones manuales de origen se ejecutan sin persistir PII en Git ni escribir expedientes remotos.

### Alcance del Coordinador al sincronizar

La capacidad `canImportCases` autoriza al Coordinador a incorporar contenido de Flokzu en un CaVe existente aunque esté asignado a otro Asesor, como la importación de origen anterior. Esta autorización solo opera en la sincronización desde el portal, con matrícula y CaVe verificados: no modifica `caseOwnedBy`, asignación, autor, comentarios humanos locales, revisiones ni permisos de otras rutas. El Asesor sigue necesitando propiedad. Los casos consolidados y los bloqueos de revisión, finalización y auditoría en curso se conservan.

## Retiro de la revisión administrativa

La pantalla Revisión Flokzu y sus endpoints no existen. Nueva auditoría es la entrada única para consultar e incorporar un CaVe. La asignación y reasignación siguen en el expediente; se conservan las validaciones de rol y los bloqueos por consolidación, auditoría en curso y revisión humana finalizada. No se borran expedientes, evidencias, dictámenes ni comentarios locales.
