// =============================================================================
// Comentarios manuales por área: validación de entrada y persistencia.
//
// Lo que fijan:
//
//   1. El ÁREA es vocabulario cerrado. Un área inventada es un 400, no una fila.
//      Es la primera de las dos capas: la API valida y la base rechaza.     
//   2. Un comentario vacío NO es un comentario. El `.trim()` va ANTES del `.min(1)`
//      justamente para que "   " se rechace aquí y no llegue a la base a ser un
//      500.
//   3. Guardar SUSTITUYE. Un comentario vigente por área y caso, no un histórico:
//      es lo que la pantalla lee y lo que el `UNIQUE (case_id, area)` garantiza.
//   4. El orden de salida es el del VOCABULARIO, no el de la base. El orden de
//      salida de un índice no es un contrato; el orden en que se leen las áreas
//      sí lo es.
//
// La validación del endpoint (404/403 y alcance del caso) vive en
// `tests/security-regressions.test.ts`; aquí no se toca HTTP ni sesión.
// =============================================================================

import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/server/errors';
import {
  AREA_COMMENT_AREAS,
  AREA_COMMENT_MAX,
  listAreaComments,
  parseAreaCommentInput,
  upsertAreaComment,
} from '../src/server/area-comments';
import { createFakeDatabase } from './helpers/fake-database';
import type { FakeDatabase } from './helpers/fake-database';

const db: FakeDatabase = createFakeDatabase();

beforeEach(() => {
  db.reset();
});

// ------------------------------------------------------------------ validación

describe('parseAreaCommentInput', () => {
  it('acepta un área del vocabulario y recorta el texto', () => {
    expect(parseAreaCommentInput({ area: 'BACK_OFFICE', comment: '  sin pago  ' })).toEqual({
      area: 'BACK_OFFICE',
      comment: 'sin pago',
    });
  });

  it('acepta las cinco áreas del vocabulario cerrado', () => {
    for (const area of AREA_COMMENT_AREAS) {
      expect(parseAreaCommentInput({ area, comment: 'ok' }).area).toBe(area);
    }
  });

  it('rechaza un área fuera del vocabulario con 400, no con un 500', () => {
    expectApiError(() => parseAreaCommentInput({ area: 'DIRECCION', comment: 'hola' }), 400);
    expectApiError(() => parseAreaCommentInput({ area: 'back_office', comment: 'hola' }), 400);
  });

  it('rechaza un comentario que sólo tiene espacios', () => {
    // Sin `.trim()` antes de `.min(1)`, esto pasaría y la base lo rechazaría.
    expectApiError(() => parseAreaCommentInput({ area: 'FINANCE', comment: '     ' }), 400);
    expectApiError(() => parseAreaCommentInput({ area: 'FINANCE', comment: '' }), 400);
  });

  it('rechaza un comentario más largo que el límite de la base', () => {
    expectApiError(() => parseAreaCommentInput({ area: 'FINANCE', comment: 'x'.repeat(AREA_COMMENT_MAX + 1) }), 400);
  });

  it('acepta un comentario exactamente en el límite', () => {
    const comment = 'x'.repeat(AREA_COMMENT_MAX);
    expect(parseAreaCommentInput({ area: 'FINANCE', comment }).comment).toHaveLength(AREA_COMMENT_MAX);
  });

  it('rechaza campos que el contrato no declara', () => {
    // `strict`: un campo extra en el cuerpo es un 400, no un dato ignorado en
    // silencio. Importa porque `created_by` viaja en la fila, no en el cuerpo:
    // aceptarlo sería permitir que el cliente elija quién escribe el comentario.
    expectApiError(
      () => parseAreaCommentInput({ area: 'FINANCE', comment: 'hola', created_by: 'uuid-falso' }),
      400,
    );
  });

  it('rechaza lo que no es un objeto', () => {
    expectApiError(() => parseAreaCommentInput(null), 400);
    expectApiError(() => parseAreaCommentInput('BACK_OFFICE'), 400);
  });
});

// --------------------------------------------------------------- persistencia

describe('upsertAreaComment', () => {
  it('guarda el comentario con el caso y el autor que recibió', async () => {
    const saved = await upsertAreaComment(db.client, {
      caseId: 'case-1',
      area: 'HELPDESK',
      comment: 'El alumno seerequisitó en persona.',
      userId: 'user-1',
    });

    expect(saved.area).toBe('HELPDESK');
    expect(saved.comment).toBe('El alumno seerequisitó en persona.');
    expect(db.rows('case_area_comments')).toHaveLength(1);
    expect(db.rows('case_area_comments')[0]).toMatchObject({
      case_id: 'case-1',
      area: 'HELPDESK',
      created_by: 'user-1',
    });
  });

  it('sustituye en vez de acumular cuando se guarda dos veces el mismo área', async () => {
    await upsertAreaComment(db.client, { caseId: 'case-1', area: 'FINANCE', comment: 'primera nota', userId: 'user-1' });
    await upsertAreaComment(db.client, { caseId: 'case-1', area: 'FINANCE', comment: 'nota corregida', userId: 'user-1' });

    const rows = db.rows('case_area_comments');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.comment).toBe('nota corregida');
  });

  it('mantiene un comentario por área, y las cinco áreas pueden existir a la vez', async () => {
    for (const area of AREA_COMMENT_AREAS) {
      await upsertAreaComment(db.client, { caseId: 'case-1', area, comment: `nota de ${area}`, userId: 'user-1' });
    }
    expect(db.rows('case_area_comments')).toHaveLength(AREA_COMMENT_AREAS.length);
  });

  it('no mezcla el mismo área entre casos distintos', async () => {
    await upsertAreaComment(db.client, { caseId: 'case-1', area: 'FINANCE', comment: 'del caso 1', userId: 'user-1' });
    await upsertAreaComment(db.client, { caseId: 'case-2', area: 'FINANCE', comment: 'del caso 2', userId: 'user-1' });

    expect(db.rows('case_area_comments')).toHaveLength(2);
  });
});

// ------------------------------------------------------------------- lectura

describe('listAreaComments', () => {
  it('devuelve los del caso en el orden del vocabulario, no el de la base', async () => {
    // Se guardan en orden inverso a propósito: si la salida sigiera el orden de
    // inserción, la pantalla leería las áreas desordenadas.
    await upsertAreaComment(db.client, { caseId: 'case-1', area: 'FINANCE', comment: 'c', userId: 'user-1' });
    await upsertAreaComment(db.client, { caseId: 'case-1', area: 'BACK_OFFICE', comment: 'a', userId: 'user-1' });
    await upsertAreaComment(db.client, { caseId: 'case-1', area: 'HELPDESK', comment: 'b', userId: 'user-1' });

    const listed = await listAreaComments(db.client, 'case-1');
    expect(listed.map((row) => row.area)).toEqual(['BACK_OFFICE', 'HELPDESK', 'FINANCE']);
  });

  it('devuelve vacío en vez de fallar cuando el caso no tiene comentarios', async () => {
    expect(await listAreaComments(db.client, 'case-sin-nada')).toEqual([]);
  });

  it('sólo devuelve los comentarios del caso pedido', async () => {
    await upsertAreaComment(db.client, { caseId: 'case-1', area: 'FINANCE', comment: 'del 1', userId: 'user-1' });
    await upsertAreaComment(db.client, { caseId: 'case-2', area: 'FINANCE', comment: 'del 2', userId: 'user-1' });

    const listed = await listAreaComments(db.client, 'case-2');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.comment).toBe('del 2');
  });
});

// -------------------------------------------------------------------- helpers

function expectApiError(fn: () => unknown, status: number): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    return;
  }
  throw new Error('se esperaba un ApiError y no se lanzó ninguno');
}