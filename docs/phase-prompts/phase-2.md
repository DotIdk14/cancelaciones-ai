# CANCELACIONES AI
# PHASE 2 - INGESTA SEGURA DE EVIDENCIA

Estas iniciando Phase 2 de Cancelaciones AI.

Phase 1 termino PASS_WITH_WARNINGS. La fundacion tecnica ya existe: Next.js full-stack, monorepo pnpm, TypeScript strict, Tailwind, InsForge vinculado, auth SSR, database, migraciones reproducibles, tabla `audits`, `audit_log`, `policy_sources`, storage privado, CI y validaciones.

## 1. Precondition

Antes de implementar Phase 2 ejecutar:

```bash
git rev-parse --show-toplevel
git status --short
git check-ignore references/private-historical
git check-ignore .env
git check-ignore .insforge
```

El workspace debe ser un repositorio Git valido. `.env`, `.insforge/`, `references/private-historical/`, evidencias reales y PII deben estar ignorados. Si no existe repo Git valido, detenerse, corregir contexto o inicializar Git solo si este directorio corresponde al proyecto nuevo.

## 2. Objetivo

Implementar la primera parte real del flujo: auditoria -> subir archivos -> conservar originales -> registrar metadata -> calcular integridad -> listar evidencias.

Todavia NO procesaremos el contenido. Phase 2 termina cuando Cancelaciones AI puede almacenar evidencia de forma segura, privada, trazable y reproducible.

## 3. Invariantes

Leer y obedecer `AGENTS.md`, especialmente `POLICY_IS_IMMUTABLE`, `NO_PII_IN_GIT`, `PRESERVE_EVIDENCE_PROVENANCE`, `NO_PROCESS_LOCAL_DURABILITY`, `DO_NOT_DUPLICATE_IMPLEMENTATIONS`, `INSPECT_BEFORE_IMPLEMENTING` y `KEEP_IT_SIMPLE`.

Invariantes adicionales:

- ORIGINAL_EVIDENCE_IS_IMMUTABLE: un archivo original almacenado nunca debe reemplazarse silenciosamente.
- PRIVATE_STORAGE_ONLY: ninguna evidencia debe quedar publicamente accesible.
- DATABASE_AND_STORAGE_MUST_RECONCILE: una subida fallida no debe dejar silenciosamente una evidencia valida en DB sin archivo o un archivo huerfano sin registro conocido.

## 4. Scope

Implementar upload autenticado, multi-file upload, storage privado InsForge, metadata de evidencia, SHA-256, validacion de tipo/tamano, sanitizacion, provenance del original, audit log, listado de evidencias, acceso seguro posterior al original, manejo de errores, idempotencia/retries razonables, lifecycle de evidencia y tests.

## 5. Out Of Scope

No implementar PDF parsing, OCR, vision, OpenRouter, AssemblyAI, transcripcion, fact extraction, rule engine, conflict resolver, Dictamen.pdf, worker durable completo, thumbnails complejos ni embeddings.

Phase 2 termina en: ARCHIVO ALMACENADO + METADATA CONFIABLE.

## 6. Formatos Soportados

Disenar allowlist inicial para PDF, PNG, JPG, JPEG, WEBP, MP3, WAV, M4A, TXT, CSV, DOCX y XLSX. No habilitar formatos arbitrarios solo porque el navegador los acepta. Documentar allowlist final.

## 7. Validacion De Tipo

No confiar unicamente en `file.type` o `Content-Type`. Validar server-side hasta donde sea razonable mediante extension, MIME declarado, firma/magic bytes y estructura minima cuando corresponda. Si extension y contenido se contradicen: REJECT.

## 8. Tamano

Maximo inicial: 50 MB por archivo. Crear constante/configuracion autoritativa. Rechazar archivo vacio. Tests: 0 bytes, valido pequeno, exactamente limite, limite + 1 byte.

## 9. Estrategia De Upload

Antes de implementar, evaluar capacidades reales de InsForge Storage, Next.js y Vercel para archivos de hasta 50 MB. Preferir direct/private upload, signed upload o equivalente si existe de forma segura. Si no existe, implementar la alternativa server-side mas segura disponible. Documentar en `docs/adr/004-evidence-upload-strategy.md` con strategy, security, size handling, auth, failure handling y tradeoffs.

## 10. Autorizacion

Cada operacion debe verificar server-side `currentUser` y permiso sobre `auditId`. No aceptar simplemente `auditId` del request y escribir. Validar acceso antes de upload, list, download y retire.

## 11. Evidence ID

Generar `evidenceId` independiente del filename. Nunca usar filename como identificador tecnico.

## 12. Storage Key

Usar estrategia segura, por ejemplo `audits/{auditId}/originals/{evidenceId}/{safeFilename}`. No usar paths controlados por usuario. Prevenir `../`, slashes arbitrarios, control characters, path traversal y nombres excesivamente largos.

## 13. Filename

Guardar `original_filename` y `safe_filename`. No perder nombre original, pero nunca usarlo sin sanitizar para paths.

## 14. SHA-256

Calcular SHA-256 del archivo original sobre exactamente los bytes almacenados. Persistir `sha256` del original.

## 15. Modelo Evidence

Crear migracion reproducible para `evidences` con esquema minimo: `id`, `audit_id`, `original_filename`, `safe_filename`, `mime_type`, `detected_mime_type`, `size_bytes`, `sha256`, `storage_bucket`, `storage_key`, `status`, `uploaded_by`, `created_at`, `updated_at`.

No almacenar informacion normativa, OCR o AI aqui.

## 16. Storage URL

Para storage privado NO persistir como fuente autoritativa una signed URL temporal. La identidad permanente debe ser bucket + storage_key. Generar acceso temporal/autorizado bajo demanda. Solo persistir URL si se demuestra estable, privada, no expirable y sin bypass de autorizacion.

## 17. Lifecycle De Evidencia

Definir lifecycle pequeno: `PENDING`, `STORED`, `FAILED`, `RETIRED` o equivalente. Un registro solo queda disponible cuando metadata DB valida + objeto storage valido + hash calculado estan asociados.

## 18. Consistencia DB / Storage

DB + object storage no son una transaccion ACID conjunta. Disenar saga: create pending evidence -> upload object -> verify -> persist metadata/hash -> mark stored -> audit log. Si falla, marcar FAILED y/o eliminar objeto parcial. No esconder huerfanos.

## 19. Retries E Idempotencia

Refresh, doble click o retry no deben crear multiples objetos desconocidos facilmente. Separar idempotent retry de content deduplication. Dos archivos identicos pueden subirse intencionalmente.

## 20. Archivos Duplicados

Si el mismo archivo se sube dos veces manualmente, no asumir que debe desaparecer. Elegir comportamiento simple y documentarlo.

## 21. Original Inmutable

Nunca implementar overwrite de original. Una nueva version/reemplazo crea nuevo `evidenceId`.

## 22. Eliminacion

Preferir soft-delete/retired evidence sobre borrado fisico silencioso. Toda eliminacion debe quedar registrada.

## 23. Audit Log

Registrar `EVIDENCE_UPLOAD_STARTED` si aporta valor, `EVIDENCE_UPLOADED`, `EVIDENCE_UPLOAD_FAILED` y `EVIDENCE_REMOVED` cuando corresponda. Referenciar auditId, evidenceId, actor y timestamp sin duplicar PII innecesaria.

## 24. Provenance

Cada original es raiz de provenance: `EvidenceOriginal(id, sha256, storageKey)`. No implementar derived artifacts completos todavia, pero el modelo no debe impedirlos.

## 25. Acceso / Download

Implementar forma minima para validar storage: acceso authenticated, authorized, private y temporal cuando aplique. No exponer enlace publico permanente.

## 26. UI

En `/auditorias/{id}` o equivalente mostrar Nueva evidencia, drag & drop, selector multi-file, nombre, tipo, tamano, estado y fecha. No implementar OCR, preview complejo o analisis.

## 27. Progreso

No implementar pseudo-worker. Mostrar progreso de upload solo si la estrategia elegida lo permite de forma simple.

## 28. Audit Status

Subir evidencia no debe marcar auditoria como `PROCESSING`. Puede seguir en preparacion/draft hasta fase futura de `AUDITAR`.

## 29. Multi-file

Debe ser posible subir varios archivos como evidencias independientes. Si uno falla, no todos deben fallar necesariamente; la UI debe mostrar resultados parciales.

## 30. Error Handling

Mensajes claros en espanol para archivo grande, formato no permitido, MIME inconsistente, storage unavailable, DB failure, upload interrupted, unauthorized y audit missing. No mostrar stack traces, raw SQL, provider secrets ni raw provider responses sensibles.

## 31. Logging

Logs tecnicos sin contenido del archivo, texto de evidencias, correos, telefonos o matriculas.

## 32. Migration

Crear nueva migracion reproducible `phase-2-evidence-ingestion`. NO editar silenciosamente la migracion ya aplicada de Phase 1.

## 33. Legacy

Revisar `docs/legacy/assessment.md`. Reutilizar codigo tecnico de upload solo si no mezcla politica, no expone storage publico, no rompe auth, no depende de estado local y reduce realmente codigo.

## 34. InsForge Existente

Usamos proyecto InsForge existente `Cancelaciones`. Antes de crear tablas/buckets nuevos inspeccionar estado actual. No borrar ni modificar recursos legacy ajenos. Si hay colision, documentar y detener esa parte.

## 35. Tests Unitarios

Minimo: filename sanitization, size boundary, allowed/disallowed type, MIME/signature mismatch viable, SHA-256 conocido, storage key generation, authorization helper, repository mapping.

## 36. Test De Integracion

Si InsForge disponible: crear auditoria sintetica, subir archivo sintetico pequeno, verificar objeto privado, evidences row, hash, audit_log, acceso autenticado y limpiar fixture. No usar archivos reales.

## 37. Test 50 MB

No almacenar repetidamente un archivo de 50 MB en CI. Validar logica del limite y documentar que la estrategia de transporte soporta el requisito. Si puede hacerse razonablemente en desarrollo, registrar resultado.

## 38. Security Review

Crear `docs/security/phase-2-security-review.md` y verificar bucket privado, authorization, no public URLs, MIME/type validation, size limit, filename sanitization, safe storage key, no secrets client-side, PII logging, access route y failure cleanup.

## 39. Documentacion

Crear/actualizar `docs/adr/004-evidence-upload-strategy.md`, `docs/architecture/evidence-ingestion.md`, `docs/security/phase-2-security-review.md`, `docs/reports/phase-2-report.md`, `docs/phase-prompts/phase-3.md` y `docs/architecture/data-model.md` si corresponde.

## 40. Phase 3

Phase 3 sera jobs durables + idempotencia del pipeline. No implementarla ahora, pero dejar evidencias persistidas referenciables mediante `auditId`, `evidenceId`, `storageKey`.

## 41. Validaciones Finales

Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `git status --short`. Verificar que no aparezcan archivos subidos, fixtures con PII, `.env`, tokens, historical PDFs ni `.insforge` como cambios versionables.

## 42. Definition Of Done

Phase 2 solo puede ser PASS si hay repo Git valido, migracion evidence creada/aplicada, upload autenticado real, autorizacion por audit validada, bucket privado validado, archivo sintetico almacenado, original no modificado, size limit, type validation server-side, filename sanitization, storage key seguro, SHA-256 correcto, metadata persistida, estrategia DB/storage, lifecycle evidence, acceso privado, audit log, UI upload/listado, multi-file, no PII versionada, lint/typecheck/tests/build PASS, `phase-2-report.md` y `phase-3.md` autocontenido.

## 43. Gate

PASS si todo queda validado. PASS_WITH_WARNINGS solo con limitaciones externas que no afecten seguridad, integridad o Phase 3. BLOCKED si storage publico, auth bypass, overwrite silencioso, DB/storage inconsistente sin reconciliacion, integridad incorrecta, estrategia incompatible con plataforma, validaciones fallan, PII en Git o provenance perdida.

## 44. Remediation

Si queda BLOCKED, crear `docs/phase-prompts/remediation-phase-2.md` y NO generar Phase 3 como si el bloqueo no existiera.

## 45. phase-2-report.md

Debe incluir: Estado, Upload Strategy, Vercel/Next Constraints Evaluated, InsForge Storage, Authentication, Authorization, Evidence Schema, Migration, Supported Types, Type Detection, Size Limit, Filename Strategy, Storage Key Strategy, SHA-256, Lifecycle, DB/Storage Consistency, Retry/Idempotency, Original Immutability, Access/Download, Multi-file, UI, Audit Log, Security, Legacy Reuse, Tests, Integration Test, Lint, Typecheck, Build, Git/PII Check, Archivos creados, Archivos modificados, Riesgos, Limitaciones, Blockers, Technical Debt y Proxima fase.

## 46. Respuesta Final

Responder con PHASE 2 RESULT, UPLOAD STRATEGY, EVIDENCE STORAGE, DATABASE, AUTHORIZATION, INTEGRITY, SECURITY, TEST UPLOAD, VALIDATIONS, GIT/PII, RISKS, BLOCKERS, NEXT y REMEDIATION.

## 47. Regla Final

Phase 2 debe resolver una cosa muy bien: guardar la evidencia original de forma segura y trazable. No empezar a entender la evidencia todavia.

Al terminar debe poder responderse: quien subio este archivo, a que auditoria pertenece, cual era su nombre original, que bytes exactos se recibieron, cual es su SHA-256, donde esta almacenado, si sigue siendo el mismo archivo, quien puede acceder y que ocurrio si la subida fallo.

Comienza ahora. No avances a Phase 3 durante esta ejecucion.
