// =============================================================================
// Comparison Skill — ejecución.
// =============================================================================
//  1. Arma el prompt de sistema (instrucciones + Procedimiento V5 completo).
//  2. Arma el expediente: dictamen original, resolución humana y las evidencias.
//  3. Llama al MISMO transporte de IA que la auditoría (OpenRouter), con el
//     contrato `ComparisonResultSchema` y su límite de dos intentos.
//  4. Valida SIEMPRE con Zod y valida las referencias a evidencia.
// =============================================================================

import { callOpenRouterAudit, type OpenRouterAttemptDiagnostic, type OpenRouterContentPart } from '../../server/openrouter.js';
import { ApiError } from '../../server/http.js';
import {
  ComparisonResultSchema,
  parseComparisonResult,
  type ComparisonOutcomePayload,
  type ComparisonResultPayload,
} from './schema.js';
import { buildComparisonHeader, buildComparisonSystemPrompt } from './instructions.js';
import { PROCEDURE_TEXT } from '../audit/procedure-v5.js';
import { sanitizeTagDelimiters } from './sanitize.js';
import type { ComparisonSkillInput } from './types.js';

export interface ComparisonExecution {
  result: ComparisonOutcomePayload;
  model: string;
  usage: ComparisonOutcomePayload['usage'];
  attempts: OpenRouterAttemptDiagnostic[];
}

export interface ComparisonSkill {
  execute(input: ComparisonSkillInput): Promise<ComparisonOutcomePayload>;
  executeWithMetadata(input: ComparisonSkillInput, options?: { deadlineMs?: number }): Promise<ComparisonExecution>;
}

export const comparisonSkill: ComparisonSkill = {
  async execute(input) {
    return (await this.executeWithMetadata(input)).result;
  },
  async executeWithMetadata(input, options) {
    const { system, parts } = buildComparisonMessages(input);
    const response = await callOpenRouterAudit({
      system,
      parts,
      deadlineMs: options?.deadlineMs,
      // El contrato de salida del modelo es el de la COMPARACIÓN, no el del
      // dictamen: es lo único que este Skill emite.
      schema: ComparisonResultSchema,
      schemaName: 'CaseComparison',
      validate: (parsed) => {
        validateComparisonReferences(parseComparisonResult(parsed), input);
      },
    });
    const result = parseComparisonResult(response.parsed);
    validateComparisonReferences(result, input);
    return {
      result: {
        ...result,
        // La metadata la agrega el servidor desde OpenRouter real; el modelo no
        // puede declararla (mismo contrato que el Audit Skill).
        model: { provider: 'openrouter', model: response.model },
        usage: response.usage,
      },
      model: response.model,
      usage: response.usage,
      attempts: response.attempts,
    };
  },
};

/**
 * Las referencias a evidencia del veredicto tienen que existir.
 *
 * Es la MISMA defensa que en el Audit Skill, y por el mismo motivo: un
 * `evidenceIds` que apunta a una evidencia inexistente convierte una
 * comparación en una afirmación sin respaldo, y `TRACE_EVERY_DECISION` exige
 * que toda conclusión sea comprobable contra el expediente.
 *
 * El mensaje mantiene la forma que `openrouter.ts` reconoce para clasificar el
 * fallo como referencia inválida y no como error de schema genérico.
 */
function validateComparisonReferences(result: ComparisonResultPayload, input: ComparisonSkillInput): void {
  const validIds = new Set(input.evidences.map((evidence) => evidence.evidenceId));
  for (const id of result.evidenceIds) {
    if (!validIds.has(id)) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `evidenceIds referencia evidencia inexistente: ${id}`);
    }
  }
}

/**
 * Arma los mensajes del modelo. Expuesto por separado para poder testear el
 * ensamblado del expediente sin red.
 *
 * LAS EVIDENCIAS VAN SOLO EN TEXTO. El dictamen original ya extrajo los hechos
 * del contenido visual y dejó sus citas textuales en `result_json`, así que el
 * material que la comparación necesita para contrastar ambas resoluciones está
 * en el texto del expediente. Reenviar imágenes y PDFs escaneados duplicaría el
 * coste de la llamada más cara del producto para aportar información que ya
 * está citada en el dictamen, y el prompt dice explícitamente que las
 * extracciones del dictamen provienen del dossier visual original.
 */
export function buildComparisonMessages(input: ComparisonSkillInput): {
  system: string;
  parts: OpenRouterContentPart[];
} {
  const system = [
    buildComparisonSystemPrompt(),
    '',
    '# Procedimiento V5 (fuente normativa oficial)',
    '',
    PROCEDURE_TEXT,
  ].join('\n');

  const parts: OpenRouterContentPart[] = [
    {
      type: 'text',
      text: buildComparisonHeader({
        caseId: input.caseId,
        studentIdentifier: input.studentIdentifier,
        humanResult: input.humanResult,
        humanComment: input.humanComment,
        // El dictamen que se compara es SIEMPRE el de `case_reviews.audit_id`:
        // si aquí se colara otro, la comparación respondería a otra pregunta.
        auditResultJson: input.auditResultJson,
      }),
    },
  ];

  for (const evidence of input.evidences) {
    const lines = [
      `## Evidencia: ${sanitizeTagDelimiters(evidence.filename)}`,
      `ID: ${evidence.evidenceId}`,
      `Tipo detectado: ${evidence.kind}`,
      `MIME: ${evidence.mimeType}`,
      `Tamaño: ${evidence.sizeBytes} bytes`,
      `SHA-256: ${evidence.sha256}`,
      `Creada: ${evidence.createdAt}`,
    ];

    if (evidence.transcript) {
      lines.push('Transcripción (AssemblyAI):', evidence.transcript.transcript);
    } else if (evidence.text && evidence.text.trim().length > 0) {
      lines.push('Contenido:', evidence.text);
    } else {
      lines.push(
        '(Esta evidencia es visual o su contenido no fue extraído como texto; sus hechos y sus citas textuales están en el dictamen original de la auditoría.)',
      );
    }

    if (evidence.truncated && evidence.originalChars !== undefined) {
      lines.push(
        `ADVERTENCIA: contenido derivado truncado; se enviaron ${Math.min(evidence.text?.length ?? evidence.transcript?.transcript.length ?? 0, evidence.originalChars)} de ${evidence.originalChars} caracteres.`,
      );
    }

    parts.push({ type: 'text', text: lines.join('\n') });
  }

  return { system, parts };
}