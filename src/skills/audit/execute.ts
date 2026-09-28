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
import { parseAiAuditAssessment, type AuditResult } from './schema.js';
import { buildDossierHeader, buildSystemPrompt } from './instructions.js';
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
        const assessment = parseAiAuditAssessment(stripTechnicalMetadata(parsed));
        validateAssessmentReferences(assessment, input);
      },
    });
    const assessment = parseAiAuditAssessment(stripTechnicalMetadata(response.parsed));
    validateAssessmentReferences(assessment, input);
    return {
      result: {
        ...assessment,
        model: { provider: 'openrouter', model: response.model },
        usage: response.usage,
      },
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

  for (const evidence of input.evidences) {
    const lines = [
      `## Evidencia: ${evidence.filename}`,
      `ID: ${evidence.evidenceId}`,
      `Tipo detectado: ${evidence.kind}`,
      `MIME: ${evidence.mimeType}`,
      `Tamaño: ${evidence.sizeBytes} bytes`,
      `SHA-256: ${evidence.sha256}`,
      `Creada: ${evidence.createdAt}`,
    ];

    if (evidence.transcript) {
      lines.push('Transcripción (AssemblyAI):', evidence.transcript.transcript);
      if (evidence.transcript.durationSeconds !== null) {
        lines.push(`Duración: ${evidence.transcript.durationSeconds} s`);
      }
      if (evidence.transcript.speakers.length > 0) {
        lines.push(
          'Participantes:',
          ...evidence.transcript.speakers.map(
            (speaker) =>
              `  [${speaker.speaker} ${formatTimestampMs(speaker.start)}–${formatTimestampMs(speaker.end)}] ${speaker.text}`,
          ),
        );
      }
    } else if (evidence.text && evidence.text.trim().length > 0) {
      lines.push('Contenido:', evidence.text);
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
