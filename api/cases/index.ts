import { z } from 'zod';
import {
  ApiError,
  handleRoute,
  ok,
  created,
  methodNotAllowed,
  readJsonBody,
} from '../../src/server/http.js';
import { createServerClient } from '../../src/server/insforge.js';
import { createCase, listCaseSummaries } from '../../src/server/cases.js';
import { caseToSummary } from '../../src/server/dto.js';
import { assertCaseWriteCapability } from '../../src/server/auth.js';

// GET  /api/cases            → { cases: CaseSummary[] }
// POST /api/cases { studentIdentifier?, isTest? } → 201 { case: CaseSummary }
//
// El alcance de la lectura lo aplica `listCaseSummaries` desde las capacidades
// del rol (Asesor: solo propios; Coordinador/Gerente: todos).
//
// El cuerpo es ESTRICTO: rechaza cualquier campo que no sea `studentIdentifier` o
// `isTest`, de modo que un `created_by`, `role` o `actor` inyectado por el cliente
// no puede falsificar la propiedad ni el rol. El autor SIEMPRE es `req.auth`.
//
// `isTest` es un booleano de verdad: `z.boolean()` NO coacciona, así que `"true"`,
// `1` o `"1"` se rechazan con 400 en vez de convertirse en un caso de prueba por
// accidente. Omitirlo significa `false` (caso real), el default de la columna.
const CreateCaseBodySchema = z
  .object({
    // `unknown()` a propósito: el identificador conserva el comportamiento
    // previo (se trimea y se recorta a 200; un valor no-string se ignora), pero
    // la clave sigue estando permitida para que `.strict()` no la rechace.
    studentIdentifier: z.unknown().optional(),
    isTest: z.boolean().optional(),
  })
  .strict();

export default handleRoute(async (req, res) => {
  if (req.method === 'GET') {
    const client = createServerClient();
    const rows = await listCaseSummaries(client, req.auth!);
    ok(res, { cases: rows.map(caseToSummary) });
    return;
  }

  if (req.method === 'POST') {
    // Autorización ANTES de leer el cuerpo: un Gerente (solo lectura global) no
    // crea casos y no debe llegar a validar ni a escribir. Es 403 y no 404 porque
    // el recurso (la colección de casos) está en alcance; lo que falta es permiso.
    assertCaseWriteCapability(req.auth!);

    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const forbidden = (['created_by', 'role', 'actor'] as const).filter((key) => key in body);
    if (forbidden.length > 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Campos no permitidos en la solicitud');
    }

    const parsed = CreateCaseBodySchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'isTest'}: ${issue.message}`)
        .join(' | ');
      throw new ApiError(400, 'VALIDATION_ERROR', `VALIDATION_ERROR: ${detail}`);
    }

    const rawIdentifier = typeof parsed.data.studentIdentifier === 'string' ? parsed.data.studentIdentifier.trim() : '';
    const studentIdentifier = rawIdentifier.length > 0 ? rawIdentifier.slice(0, 200) : null;
    const isTest = parsed.data.isTest ?? false;

    const client = createServerClient();
    const row = await createCase(client, studentIdentifier, req.auth!.sub, isTest);
    created(res, { case: caseToSummary({ ...row, evidence: [] }) });
    return;
  }

  methodNotAllowed(req, res);
});
