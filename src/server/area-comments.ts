// =============================================================================
// Comentarios manuales por área (Back Office, HelpDesk, Servicios Escolares,
// Finanzas, Adicional).
//
// POR QUÉ VIVE AQUÍ Y NO EN `reviews.ts`
//   `reviews.ts` trata la RESOLUCIÓN humana del caso: un veredicto del
//   vocabulario cerrado más su justificación. Esto es otra cosa: una bitácora
//   donde cada área deja su observación, sin efecto sobre el dictamen. Mezclarla
//   con la revisión haría creer que un comentario de Back Office participa en la
//   resolución, y no es cierto.
//
// ESTO NO ES NORMATIVA
//   Un comentario de un área es la afirmación de una persona, no un hecho
//   acreditado ni una regla. El criterio del caso sigue siendo exclusivamente
//   el procedimiento V5 del owner (POLICY_IS_IMMUTABLE). Nada de lo que se
//   escribe aquí se inyecta en un prompt: si algún día se hace, pasa a ser
//   contenido NO CONFIABLE y necesita el cercado de `src/skills/sanitize.ts`.
// =============================================================================

import { z } from 'zod';
import type { InsForgeClient } from './insforge.js';
import { ApiError, mapProviderError } from './errors.js';

/**
 * Vocabulario cerrado de áreas. Debe coincidir con el `CHECK` de
 * `case_area_comments_area_ck`: la API valida antes de escribir, la base
 * rechaza si algo se colara. Son dos capas, no una redundante.
 */
export const AREA_COMMENT_AREAS = [
  'BACK_OFFICE',
  'HELPDESK',
  'SCHOOL_SERVICES',
  'FINANCE',
  'ADDITIONAL',
] as const;

export type AreaCommentArea = (typeof AREA_COMMENT_AREAS)[number];

/** Mismo límite que el `CHECK` de la base. */
export const AREA_COMMENT_MAX = 4000;

/** Fila de `case_area_comments`. */
export interface AreaCommentRow {
  id: string;
  case_id: string;
  area: AreaCommentArea;
  comment: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Lo que acepta la escritura.
 *
 * `.trim()` ANTES de `.min(1)` por la misma razón que en el resto del proyecto:
 * un texto de espacios no es un comentario, es una ausencia. Sin este orden, un
 * cuerpo `{"area":"BACK_OFFICE","comment":"   "}` pasaría la validación y
 * llegaría al `CHECK` de la base a ser rechazado con un 500 en lugar de un 400
 * con mensaje útil.
 */
const AreaCommentInputSchema = z
  .object({
    area: z.enum(AREA_COMMENT_AREAS),
    comment: z.string().trim().min(1).max(AREA_COMMENT_MAX),
  })
  .strict();

export interface AreaCommentInput {
  area: AreaCommentArea;
  comment: string;
}

export function parseAreaCommentInput(raw: unknown): AreaCommentInput {
  const parsed = AreaCommentInputSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'comment'}: ${issue.message}`)
      .join(' | ');
    throw new ApiError(400, 'VALIDATION_ERROR', `VALIDATION_ERROR: ${detail}`);
  }
  return parsed.data;
}

export interface UpsertAreaCommentInput extends AreaCommentInput {
  caseId: string;
  userId: string;
}

/**
 * Guarda el comentario de un área. Es un UPSERT y no un historial: `UNIQUE
 * (case_id, area)` hace que "guardar" sustituya lo que había.
 *
 * `onConflict: 'case_id,area'` resuelve la carrera entre dos guardados
 * simultáneos de la misma área en la propia base, así que el que gana es
 * arbitrario pero siempre hay exactamente una fila. Sin eso, dos peticiones
 * simultáneas producirían una de ellas con 23505 y un 409 que el operador leería
 * como "no se pudo guardar" cuando en realidad su texto sí quedó escrito por la
 * otra.
 */
export async function upsertAreaComment(
  client: InsForgeClient,
  input: UpsertAreaCommentInput,
): Promise<AreaCommentRow> {
  const { data, error } = await client.database
    .from('case_area_comments')
    .upsert(
      [
        {
          case_id: input.caseId,
          area: input.area,
          comment: input.comment,
          created_by: input.userId,
        },
      ],
      { onConflict: 'case_id,area' },
    )
    .select()
    .single();

  if (error) throw mapProviderError(error);
  if (!data) throw mapProviderError(null);
  return data as AreaCommentRow;
}

/** Comentarios del caso en el orden fijo del vocabulario, no el de la base. */
export async function listAreaComments(
  client: InsForgeClient,
  caseId: string,
): Promise<AreaCommentRow[]> {
  const { data, error } = await client.database
    .from('case_area_comments')
    .select('*')
    .eq('case_id', caseId);

  if (error) throw mapProviderError(error);
  const rows = (data as AreaCommentRow[] | null) ?? [];
  // Ordenar en código y no con `.order()` porque el vocabulario es el que
  // importa para la pantalla: el orden de la base depende del índice y no es un
  // contrato.
  return [...rows].sort(
    (a, b) => AREA_COMMENT_AREAS.indexOf(a.area) - AREA_COMMENT_AREAS.indexOf(b.area),
  );
}