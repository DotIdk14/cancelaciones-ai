# Auditoría técnica y limpieza integral · 23/10/2026

## Alcance y estado inicial

Rama de trabajo: `codex/limpieza-integral-20261023`. HEAD inicial y main remoto: `38fe66f2eb6f81f49a79f72f5f90681b97f8d072`. Producción Vercel inspeccionada en ese mismo commit. Único cambio local encontrado al inicio: `docs/brain/repo-map.md`, conservado; su generación corresponde al observador/herramienta y no se editó a mano.

Se ejecutó el Check de frescura antes de consultar el mapa. Se inventariaron archivos versionados, dependencias, scripts, endpoints, componentes, servicios, variables, configuración, Markdown y SQL; se contrastaron detalles con código, ledger/catálogos remotos, bucket y deployment. Archivos ignorados y evidencias privadas no se incorporaron a Git. No se instalaron paquetes porque node_modules estaba disponible y el gate completo funcionó.

## Diagnóstico que determinó los cambios

README y arquitectura describían siete resultados, OpenRouter único, cascadas de intentos e importación anterior. El contrato define ocho resultados; el pipeline actual hace propuesta y contraste con proveedor elegido previamente. La importación Excel y bandeja administrativa Flokzu fueron retiradas.

Las notas históricas de migraciones y Notion todavía marcaban como pendientes versiones que el ledger remoto ya registra. Los permisos del Gerente incluyen administración acotada; no corresponde describirlo como incapaz de toda mutación. Documentación dispersa repetía el listado y seguimiento de expedientes. Se priorizó corregir estas discrepancias sin refactorizar servicios protegidos ni cambiar presentación.

## Cambios completados

- README reescrito con funcionalidades reales, permisos, flujo, tecnologías, carpetas, instalación, variables, datos, IA, despliegue, pruebas y mantenimiento.
- Arquitectura vigente centralizada en docs/architecture; guías y operación separadas de informes históricos.
- 29 rutas documentales reorganizadas: 22 documentos reubicados y siete fuentes fusionadas en case-workflow.md (reducción de seis documentos en ese grupo).
- Índices docs/README y architecture/README, inventario completo de Markdown y matriz de migraciones.
- Referencias relativas actualizadas, incluidas instrucciones de agentes y documentos raíz. Las fuentes normativas y rutas operativas del mapa no se trasladaron. Los diseños históricos de superpowers conservan ubicación; solo se corrigieron referencias.
- Historial de conciliación, auditorías y retiro Flokzu conservados con señalización histórica, separado del estado actual.
- Once páginas existentes de Notion actualizadas y verificadas por lectura posterior; sin crear páginas ni archivar contenido compartido.

El [inventario](document-inventory.md) enumera cada origen y destino, incluidos archivos que conservan ubicación. Las siete notas fusionadas son CASE-LIST-WORKFLOW, CONFIRMACION-CONTACTO, EXPEDIENTE-CONTEXTUAL, STUDENT-HISTORY, conciliacion-expedientes, UX-TRAZABILIDAD e INCIDENTE-PENDIENTES-Y-MENU. No se borró información normativa ni historial SQL.

## Código, dependencias y candidatos conservados

No se eliminaron módulos ejecutables ni dependencias y no se alteraron imports, contratos, autorización, auditoría, evidencia, resoluciones, métricas, modelos o UI. Los paquetes de runtime tienen consumidores en implementación; las herramientas de desarrollo tienen usos por configuración, tipos, scripts y pruebas. Una búsqueda textual que incluye package.json por sí sola no demuestra uso: se contrastaron imports y configuración.

La búsqueda de referencias detectó siete componentes de gráficas sin importadores de producto, layout.ts, case-links.ts y una página de mejora continua no conectada al router. Se conservan como deuda explícita: no se considera una función deshabilitada automáticamente eliminable y no se eliminan dependencias transitivas sin justificar su relación con Policy. La declaración pdfjs-worker.d.ts se consume por TypeScript, aunque no tenga importador textual.

La exploración estática detectó candidatos a ciclos en http/auth/quotas, openrouter/copilot, cases/dto/audit-versions/audit-fingerprint, procedure-v5/generated y dashboard/local-dashboard-preview. Incluye referencias de tipos y reexportaciones; **no prueba ciclos de ejecución defectuosos**. No se modifican módulos hoja ni el grafo operativo en esta limpieza. La suite completa terminó, sin reproducir un bloqueo de imports.

No se ejecutó un escáner de vulnerabilidades de dependencias; no se afirma ausencia de vulnerabilidades.

## InsForge y migraciones

Solo lectura mediante CLI y catálogos públicos: columnas, defaults, constraints/relaciones, índices, políticas, funciones, triggers y vistas. Resultado agregado en [infraestructura](infrastructure-evidence.json); no contiene claves ni filas operativas.

- Ledger oficial: 34 entradas, desde baseline remoto 0 hasta 20261022163849. Todas las 34 versiones SQL locales consultadas están representadas en el ledger.
- Las dos migraciones del 19 están aplicadas y sus objetos representados; case_reviews usa índice único por audit_id.
- Retiro administrativo del 22 representado: case_import_batches y flokzu_admin_events ausentes.
- Bucket evidencias privado.
- Catálogos: 674 columnas públicas de tablas/vistas, 115 constraints, 58 índices, 21 políticas, 180 funciones, seis entradas de triggers y 11 vistas. Incluyen extensiones y no constituyen un inventario exclusivo de objetos propios.

Clasificación individual en [migraciones](../operations/migrations.md): A para la cadena aplicada; D/F parcial para objetos administrativos sustituidos y antecedentes archivados. No se demostró una migración local B, C o E en esta lectura. No se confunde registro con equivalencia de cada sentencia: no se hizo una comparación semántica exhaustiva de todos los cuerpos SQL ni se ejecutaron verificadores DDL en producción.

**Corrección antes de publicar:** human-resolution sí está versionada y protegida por los hashes iniciales. Se confirmó con git ls-files --stage y git show HEAD:ruta; las 34 versiones locales están en Git y en el ledger remoto. .gitignore no elimina archivos ya seguidos. El diagnóstico inicial de archivo ausente fue erróneo; no hay SQL que recuperar ni migración nueva que aplicar por esta entrega. La reconstrucción completa desde cero sigue sin ensayarse.

No se borraron SQL históricos ni se modificaron RLS, permisos, datos o historial remoto.

## Vercel

CLI confirmó proyecto vinculado cancelaciones-ai y producción main READY en el commit inicial. El log de build remoto confirma instalación, compilación y publicación; la metadata registra doce funciones Node. vercel.json declara vite, npm ci, npm run build y dist, más fuentes PDF y runtime Linux de Copilot. El enlace local indica Node 24.x, CI Node 22 y engines >=22.12.0.

Se listaron 24 nombres de variables Production: todos tienen referencias de código. OPENROUTER_REVIEW_MODEL no está declarado en ese listado y usa el default de env.ts; QUOTA_HMAC_KEY usa el fallback ya implementado. Esto no recomienda ni realiza una rotación. No se imprimieron secretos ni se borraron variables. No se verificaron valores efectivos ni credenciales de Preview/Development.

La lista contiene un deployment ERROR anterior al arreglo del glob Copilot y uno posterior READY; no se atribuye toda falla histórica a una causa sin evidencia de su log. No hubo push ni deploy.

Existen referencias históricas a hosts diferentes de InsForge en AGENTS y .env.example: confirmar el proyecto enlazado antes de reutilizar configuración. No se cambió ninguna configuración protegida.

## Notion

[Registro de once páginas y verificación](notion-sync.md). Se corrigieron arquitectura, adquisición, pipeline, roles, migraciones aplicadas y estado de despliegue. Los bloques anteriores quedan expresamente históricos; propuestas y mejora continua deshabilitada no se presentan como funcionalidades habilitadas.

La búsqueda cubrió el árbol identificado del proyecto, no todo el workspace. No se encontraron duplicados demostrados entre esas once páginas y no se archivó contenido por conjetura. Los enlaces a documentos nuevos se incorporarán después de un push autorizado; el README remoto todavía refleja la versión publicada anterior.

## Validación concreta

`npm run verify:release` terminó con código 0:

| Comprobación | Resultado |
|---|---|
| Secretos públicos y contraste | Aprobados |
| ESLint y TypeScript | Aprobados |
| Contratos | 7 archivos, 112 pruebas aprobadas |
| Suite completa | 106 archivos aprobados, 2 omitidos; 1321 pruebas aprobadas, 4 omitidas |
| Build producción local | Aprobado; advertencia de chunk principal mayor a 500 kB |
| Endpoints, roles, evidencia, revisión y dashboard | Cobertura sintética existente de la suite; sin sesión remota real |
| Imports y ciclos | Inspección estática; candidatos conservados, sin diagnóstico falso de fallo runtime |
| Integridad | 372 hashes iniciales coinciden después del gate |
| Enlaces Markdown | Comprobación de destinos locales mediante verify-cleanup.mjs; no certifica URLs remotas ni anchors |

No se repitió inferencia IA sin necesidad. No se probó E2E autenticado con Google, adquisición de un expediente real, carga real de PII ni precisión del modelo con muestra representativa. No se ensayó crear una base InsForge desde cero. La lectura del esquema y el deployment no demuestra por sí sola la corrección integral de los flujos productivos.

## Policy íntegra

[Manifiesto SHA-256 inicial](protected-files.json) tomado antes de editar documentación, contra HEAD inicial. Protección conservadora de 372 archivos existentes: policy/** (incluidos Markdown), src/**, api/**, scripts/configuración, package.json/lockfile, migraciones versionadas y tests. No se agregó contenido normativo externo ni se cambiaron prompts o validaciones.

La comprobación compara bytes y detecta también eliminaciones. El build invocó el generador existente y la serialización mantuvo exactamente su hash. Las pruebas verifican regresiones sintéticas y los hashes verifican código idéntico; no implican determinismo del proveedor externo ni certificación de precisión.

## Pendientes y decisiones

**Preparado:** publicación de documentación con autorización posterior del usuario. El ensayo aislado de reconstrucción sigue como mantenimiento adicional; no bloquea esta entrega documental.

**Autorización recibida:** el usuario solicitó completar lo necesario para producción. La publicación Git y Vercel de esta entrega queda autorizada; no se requiere aplicar SQL ni modificar permisos.

**No verificado:** E2E autenticado, valores efectivos de secretos, preparación de Preview, precisión representativa del modelo, reconstrucción completa y equivalencia exhaustiva de cuerpos SQL.

**Deuda conservada:** módulos sin consumidor, candidatos a ciclos, advertencia de bundle, hosts históricos, documentos operativos con antecedentes fechados y laboratorio de mejora continua deshabilitado. La limpieza de código ejecutable queda deliberadamente sin cambios: no se presenta como realizada ni se confunde documentación reorganizada con eliminación de toda deuda.

No se realizaron cambios destructivos ni se perdió información operativa. El resultado queda revisable mediante Git. La publicación se registra en production-release.md.


## Comprobación del diff

La comprobación de espacios del diff general detecta espacios finales en docs/brain/repo-map.md, archivo generado que ya tenía cambios locales al comenzar y se conserva sin edición manual. La comprobación separada del resto del diff se registra al cierre. Los destinos locales de enlaces se verifican con node docs/audits/verify-cleanup.mjs; no se comprueban anclas ni disponibilidad web.

Cierre: verificación de 372 archivos protegidos sin diferencias y sin destinos locales de enlaces rotos. ESLint del verificador nuevo y diff --check excluyendo el mapa generado completados. Las decisiones de arquitectura y los procedimientos útiles de membresías, Storage, rollback y rotación del documento de despliegue anterior se recuperaron en overview y production-runbook.

## Verificación adicional autorizada para producción

Al preparar publicación, verify:release volvió a aprobar lint, TypeScript y 112 contratos, pero la suite por defecto tuvo dos timeouts (CasesPanel y security-regressions). Se repitió toda la suite con dos workers, sin cambiar sus límites: 1321 aprobadas y cuatro omitidas. El build posterior terminó correctamente. Esta incidencia se registra en production-release.md; no se relajaron pruebas ni permisos.
