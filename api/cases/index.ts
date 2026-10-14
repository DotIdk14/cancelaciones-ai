import { getStudentHistory } from '../../src/server/student-history.js';
import { z } from 'zod';
import {
  ApiError,
  handleRoute,
  ok,
  created,
  methodNotAllowed,
  readJsonBody,
  readRawBodyLimited,
  idempotencyKey,
} from '../../src/server/http.js';
import { createServerClient } from '../../src/server/insforge.js';
import { countCaseSummaryStatuses, createCase, listCaseCreatorOptions, listCaseSummaries, listCaseSummaryPage, type CaseCreatorRole } from '../../src/server/cases.js';
import { caseToSummary, deriveWorkflowState } from '../../src/server/dto.js';
import { assertCaseWriteCapability } from '../../src/server/auth.js';
import { CASE_STATUSES } from '../../src/skills/audit/types.js';
import { capabilitiesForRole } from '../../src/server/capabilities.js';
import { createFlokzuPreview, confirmFlokzuImport, listFlokzuImportData } from '../../src/server/flokzu-import.js';
import { assertFlokzuCoordinator, listFlokzuReview, getFlokzuTicket, decideFlokzuTicket, FlokzuDecisionSchema } from '../../src/server/flokzu-review.js';
import { FLOKZU_MAX_FILE_BYTES } from '../../src/server/flokzu-parser.js';
import { parseSingleXlsxMultipart } from '../../src/server/flokzu-multipart.js';
import { z as zod } from 'zod';

export const config = { api: { bodyParser: false } };

// GET  /api/cases            → { cases: CaseSummary[] }
// POST /api/cases { studentIdentifier?, studentName? } → 201 { case: CaseSummary }
//
// El alcance de la lectura lo aplica `listCaseSummaries` desde las capacidades
// del rol (los tres roles autenticados pueden consultar todos los casos).
//
// El cuerpo es ESTRICTO: rechaza cualquier campo que no sea `studentIdentifier` o
// `studentName`, de modo que un `created_by`, `role`, `actor` o `isTest` del cliente
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
    studentName: z.unknown().optional(),
  })
  .strict();

const CaseCursorSchema = z.object({
  offset: z.number().int().min(0).max(10_000_000),
  snapshot: z.string().datetime(),
  limit: z.number().int().min(1).max(100),
  status: z.enum(CASE_STATUSES).optional(),
  creatorRole: z.enum(['user', 'coordinator', 'manager']).optional(),
  creatorId: z.string().uuid().optional(),
  assignedTo: z.union([z.string().uuid(), z.literal('UNASSIGNED')]).optional(),
  workflowState: z.enum(['PENDING_ADVISOR', 'PENDING_COORDINATOR']).optional(),
}).strict();

const WorkflowFilterSchema = z.enum(['PENDING_ADVISOR', 'PENDING_COORDINATOR']);

function decodeCursor(value: string): z.infer<typeof CaseCursorSchema> {
  try {
    const parsed = CaseCursorSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (parsed.success) return parsed.data;
  } catch { /* cursor inválido */ }
  throw new ApiError(400, 'VALIDATION_ERROR', 'Cursor de paginación inválido');
}

export default handleRoute(async (req, res) => {
  if (req.method === 'GET' && req.query.historyForCase !== undefined) {
    const input = zod.object({ historyForCase: zod.string().uuid(), offset: zod.coerce.number().int().min(0).max(1000000).default(0), limit: zod.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query);
    if (!input.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Consulta de historial inválida.');
    ok(res, { history: await getStudentHistory(createServerClient(), input.data.historyForCase, req.auth!, input.data.offset, input.data.limit) });
    return;
  }
  if (req.method === 'GET') {
    if (req.query.view === 'flokzu-review') {
      assertFlokzuCoordinator(req.auth!);
      const { view: _view, caseId, historyOffset, ...filters } = req.query;
      if (caseId !== undefined) {
        const parsed = z.object({ caseId: z.string().uuid(), historyOffset: z.coerce.number().int().min(0).max(1000000).default(0) }).safeParse({ caseId, historyOffset });
        if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Ticket o página no válida.');
        ok(res, await getFlokzuTicket(createServerClient(), req.auth!, parsed.data.caseId, parsed.data.historyOffset));
      } else ok(res, await listFlokzuReview(createServerClient(), req.auth!, filters));
      return;
    }
    if (req.query.view === 'imports') {
      if (!capabilitiesForRole(req.auth!.role).canImportCases) {
        throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para consultar importaciones de Flokzu.');
      }
      const rawImportOffset = req.query.importOffset;
      if (rawImportOffset !== undefined && (Array.isArray(rawImportOffset) || !/^\d{1,7}$/.test(rawImportOffset))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'importOffset debe ser un entero no negativo.');
      }
      const client = createServerClient();
      ok(res, await listFlokzuImportData(client, rawImportOffset === undefined ? 0 : Number(rawImportOffset)));
      return;
    }
    const client = createServerClient();
    const rawLimit = req.query.limit;
    if (rawLimit !== undefined) {
      const parsedLimit = z.coerce.number().int().min(1).max(100).safeParse(rawLimit);
      if (!parsedLimit.success || Array.isArray(rawLimit)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'limit debe ser un entero entre 1 y 100');
      }
      if (req.query.cursor !== undefined && typeof req.query.cursor !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'cursor debe ser una cadena');
      }
      if (req.query.status !== undefined && typeof req.query.status !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'status debe ser una cadena');
      }
      if (req.query.creatorRole !== undefined && typeof req.query.creatorRole !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'creatorRole debe ser una cadena');
      }
      if (req.query.creatorId !== undefined && typeof req.query.creatorId !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'creatorId debe ser una cadena');
      }
      if (req.query.workflowState !== undefined && typeof req.query.workflowState !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'workflowState debe ser una cadena');
      }
      const cursor = typeof req.query.cursor === 'string' ? decodeCursor(req.query.cursor) : null;
      const rawStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
      const statusParsed = rawStatus === undefined ? undefined : z.enum(CASE_STATUSES).safeParse(rawStatus);
      if (statusParsed && !statusParsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'status no es válido');
      const rawCreatorRole = typeof req.query.creatorRole === 'string' ? req.query.creatorRole : undefined;
      const creatorRoleParsed = rawCreatorRole === undefined ? undefined : z.enum(['user', 'coordinator', 'manager']).safeParse(rawCreatorRole);
      if (creatorRoleParsed && !creatorRoleParsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'creatorRole no es válido');
      const rawCreatorId = typeof req.query.creatorId === 'string' ? req.query.creatorId : undefined;
      const assignedToParsed = z.union([z.string().uuid(), z.literal('UNASSIGNED')]).optional().safeParse(req.query.assignedTo);
      if (!assignedToParsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'assignedTo no es válido');
      const assignedTo = assignedToParsed.data;
      const creatorIdParsed = rawCreatorId === undefined ? undefined : z.string().uuid().safeParse(rawCreatorId);
      if (creatorIdParsed && !creatorIdParsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'creatorId no es válido');
      const rawWorkflowState = typeof req.query.workflowState === 'string' ? req.query.workflowState : undefined;
      const workflowStateParsed = rawWorkflowState === undefined ? undefined : WorkflowFilterSchema.safeParse(rawWorkflowState);
      if (workflowStateParsed && !workflowStateParsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'workflowState no es válido');
      const capabilities = capabilitiesForRole(req.auth!.role);
      if (workflowStateParsed?.success && !capabilities.canFinalizeAnyCase) {
        throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para consultar las bandejas de coordinación');
      }
      if (cursor && (cursor.limit !== parsedLimit.data || cursor.status !== statusParsed?.data || cursor.creatorRole !== creatorRoleParsed?.data || cursor.creatorId !== creatorIdParsed?.data || cursor.assignedTo !== assignedTo || cursor.workflowState !== workflowStateParsed?.data)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'El cursor no corresponde a los filtros solicitados');
      }
      const limit = cursor?.limit ?? parsedLimit.data;
      const snapshot = cursor?.snapshot ?? new Date().toISOString();
      const status = cursor?.status ?? statusParsed?.data;
      const creatorRole = cursor?.creatorRole ?? creatorRoleParsed?.data;
      const creatorId = cursor?.creatorId ?? creatorIdParsed?.data;
      const workflowState = cursor?.workflowState ?? workflowStateParsed?.data;
      const offset = cursor?.offset ?? 0;
      const listOptions = {
        offset,
        limit: limit + 1,
        snapshot,
        ...(status ? { status } : {}),
        ...(creatorRole ? { creatorRole: creatorRole as CaseCreatorRole } : {}),
        ...(creatorId ? { creatorId } : {}),
        ...(assignedTo ? { assignedTo } : {}),
      };
      let cases;
      let hasMore: boolean;
      let nextOffset: number;
      if (workflowState) {
        // workflowState se deriva de case_reviews y no es una columna de cases.
        // Escanea páginas acotadas del conjunto filtrado para que la paginación
        // siga siendo correcta aunque la mayoría no pertenezca a esta bandeja.
        const pageSize = 100;
        const matching = [];
        let scanOffset = offset;
        let extraMatchOffset: number | null = null;
        while (matching.length <= limit) {
          const batch = await listCaseSummaryPage(client, req.auth!, { ...listOptions, offset: scanOffset, limit: pageSize });
          if (batch.length === 0) break;
          for (let index = 0; index < batch.length; index += 1) {
            const row = batch[index]!;
            const matchesWorkflow = deriveWorkflowState(row.review ?? null) === workflowState;
            const hasCurrentAiResolution = caseToSummary(row).effectiveResolution?.source === 'AI';
            if (!matchesWorkflow || (workflowState === 'PENDING_ADVISOR' && !hasCurrentAiResolution)) continue;
            if (matching.length === limit) {
              extraMatchOffset = scanOffset + index;
              break;
            }
            matching.push(row);
          }
          if (extraMatchOffset !== null || batch.length < pageSize) break;
          scanOffset += batch.length;
        }
        cases = matching;
        hasMore = extraMatchOffset !== null;
        nextOffset = extraMatchOffset ?? scanOffset;
      } else {
        const rows = await listCaseSummaryPage(client, req.auth!, listOptions);
        hasMore = rows.length > limit;
        cases = rows.slice(0, limit);
        nextOffset = offset + limit;
      }
      const nextCursor = hasMore
        ? Buffer.from(JSON.stringify({ offset: workflowState ? nextOffset : offset + limit, snapshot, limit, ...(status ? { status } : {}), ...(creatorRole ? { creatorRole } : {}), ...(creatorId ? { creatorId } : {}), ...(assignedTo ? { assignedTo } : {}), ...(workflowState ? { workflowState } : {}) })).toString('base64url')
        : null;
      const statusCounts = cursor ? undefined : await countCaseSummaryStatuses(
        client,
        req.auth!,
        creatorRole as CaseCreatorRole | undefined,
        creatorId,
        assignedTo,
      );
      const creatorOptions = !cursor && capabilities.canReadAllCases
        ? await listCaseCreatorOptions(client)
        : undefined;
      ok(res, {
        cases: cases.map((row) => caseToSummary(row, capabilities.canManageCases)),
        nextCursor,
        statusCounts,
        ...(creatorOptions ? { creatorOptions } : {}),
        ...(creatorOptions ? { responsibleOptions: creatorOptions.map((item) => ({ userId: item.creatorId, name: item.name })) } : {}),
      });
      return;
    }
    const rows = await listCaseSummaries(client, req.auth!);
    const canManageCases = capabilitiesForRole(req.auth!.role).canManageCases;
    ok(res, { cases: rows.map((row) => caseToSummary(row, canManageCases)) });
    return;
  }

  if (req.method === 'POST') {
    if ((req.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/form-data')) {
      if (!capabilitiesForRole(req.auth!.role).canImportCases) {
        throw new ApiError(403, 'AUTH_ERROR', 'Solo un Coordinador puede importar tickets de Flokzu.');
      }
      const body = await readRawBodyLimited(req, FLOKZU_MAX_FILE_BYTES + 64 * 1024);
      const uploaded = parseSingleXlsxMultipart(req.headers['content-type'] as string, body);
      const preview = await createFlokzuPreview(createServerClient(), req.auth!, uploaded.buffer);
      created(res, { preview });
      return;
    }
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
        .map((issue) => `${issue.path.join('.') || 'studentName'}: ${issue.message}`)
        .join(' | ');
      throw new ApiError(400, 'VALIDATION_ERROR', `VALIDATION_ERROR: ${detail}`);
    }

    const rawIdentifier = typeof parsed.data.studentIdentifier === 'string' ? parsed.data.studentIdentifier.trim() : '';
    const studentIdentifier = rawIdentifier.length > 0 ? rawIdentifier.slice(0, 200) : null;
    const rawName = typeof parsed.data.studentName === 'string' ? parsed.data.studentName.trim() : '';
    const studentName = rawName.length > 0 ? rawName.slice(0, 200) : null;

    const client = createServerClient();
    const requestId = idempotencyKey(req);
    const row = requestId
      ? await createCase(client, studentIdentifier, studentName, req.auth!.sub, requestId)
      : await createCase(client, studentIdentifier, studentName, req.auth!.sub);
    created(res, { case: caseToSummary({ ...row, evidence: [] }, capabilitiesForRole(req.auth!.role).canManageCases) });
    return;
  }

  if (req.method === 'PATCH') {
    if (req.query.view === 'flokzu-review') {
      assertFlokzuCoordinator(req.auth!);
      const parsed = FlokzuDecisionSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Decisión inválida.');
      ok(res, { result: await decideFlokzuTicket(createServerClient(), req.auth!, parsed.data) });
      return;
    }
    if (!capabilitiesForRole(req.auth!.role).canImportCases) {
      throw new ApiError(403, 'AUTH_ERROR', 'Solo un Coordinador puede confirmar importaciones de Flokzu.');
    }
    const parsed = zod.object({ batchId: zod.string().uuid() }).strict().safeParse(await readJsonBody(req));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'La vista previa indicada no es válida.');
    const result = await confirmFlokzuImport(createServerClient(), req.auth!, parsed.data.batchId);
    ok(res, { result });
    return;
  }

  methodNotAllowed(req, res, 'GET, POST, PATCH');
});
