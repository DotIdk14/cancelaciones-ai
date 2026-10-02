// =============================================================================
// Revisión humana — persistencia en `case_human_reviews`.
// =============================================================================
// Igual que `cases.ts`: aquí NO hay criterio. Se guarda lo que una persona
// decidió y se lee para poder compararlo con el dictamen de la IA. Ni una regla de
// negocio, ni una clasificación.
//
// LO QUE ESTA CAPA GARANTIZA, y es lo único que decide:
//   - La revisión apunta al `audit_id` CONCRETO que se revisó, no a "la última
//     auditoría del caso". Es lo que hace comparable el par (IA, humano) 1:1.
//   - `case_id` NO se guarda: se deriva por el JOIN con `audits`. Duplicarlo daría
//     dos fuentes de verdad para "de qué caso es esta revisión", y pueden
//     discrepar.
//   - `result_json` de la IA NO se toca nunca. Esta tabla es la única escritura.

import { ApiError, mapProviderError } from './http.js';
import type { InsForgeClient } from './insforge.js';
import type { AuditResultType } from '../skills/audit/types.js';

/**
 * Resuelve el nombre de quien revisa al `uuid` de `profiles` que exige la FK.
 *
 * `case_human_reviews.reviewed_by` es `uuid REFERENCES auth.users(id)`, así que
 * guardar el nombre que escribió la persona en el formulario daría un 500 al
 * insertar. Se busca por `display_name` y, si no aparece, se resuelve al ÚNICO
 * usuario registrado cuando es que hay uno solo (el caso de este entorno). Con
 * dos o más se rechaza: atribuir en silencio convertiría la revisión de una
 * persona en la de otra. Es una decisión de datos de un entorno sin
 * autenticación, no una autorización: cuando haya sesiones, esto desaparece y
 * `reviewed_by` pasa a ser el uid de quien tiene la sesión abierta.
 */
async function resolveReviewerUuid(
  client: InsForgeClient,
  reviewedBy: string,
): Promise<string> {
  const { data, error } = await client.database
    .from('profiles')
    .select('id')
    .ilike('display_name', reviewedBy)
    .limit(1);

  if (error) throw mapProviderError(error);

  const rows = (data ?? []) as unknown as Array<{ id: string }>;
  const found = rows[0];
  if (found !== undefined) return found.id;

  // No hay perfil con ese nombre.
  //
  // Solo se atribuye al usuario que haya cuando HAY UNO, que es el caso de este
  // entorno. Con dos o más, adivinar cuál sería atribuir la revisión de una
  // persona a otra, así que se rechaza: es preferible pedir el nombre correcto
  // que dejar un registro mal firmado.
  const users = await listKnownUsers(client);
  if (users.length === 0) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'No hay ningún usuario registrado al que atribuir la revisión.',
    );
  }
  if (users.length > 1) {
    const nombres = users.map((user) => user.label).join(', ');
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `El nombre "${reviewedBy}" no coincide con ningún usuario registrado. Usa uno de estos: ${nombres}.`,
    );
  }

  const only = users[0] as { id: string; label: string };
  console.warn(
    `[human-review] "${reviewedBy}" no coincide con ningún perfil; se atribuye a ${only.label}.`,
  );
  return only.id;
}

/**
 * Usuarios registrados, para el caso de que el nombre no exista.
 *
 * SIN `limit`: la decisión de `resolveReviewerUuid` depende de CUÁNTOS hay (solo
 * se puede atribuir al usuario existente cuando hay uno), así que traer solo el
 * primero haría que la comprobación `length > 1` fuera siempre falsa y un nombre
 * desconocido se atribuiría en silencio a un usuario arbitrario en cuanto hubiera
 * más de uno. Se topa con un límite alto para no arrastrar la tabla entera.
 */
async function listKnownUsers(client: InsForgeClient): Promise<{ id: string; label: string }[]> {
  const { data, error } = await client.database
    .from('profiles')
    .select('id, display_name')
    .limit(MAX_REVIEWER_CANDIDATES);
  if (error) throw mapProviderError(error);
  const rows = (data ?? []) as unknown as Array<{ id: string; display_name: string | null }>;
  return rows.map((row) => ({ id: row.id, label: row.display_name ?? row.id }));
}

/** Fila de `case_human_reviews` con los nombres traducidos y el `case_id` resuelto. */
export interface HumanReviewRow {
  id: string;
  case_id: string;
  audit_id: string;
  /** Dictamen humano, del vocabulario cerrado del Skill (`human_outcome` en la tabla). */
  result: AuditResultType;
  notes: string | null;
  reviewed_by: string;
  reviewed_at: string;
  created_at: string;
  /** `APPROVE` si confirma el dictamen de la IA, `CORRECT` si lo cambia. */
  decision_type: 'APPROVE' | 'CORRECT';
}

export interface SaveHumanReviewInput {
  caseId: string;
  auditId: string;
  result: AuditResultType;
  /** Dictamen de la IA de ESA auditoría, para derivar `decision_type`. */
  aiResult: AuditResultType | null;
  reviewedBy: string;
  notes: string | null;
}

/** Mensaje del conflicto "ya revisado" (lo comparan el cliente y los tests). */
export const DUPLICATE_REVIEW_MESSAGE =
  'Este caso ya tiene una revisión humana registrada.';

/** Violación de clave única de Postgres (23505). */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/**
 * Cuántos perfiles se miran para decidir si un nombre desconocido se puede
 * atribuir. Dos bastan para saber que hay más de uno, pero se leen unos pocos
 * para que el mensaje de error pueda=listar a quién elegir.
 */
const MAX_REVIEWER_CANDIDATES = 20;

/**
 * Registra (o actualiza) la revisión humana del caso.
 *
 * `case_human_reviews.audit_id` es UNIQUE, así que la carrera entre dos peticiones
 * simultáneas la resuelve PostgreSQL con un 23505. Eso se traduce al mismo 409 que
 * devuelve la comprobación previa: quien llama ve "ya revisado" en los dos
 * caminos, nunca un 500 opaco ni dos revisiones del mismo dictamen.
 *
 * El `ON CONFLICT` hace que una segunda revisión del MISMO `audit_id` actualice
 * la fila en vez de fallar. Es deliberado: corregir un dictamen humano escrito
 * mal es legítimo, y la fila única por auditoría se mantiene.
 */
export async function saveHumanReview(
  client: InsForgeClient,
  input: SaveHumanReviewInput,
): Promise<HumanReviewRow> {
  const reviewerUuid = await resolveReviewerUuid(client, input.reviewedBy);

  // `decision_type` es NOT NULL en la tabla y hereda el vocabulario del
  // `human_reviews` original: `APPROVE` cuando la persona confirma el dictamen de
  // la IA, `CORRECT` cuando lo cambia. No es un campo que se le pregunte a quien
  // revisa: se DEDUCE de si el dictamen humano coincide con el de la IA, que es
  // la única información que existe y evita preguntarle dos veces lo mismo.
  const decisionType = input.aiResult === input.result ? 'APPROVE' : 'CORRECT';

  const { data, error } = await client.database
    .from('case_human_reviews')
    .upsert(
      [
        {
          audit_id: input.auditId,
          human_outcome: input.result,
          human_reason: input.notes,
          reviewed_by: reviewerUuid,
          reviewed_at: new Date().toISOString(),
          decision_type: decisionType,
        },
      ],
      { onConflict: 'audit_id' },
    )
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, 'VALIDATION_ERROR', DUPLICATE_REVIEW_MESSAGE);
    }
    throw mapProviderError(error);
  }
  if (!data) throw mapProviderError(null);

  // La fila viene con los nombres de la TABLA (`human_outcome`, `human_reason`),
  // no con los del tipo. Se traduce explícitamente en vez de castear: un `as`
  // aquí prometería campos que la fila no trae, y quien lo usara leería
  // `undefined` de `result` creyendo que la revisión no tiene dictamen.
  const row = data as unknown as {
    id: string;
    audit_id: string;
    human_outcome: string;
    human_reason: string | null;
    reviewed_by: string;
    reviewed_at: string;
    created_at: string;
    decision_type: 'APPROVE' | 'CORRECT';
  };

  return {
    id: row.id,
    case_id: input.caseId,
    audit_id: row.audit_id,
    result: row.human_outcome as AuditResultType,
    notes: row.human_reason,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    decision_type: row.decision_type,
  };
}

/**
 * Revisión humana vigente del caso, o `null` si no hay ninguna.
 *
 * Filtra por `case_id` a través de la relación con `audits`, que es donde vive
 * ese dato. Así esta función no necesita que la fila repita el caso.
 */
export async function getHumanReview(
  client: InsForgeClient,
  caseId: string,
): Promise<HumanReviewRow | null> {
  const { data, error } = await client.database
    .from('case_human_reviews')
    .select(
      'id, audit_id, human_outcome, human_reason, reviewed_by, reviewed_at, created_at, decision_type, audits!inner(case_id)',
    )
    .eq('audits.case_id', caseId)
    .limit(1);

  if (error) throw mapProviderError(error);

  // Se declara la forma REAL de la fila (nombres de tabla + el JOIN anidado) y se
  // traduce al tipo del dominio, en vez de castear: un `as` prometería `result` o
  // `notes`, que en la fila no existen.
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    audit_id: string;
    human_outcome: string;
    human_reason: string | null;
    reviewed_by: string;
    reviewed_at: string;
    created_at: string;
    decision_type: 'APPROVE' | 'CORRECT';
    audits: { case_id: string } | null;
  }>;

  const row = rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    // El `case_id` viene del JOIN. Si el runtime no poblara la relación anidada
    // se cae al `caseId` pedido, que es el mismo por el que se filtró.
    case_id: row.audits?.case_id ?? caseId,
    audit_id: row.audit_id,
    result: row.human_outcome as AuditResultType,
    notes: row.human_reason,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    decision_type: row.decision_type,
  };
}
