# Nuevo caso: evidencia obligatoria y notas de Back Office / HelpDesk — Plan

> **Para agentes implementadores:** SUB-SKILL REQUERIDO: usar `subagent-driven-development` (recomendado) o `executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para dar seguimiento.

**Objetivo:** En la pantalla "Crear caso" se capturan las notas de Back Office y HelpDesk y se cargan las evidencias iniciales. El alta exige al menos una evidencia para completarse. Dentro del expediente se conserva "Adjuntar evidencias" para cargas posteriores.

**Arquitectura:** Se reutilizan los contratos existentes (`POST /api/cases`, `POST /api/cases/:caseId/evidence`, UPSERT de comentarios por área). `NewCasePanel` pasa de formulario trivial a orquestador del alta: selección → creación → subida → notas → navegación. Sin endpoints nuevos y sin estado global.

**Stack:** React 18 + Vite + TypeScript estricto, Vitest + Testing Library (jsdom), API en Vercel Functions con InsForge server-side.

**Spec:** este documento. Las decisiones del owner tomadas el 2026-10-08: las notas se capturan en la pantalla de nuevo caso; las evidencias también; se exige al menos una evidencia; el botón de adjuntar evidencia permanece en el expediente.

**Origen:** flujo revisado en el repositorio el 2026-10-08. Este plan requiere commit explícito del usuario; no hacer deploy automático.

---

## Mapa de referencias (no releer archivos completos)

- `#/nuevo` monta `NewCasePanel`: `src/App.tsx:15`, `src/App.tsx:79`.
- `NewCaseForm` solo captura el identificador y navega de inmediato: `src/components/NewCasePanel.tsx:23-45`, `src/components/NewCasePanel.tsx:55-81`.
- Vista local/demo sin llamadas reales: `src/components/NewCasePanel.tsx:98-146`.
- Cliente de alta: `src/lib/api.ts:405-416`.
- Cliente de evidencia (binario crudo, `x-file-name` URL-encoded): `src/lib/api.ts:435-451`.
- Cliente de comentarios (UPSERT por área): `src/lib/api.ts:502-519` y `src/lib/api.ts:515` en adelante.
- Endpoint de alta: `api/cases/index.ts:23-33`.
- Endpoint de evidencia (valida MIME, tamaño y magic bytes; cuota antes de efectos): `api/cases/[caseId]/evidence/index.ts:31-140`.
- Endpoint de comentarios (404 para caso ajeno, validación Zod en servidor): `api/cases/[caseId]/area-comments/index.ts:27-55`.
- Uploader existente, carga secuencial y estado por archivo: `src/components/EvidenceUploader.tsx:13-17`, `src/components/EvidenceUploader.tsx:30-88`, `src/components/EvidenceUploader.tsx:90-117`.
- Notas rápidas (`BACK_OFFICE` y `HELPDESK` únicamente): `src/components/AreaQuickComments.tsx:28-41`, `src/components/AreaQuickComments.tsx:103-124`, `src/components/AreaQuickComments.tsx:152-183`.
- Expediente con uploader adicional y notas ya visibles: `src/components/CaseDetailPage.tsx:501-513`.
- Cobertura existente de notas: `tests/AreaQuickComments.test.tsx`. No hay tests de `NewCasePanel` ni del uploader.

## Estado del flujo descubierto

1. Hoy el alta es: capturar identificador → `POST /api/cases` → navegar. No hay selección de archivos ni notas en esa pantalla.
2. `EvidenceUploader` requiere un `caseId` ya existente, por lo que hoy no puede usarse antes de crear el caso.
3. El servidor crea la fila del caso antes de que exista evidencia. Ése es el punto que decide la Fase 1.
4. Los comentarios se guardan por área con UPSERT y solo existen `BACK_OFFICE` y `HELPDESK` como notas rápidas.

---

## Restricciones globales

- No crear archivos nuevos en `api/`: el presupuesto de Vercel Hobby está en 12 de 12 Functions.
- Validación de entrada siempre en servidor; el cliente nunca es laauthority.
- Preservar verificación de magic bytes, cuota antes de efectos persistentes y autorización de dueño con 404.
- Las notas son contexto humano: no son política ni evidencia, no se envían como criterio y no re-auditan solas.
- Copia de interfaz en español, coherente con el tono existente.
- Sin dependencias nuevas y sin librería de modal u overlay.
- Accesibilidad mínima: etiquetas asociadas, estado de progreso anunciado y errores vinculados al formulario.
- TypeScript estricto; nada de `any` implícito.

## Review Focus

- Ningún archivo seleccionado: el alta no debe completarse ni llamar al servidor.
- Éxito parcial (al menos un archivo bien, otros fallan): debe completar el flujo y no volver a subir los ya exitosos.
- Fallo total de subidas tras crear el caso: no navegar y no presentar el alta como exitosa; ofrecer reintento.
- Audio: una subida exitosa puede quedar en transcripción en curso; eso no es un fallo del alta.
- Fallo al guardar notas con caso y evidencia ya creados: reintentar solo las notas, sin rehacer lo anterior.

---

## Fase 1 — Cerrar el contrato antes de codificar

**Decisión registrada (owner, 2026-10-08): Opción A.** La exigencia de evidencia es una condición del flujo de interfaz, no una garantía de datos. Se reutilizan los endpoints existentes, sin cambios de servidor y sin Functions nuevas.

Consecuencia aceptada: si la creación del caso tiene éxito y fallan todas las subidas, la fila del caso queda persistida sin evidencia aunque la interfaz no navegue. Ese escenario se maneja en la interfaz mostrando el error y permitiendo reintentar la carga; no se intenta compensar en el servidor.

- [x] **Paso 1.1** Confirmado: la exigencia es de interfaz, no de persistencia.
- [x] **Paso 1.2** Aplicable: Opción A. Sin cambios en `api/**` ni en `src/server/**`.
- [x] **Paso 1.3** Decisión registrada aquí antes de empezar la Fase 2.

Motivo: `POST /api/cases` crea la fila antes de que exista evidencia. La validación en cliente no garantiza nada sobre datos persistidos. Ningún implementador debe asumir atomicidad que el contrato actual no ofrece.

---

## Fase 2 — Pruebas primero (TDD)

- [ ] **Paso 2.1** Crear `tests/NewCasePanel.test.tsx` con el caso base: sin archivos seleccionados, el botón de alta no dispara `createCase`.
- [ ] **Paso 2.2** Añadir el caso: con archivos seleccionados, el alta dispara `createCase`.
- [ ] **Paso 2.3** Añadir el caso: creada la evidencia y con éxito en al menos un archivo, navega a `#/casos/:id`.
- [ ] **Paso 2.4** Añadir el caso: si todos los archivos fallan, permanece en la pantalla, no navega y permite reintento.
- [ ] **Paso 2.5** Añadir el caso: éxito parcial completa el flujo e informa cuáles fallaron, sin volver a subir los exitosos.
- [ ] **Paso 2.6** Añadir el caso: error de creación conserva el formulario y los archivos seleccionados.
- [ ] **Paso 2.7** Añadir el caso: las notas de ambas áreas se guardan asociadas al caso nuevo.
- [ ] **Paso 2.8** Añadir el caso: notas vacías no bloquean el alta.
- [ ] **Paso 2.9** Añadir el caso: error al guardar notas se muestra separado y no pierde el estado de la subida exitosa.
- [ ] **Paso 2.10** Si se refactoriza `EvidenceUploader`, crear `tests/EvidenceUploader.test.tsx` cubriendo selección múltiple, carga secuencial, éxito parcial, fallo total, re-selección del mismo archivo y anuncio accesible de progreso.

Criterio: cada prueba falla antes de implementar y pasa después. Durante el desarrollo ejecutar solo estos archivos, nunca la suite completa.

---

## Fase 3 — Interfaz de nuevo caso

- [ ] **Paso 3.1** Reorganizar `NewCaseForm` (`src/components/NewCasePanel.tsx:23-95`) en tres secciones: Información del caso, Evidencias iniciales, Notas de Back Office y HelpDesk.
- [ ] **Paso 3.2** Habilitar el envío solo con al menos un archivo seleccionado, comunicando los formatos desde `EVIDENCE_ACCEPT` (`src/lib/labels.ts`).
- [ ] **Paso 3.3** Mostrar por archivo: nombre, tamaño, estado y error, con región `aria-live` para el progreso.
- [ ] **Paso 3.4** Orquestar en este orden: `createCase` → `uploadEvidence` por archivo → guardar notas disponibles → navegar solo si al menos una evidencia subió.
- [ ] **Paso 3.5** Lotes parciales: si al menos uno subió, permitir completar y listar los fallidos; si ninguno subió, permanecer en pantalla sin presentar el alta como exitosa.
- [ ] **Paso 3.6** Mantener `NewCasePreview` (`src/components/NewCasePanel.tsx:98-146`) como simulación local, sin llamadas a la API y sin indicar que los archivos se guardaron.
- [ ] **Paso 3.7** Reutilizar el uploader existente (`src/components/EvidenceUploader.tsx:30-88`) sin duplicar validaciones ni progreso; si requiere extraer una interfaz, conservar carga secuencial y mensajes por archivo.
- [ ] **Paso 3.8** Reutilizar `AreaQuickComments` para el alta, que hoy exige `caseId`: hacerlo reutilizable sin duplicar la lógica de guardado, y mantener su comportamiento de no re-auditar al guardar.

---

## Fase 4 — Expediente y límites de seguridad

- [ ] **Paso 4.1** Verificar que `CaseDetailPage` (`src/components/CaseDetailPage.tsx:501-513`) mantiene el uploader dentro de "Adjuntar evidencias" para archivos adicionales.
- [ ] **Paso 4.2** Si se toca servidor: validar entrada en servidor, conservar verificación de magic bytes, cuota antes de efectos, autorización de dueño con 404 y procedencia de la evidencia.
- [ ] **Paso 4.3** No crear archivos nuevos en `api/`: el presupuesto está en 12 de 12 Vercel Functions.

---

## Fase 5 — Validación y release

- [ ] **Paso 5.1** Ejecutar las pruebas de la Fase 2 y las de `tests/AreaQuickComments.test.tsx`; deben pasar.
- [ ] **Paso 5.2** Ejecutar `npm run typecheck`.
- [ ] **Paso 5.3** Ejecutar `npm run lint:secrets` y `npm run lint:contrast` si el cambio toca copy o estilos.
- [ ] **Paso 5.4** Ejecutar `npm run build`.
- [ ] **Paso 5.5** Si hubo cambio de endpoint, ejecutar las pruebas de API y seguridad correspondientes y confirmar que `api/` sigue con 12 archivos o menos.
- [ ] **Paso 5.6** QA manual: sin archivo, archivo inválido, una carga exitosa, lote mixto, todas fallan, audio con cuota o transcripción, notas vacías, notas guardadas, recarga del expediente y adjuntar evidencia adicional.
- [ ] **Paso 5.7** Commit solo con autorización explícita del usuario.

---

## Opciones de arquitectura

**Opción A — Flujo secuencial sobre las APIs existentes (recomendada para el alcance UX).**
Validar selección, crear el caso, subir archivos con el endpoint actual, guardar notas, completar y navegar si al menos una carga tuvo éxito. Reutiliza todo lo existente y no agrega Functions. Riesgo: si todas las cargas fallan, la fila del caso ya quedó persistida.

**Opción B — Alta atómica con contrato de creación ampliado.**
El servidor recibe y valida las evidencias antes de confirmar el expediente, con compensación explícita si Storage o DB fallan. Semántica más robusta, pero cambia una frontera de API y eleva el riesgo de inconsistencia. No implementar sin acordar esa garantía.

---

## Invariantes a preservar

- Los originales son inmutables: hash, nombre y procedencia se conservan.
- El MIME declarado no basta: el servidor sigue validando la firma real del archivo.
- Tamaño, MIME y cuota se validan antes de escribir Storage o DB.
- Las notas son humanas, no política ni evidencia; solo `BACK_OFFICE` y `HELPDESK`.
- Guardar notas o evidencia nunca dispara una reauditoría automática.
- InsForge permanece server-side; ningún secreto llega al bundle.
- El alcance se resuelve en servidor; un caso ajeno responde 404.
- El botón de subir evidencia dentro del expediente se mantiene.

---

## Agentes por fase

| Fase | Agente | Responsabilidad |
|---|---|---|
| 1 | `backend-api` y `revisor-codigo` | Decidir garantía de UI frente a garantía de datos antes de implementar. |
| 2 y 3 | `frontend-react` | TDD del alta y reutilización del uploader y de las notas. |
| 4, si aplica Opción B | `seguridad-apis` | Validación, orden de efectos, cuotas y autorización. |
| 5 y cierre | `revisor-codigo` | Revisión de invariantes, fallos parciales y accesibilidad. |

---

## Riesgos prioritarios

1. Caso vacío persistido cuando todas las subidas fallan tras crear la fila.
2. Éxito parcial: evitar duplicar la subida de archivos ya exitosos al reintentar.
3. Fallo al guardar notas con caso y evidencia ya creados: estado separado y reintento solo de las notas.
4. Audio: una carga exitosa puede quedar en transcripción en curso; la auditoría mantiene sus validaciones actuales.
5. Accesibilidad: etiquetas asociadas, progreso anunciado y errores vinculados al formulario.