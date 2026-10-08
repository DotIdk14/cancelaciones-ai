// =============================================================================
// Audit Skill — ejecución (sección 4 del encargo).
// =============================================================================
// Concepción: `const result = await auditSkill.execute({ caseId, evidences })`.
//  1. Arma el prompt de sistema (instrucciones + Procedimiento V5 completo).
//  2. Arma el "expediente" como partes de contenido (texto primero, después
//     imágenes/archivos — recomendación de OpenRouter).
//  3. Llama al transporte OpenRouter.
//  4. Valida SIEMPRE con Zod (parseAuditResult). El backend no reclasifica.
// =============================================================================

import { callOpenRouterAudit, type OpenRouterAttemptDiagnostic, type OpenRouterContentPart } from '../../server/openrouter.js';
import { ApiError } from '../../server/http.js';
import { deriveCaseCycleStartDate, isIsoDateValue, parseAiAuditAssessment, type AuditResult } from './schema.js';
import { buildDossierHeader, buildSystemPrompt } from './instructions.js';
import { sanitizeFenceDelimiters, sanitizeTagDelimiters, wrapUntrusted } from '../sanitize.js';
import { PROCEDURE_TEXT } from './procedure-v5.js';
import type { AuditSkillInput } from './types.js';

/** Umbral de texto extraído de un PDF para considerarlo "textual" (no escaneado). */
export const PDF_MIN_TEXT_CHARS = 80;

export interface AuditSkill {
  execute(input: AuditSkillInput): Promise<AuditResult>;
  executeWithMetadata(input: AuditSkillInput, options?: { deadlineMs?: number }): Promise<{ result: AuditResult; model: string; usage: AuditResult['usage']; attempts: OpenRouterAttemptDiagnostic[] }>;
}

export const auditSkill: AuditSkill = {
  async execute(input: AuditSkillInput): Promise<AuditResult> {
    return (await this.executeWithMetadata(input)).result;
  },
  async executeWithMetadata(input: AuditSkillInput, options?: { deadlineMs?: number }) {
    const { system, parts } = buildAuditMessages(input);
    const response = await callOpenRouterAudit({
      system,
      parts,
      deadlineMs: options?.deadlineMs,
      validate: (parsed) => {
        const assessment = parseAiAuditAssessment(stripTechnicalMetadata(parsed), validationContext(input));
        validateAssessmentReferences(assessment, input);
      },
    });
    const assessment = parseAiAuditAssessment(stripTechnicalMetadata(response.parsed), validationContext(input));
    validateAssessmentReferences(assessment, input);
    return {
      // La derivación va AQUÍ y una sola vez: el assessment del modelo ya está
      // validado, así que `temporalAnalysis.cycleStartDate` ya pasó Zod y las
      // reglas de coherencia temporal. `case.cycleStartDate` no lo emite el modelo
      // y de ahí sale un solo lugar posible: la copia acreditada.
      result: deriveCaseCycleStartDate({
        ...assessment,
        model: { provider: 'openrouter', model: response.model },
        usage: response.usage,
        // Snapshot de lo que el modelo efectivamente vio en "Contexto de otras
        // áreas". Aditivo y armado por el servidor: `undefined` y `[]` significan
        // lo mismo para el expediente, pero el snapshot los distingue.
        areaComments: input.areaComments ?? [],
      }),
      model: response.model,
      usage: response.usage,
      attempts: response.attempts,
    };
  },
};

function stripTechnicalMetadata(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const { model: _model, usage: _usage, ...assessment } = parsed as Record<string, unknown>;
  return assessment;
}

/**
 * Contexto que la validación recibe del servidor (no de la respuesta del modelo).
 *
 * `schema.ts` es un módulo hoja: no consulta la base ni conoce el caso, así que
 * la fecha de inicio que el equipo capturó en `cases` se le entrega AQUÍ, en las
 * dos llamadas al parser (la del `validate` del transporte y la final), para que
 * ambas validen exactamente el mismo expediente que se le mandó al modelo.
 */
function validationContext(input: AuditSkillInput): { humanCycleStartDate: string | null } {
  return { humanCycleStartDate: input.humanCycleStartDate ?? null };
}

function validateAssessmentReferences(assessment: ReturnType<typeof parseAiAuditAssessment>, input: AuditSkillInput): void {
  const validIds = new Set(input.evidences.map((evidence) => evidence.evidenceId));
  const checkIds = (ids: string[], path: string) => {
    for (const id of ids) {
      if (!validIds.has(id)) {
        throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path} referencia evidencia inexistente: ${id}`);
      }
    }
  };
  assessment.evidenceSummary.forEach((item, index) => checkIds([item.evidenceId], `evidenceSummary.${index}.evidenceId`));
  assessment.facts.forEach((item, index) => checkIds(item.evidenceIds, `facts.${index}.evidenceIds`));
  assessment.timeline.forEach((item, index) => checkIds(item.evidenceIds, `timeline.${index}.evidenceIds`));
  assessment.conflicts.forEach((item, index) => checkIds(item.evidenceIds, `conflicts.${index}.evidenceIds`));
  // La fecha de inicio de ciclo es un hecho crítico: su evidencia se coteja con
  // el mismo criterio que cualquier otra referencia, porque un `cycleStartDate`
  // apuntando a una evidencia inexistente es una fecha sin respaldo real.
  checkIds(assessment.temporalAnalysis.cycleStartEvidenceIds, 'temporalAnalysis.cycleStartEvidenceIds');
  checkIds(assessment.temporalAnalysis.cancellationRequestEvidenceIds, 'temporalAnalysis.cancellationRequestEvidenceIds');
  // El país y el canal se proyectan a columnas del caso: igual que la fecha de
  // inicio, un valor afirmado sobre una evidencia inexistente es un dato sin respaldo.
  checkIds(assessment.origin.evidenceIds, 'origin.evidenceIds');
  checkIds(assessment.audit.supportingEvidenceIds, 'audit.supportingEvidenceIds');
  assessment.audit.missingEvidence.forEach((item, index) => {
    checkIds(item.relatedEvidenceIds, `audit.missingEvidence.${index}.relatedEvidenceIds`);
  });
  if (assessment.audit.provisionalResolution !== null) {
    checkIds(assessment.audit.provisionalResolution.evidenceIds, 'audit.provisionalResolution.evidenceIds');
  }
  assessment.audit.procedureChecks.forEach((item, index) => {
    checkIds(item.evidenceIds, `audit.procedureChecks.${index}.evidenceIds`);
  });
}

/**
 * Bloque del expediente con la fecha de inicio aportada por el equipo.
 *
 * Se rotula como lo que es —un dato que escribió una persona, no evidencia— y
 * se le dice al modelo qué espera el backend de él si decide usarla. Es el
 * único lugar donde el valor cruza al prompt, así que el rótulo no es adorno:
 * `TRACE_EVERY_DECISION` exige que el razonamiento declare de dónde salió cada
 * dato, y sin este rótulo el modelo no puede saber que esa fecha existe ni qué
 * obligaciones de trazabilidad trae.
 */
function humanCycleStartDateBlock(date: string): string {
  return `## Fecha de inicio de ciclo aportada por el equipo (DATO, no evidencia)

Fecha de inicio de ciclo: ${date}

La registró una persona del equipo en este caso y la academia puede ver quién y cuándo. Puedes usarla para sustentar temporalAnalysis.cycleStartDate, pero no es una evidencia del expediente y no acredita nada por sí sola: si la usas, deja cycleStartEvidenceIds vacío y explica en cycleStartEvidenceText que la aportó una persona. Si no la usas, cycleStartDate va en null y lo explicas en reasoning.`;
}

/**
 * Arma los mensajes del modelo. Expuesto por separado para poder testear
 * el ensamblado del expediente sin red.
 */
export function buildAuditMessages(input: AuditSkillInput): {
  system: string;
  parts: OpenRouterContentPart[];
} {
  const system = [
    buildSystemPrompt(),
    '',
    '# Procedimiento V5 (fuente normativa oficial)',
    '',
    PROCEDURE_TEXT,
  ].join('\n');

  const parts: OpenRouterContentPart[] = [];

  // 1) Texto del expediente primero (orden recomendado por OpenRouter).
  parts.push({
    type: 'text',
    text: buildDossierHeader({
      caseId: input.caseId,
      studentIdentifier: input.studentIdentifier,
    }),
  });

  // 1.1) Fecha de inicio que capturó el equipo (`cases.cycle_start_date`).
  //
  // POR QUÉ AQUÍ NO HAY `wrapUntrusted`: ese cercado existe porque el contenido
  // no confiable puede ser TEXTO LIBRE y, por lo tanto, llevar instrucciones.
  // Esta fecha no lo es — es un valor ISO que el endpoint validó con Zod antes de
  // escribirlo — así que no hay nada que sanear ni que pueda cerrar bloques o
  // abrir una etiqueta. Aun así se comprueba el formato aquí (`isIsoDateValue`):
  // si algún día una fila trajera otra cosa, no viaja al prompt en vez de
  // confiar en que siempre llegó limpia. Los comentarios de área, que sí son
  // texto libre de personas, siguen yendo cercados con wrapUntrusted más abajo.
  if (input.humanCycleStartDate && isIsoDateValue(input.humanCycleStartDate)) {
    parts.push({
      type: 'text',
      text: humanCycleStartDateBlock(input.humanCycleStartDate),
    });
  }

  for (const evidence of input.evidences) {
    // El NOMBRE del archivo lo envía el cliente en un header: también es dato no
    // confiable. Se sanea ANTES de escribirlo, pero se conserva en el encabezado
    // porque es el identificador legible de la evidencia para quien audita.
    const lines = [
      `## Evidencia: ${sanitizeFenceDelimiters(sanitizeTagDelimiters(evidence.filename))}`,
      `ID: ${evidence.evidenceId}`,
      `Tipo detectado: ${evidence.kind}`,
      `MIME: ${evidence.mimeType}`,
      `Tamaño: ${evidence.sizeBytes} bytes`,
      `SHA-256: ${evidence.sha256}`,
      `Creada: ${evidence.createdAt}`,
    ];

    if (evidence.transcript) {
      lines.push(
        wrapUntrusted(
          'TRANSCRIPCIÓN DEL AUDIO',
          evidence.transcript.transcript,
        ),
      );
      if (evidence.transcript.durationSeconds !== null) {
        lines.push(`Duración: ${evidence.transcript.durationSeconds} s`);
      }
      if (evidence.transcript.speakers.length > 0) {
        lines.push(
          wrapUntrusted(
            'PARTICIPANTES DE LA TRANSCRIPCIÓN',
            evidence.transcript.speakers
              .map(
                (speaker) =>
                  `[${speaker.speaker} ${formatTimestampMs(speaker.start)}–${formatTimestampMs(speaker.end)}] ${speaker.text}`,
              )
              .join('\n'),
          ),
        );
      }
    } else if (evidence.text && evidence.text.trim().length > 0) {
      lines.push(wrapUntrusted('CONTENIDO EXTRAÍDO DE LA EVIDENCIA', evidence.text));
    } else {
      const kind = evidence.kind;
      if (kind === 'IMAGE' || kind === 'PDF') {
        lines.push('(Esta evidencia se adjunta como contenido visual más abajo.)');
      } else {
        lines.push('(Sin contenido textual disponible.)');
      }
    }

    if (evidence.truncated && evidence.originalChars !== undefined) {
      lines.push(
        `ADVERTENCIA: contenido derivado truncado; se enviaron ${Math.min(evidence.text?.length ?? evidence.transcript?.transcript.length ?? 0, evidence.originalChars)} de ${evidence.originalChars} caracteres. No trates esta evidencia como completa si el dato requerido no aparece en el fragmento.`,
      );
    }

    parts.push({ type: 'text', text: lines.join('\n') });
  }

  // 1.5) Contexto de otras áreas (Back Office / HelpDesk): NO normativo, NO
  //      evidencia. El servidor ya lo cercó con wrapUntrusted (buildAuditInputs);
  //      aquí solo se inserta como bloque al final del expediente textual, y el
  //      system prompt le dice al modelo cómo tratarlo (AREA_COMMENTS_ARE_NOT_POLICY).
  if (input.areaComments && input.areaComments.length > 0) {
    parts.push({
      type: 'text',
      text: ['## Contexto de otras áreas (no normativo, no evidencia)', ...input.areaComments.map((entry) => entry.comment)].join('\n'),
    });
  }

  // 2) Luego el contenido visual de cada evidencia con marcador de contexto.
  for (const evidence of input.evidences) {
    if (evidence.imageBase64) {
      parts.push({
        type: 'text',
        text: `CONTENIDO VISUAL\nEvidence ID: ${evidence.evidenceId}\nArchivo: ${evidence.filename}\nPágina: 1`,
      });
      parts.push({ type: 'image_url', image_url: { url: evidence.imageBase64 } });
    }
    for (const [index, pageBase64] of (evidence.pagesBase64 ?? []).entries()) {
      parts.push({
        type: 'text',
        text: `CONTENIDO VISUAL\nEvidence ID: ${evidence.evidenceId}\nArchivo: ${evidence.filename}\nPágina: ${index + 1}`,
      });
      parts.push({ type: 'image_url', image_url: { url: pageBase64 } });
    }
  }

  // 3) PDFs escaneados: se envían como archivo nativo con el mismo marcador.
  for (const evidence of input.evidences) {
    if (evidence.kind === 'PDF' && evidence.pdfBase64) {
      parts.push({
        type: 'text',
        text: `CONTENIDO VISUAL\nEvidence ID: ${evidence.evidenceId}\nArchivo: ${evidence.filename}\nPágina: 1`,
      });
      parts.push({
        type: 'file',
        file: {
          filename: evidence.filename,
          file_data: `data:${evidence.mimeType};base64,${evidence.pdfBase64}`,
        },
      });
    }
  }

  return { system, parts };
}

/**
 * Formatea un tiempo de AssemblyAI como `mm:ss`.
 *
 * Los tiempos de `utterances[].start/end` vienen en MILISEGUNDOS y se copian
 * verbatim a `TranscriptData.speakers` (ver `src/server/assemblyai.ts`).
 * Ojo: `durationSeconds` sí está en segundos (`audio_duration`); mezclar ambas
 * unidades inflaba las marcas de tiempo del expediente x1000 (4 s se veían
 * como `66:40`).
 */
function formatTimestampMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
