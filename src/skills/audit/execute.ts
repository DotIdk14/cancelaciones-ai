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

import { callOpenRouterAudit, type OpenRouterContentPart } from '../../server/openrouter';
import { parseAuditResult, type AuditResult } from './schema';
import { buildDossierHeader, buildSystemPrompt } from './instructions';
import { PROCEDURE_TEXT } from './procedure-v5';
import type { AuditSkillInput } from './types';

/** Umbral de texto extraído de un PDF para considerarlo "textual" (no escaneado). */
export const PDF_MIN_TEXT_CHARS = 80;

export interface AuditSkill {
  execute(input: AuditSkillInput): Promise<AuditResult>;
}

export const auditSkill: AuditSkill = {
  async execute(input: AuditSkillInput): Promise<AuditResult> {
    const { system, parts } = buildAuditMessages(input);
    const response = await callOpenRouterAudit({ system, parts });
    return parseAuditResult(response.parsed);
  },
};

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

    parts.push({ type: 'text', text: lines.join('\n') });
  }

  // 2) Luego las imágenes (base64 directo al modelo multimodal).
  for (const evidence of input.evidences) {
    if (evidence.imageBase64) {
      parts.push({ type: 'image_url', image_url: { url: evidence.imageBase64 } });
    }
    for (const pageBase64 of evidence.pagesBase64 ?? []) {
      parts.push({ type: 'image_url', image_url: { url: pageBase64 } });
    }
  }

  // 3) PDFs escaneados: se envían como archivo nativo (OpenRouter lo parsea).
  for (const evidence of input.evidences) {
    if (evidence.kind === 'PDF' && evidence.pdfBase64) {
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