// =============================================================================
// Esquema de la revisión humana.
// =============================================================================
// El dictamen humano se valida CONTRA `AUDIT_RESULTS`, el mismo vocabulario cerrado
// que puede emitir el Audit Skill. No se crea una lista propia ni se admiten
// valores como "Improcedente": si la persona quiere registrar que la IA se
// equivocó, eso se dice en las NOTAS, y el dictamen sigue siendo una de las seis
// clasificaciones normativas. Mezclar las dos cosas haría que la comparación
// "IA vs humano" dejara de ser una comparación dentro del mismo dominio.
//
// El comentario es OPCIONAL a propósito. La tabla admite `NULL` y esta capa
// también: obligar a escribir un texto para registrar un dictamen añadiría un
// requisito que el producto no pidió, y en la práctica empuja a no registrar nada.

// `reviewedBy` es el NOMBRE que escribe quien revisa, y la capa de datos lo
// resuelve contra `profiles` para obtener el `uuid` que exige la FK de
// `case_human_reviews.reviewed_by`. Guardar el nombre tal cual daría un 500 al
// insertar, porque no es un uuid.

import { z } from 'zod';
import { AUDIT_RESULTS, type AuditResultType } from './audit/types.js';
import { ApiError } from '../server/http.js';

/** Longitud máxima de las notas, para acotar lo que se guarda. */
export const REVIEW_NOTES_MAX = 2000;

const NotesSchema = z
  .string()
  .trim()
  .max(REVIEW_NOTES_MAX, `Máximo ${REVIEW_NOTES_MAX} caracteres.`)
  .optional()
  .transform((value) => (value === undefined || value === '' ? null : value));

/**
 * `reviewed_by` es `uuid REFERENCES auth.users(id)` en la base, NO un texto.
 *
 * El proyecto tiene UN usuario registrado (`profiles`: `role = 'AUDITOR'`,
 * "Vertical Slice Local"), así que "quién revisa" se resuelve contra esa tabla en
 * vez de aceptar un nombre libre del cliente. Aceptar texto libre obligaría a
 * guardar un identificador que no existe en `auth.users` y la escritura fallaría
 * con un 500 opaco — que es exactamente lo que pasaba.
 *
 * Cuando exista autenticación de verdad, este campo deja de llegar del cliente
 * y pasa a ser el uid de la sesión; la consulta por `profiles` se queda como
 * está, porque sigue siendo la fuente de "quién".
 */
const ReviewerSchema = z
  // `required_error` evita el "Required" que Zod emite por defecto: quien
  // rellena el formulario en español tiene que saber QUÉ campo falta.
  .string({ required_error: 'Indica quién realiza la revisión.' })
  .trim()
  .min(2, 'Indica quién realiza la revisión.')
  .max(120, 'Máximo 120 caracteres.');

export const HumanReviewInputSchema = z
  .object({
    result: z.enum(AUDIT_RESULTS, {
      // Se nombran las seis opciones en el mensaje: quien recibe el 400 ve
      // exactamente las que puede elegir, en vez de una instrucción abstracta.
      errorMap: () => ({
        message: `Elige uno de: ${AUDIT_RESULTS.join(', ')}.`,
      }),
    }),
    reviewedBy: ReviewerSchema,
    notes: NotesSchema,
  })
  .strict();

export interface HumanReviewInput {
  result: AuditResultType;
  reviewedBy: string;
  notes: string | null;
}

/**
 * Valida el cuerpo de la revisión y lo estrecha a `HumanReviewInput`.
 *
 * El error crudo de Zod nunca sale de aquí: `ApiError` con un mensaje en español
 * que dice QUÉ campo falla y por qué, sin filtrar el valor recibido.
 */
export function parseHumanReviewInput(raw: unknown): HumanReviewInput {
  const parsed = HumanReviewInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = typeof issue?.path[0] === 'string' ? `Campo "${issue.path[0]}": ` : '';
    const message = issue?.message && issue.message.length > 0 ? issue.message : 'Revisión no válida.';
    throw new ApiError(400, 'VALIDATION_ERROR', `${field}${message}`);
  }
  return parsed.data;
}
