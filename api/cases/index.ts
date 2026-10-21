import { caseStageOf, matchesCaseBucket, matchesCaseActorScope } from '../../src/lib/case-workflow.js';
import { listAssignmentOptions } from '../../src/server/case-assignment.js';
import { getStudentHistory } from '../../src/server/student-history.js';
import { z } from 'zod';
import {
  ApiError,
  handleRoute,
  ok,
  created,
  methodNotAllowed,
  readJsonBody,
  idempotencyKey,
} from '../../src/server/http.js';
import { createServerClient } from '../../src/server/insforge.js';
import { caseOwnedBy, countCaseBuckets, countCaseSummaryStatuses, listCaseCreatorOptions, listCaseSummaries, listCaseSummaryPage, type CaseCreatorRole } from '../../src/server/cases.js';
import { caseToSummary, deriveWorkflowState } from '../../src/server/dto.js';
import { assertCaseWriteCapability } from '../../src/server/auth.js';
import { CASE_STATUSES } from '../../src/skills/audit/types.js';
import { capabilitiesForRole } from '../../src/server/capabilities.js';
import { describeExistingPortalCases } from '../../src/server/flokzu-existing.js';
import { createCaseFromPortal } from '../../src/server/flokzu-acquisition.js';
import { lookupPortalTickets, StudentNumberSchema, TicketIdSchema } from '../../src/server/flokzu-portal.js';
import { assertFlokzuCoordinator, listFlokzuReview, getFlokzuTicket, decideFlokzuTicket, FlokzuDecisionSchema } from '../../src/server/flokzu-review.js';
import { z as zod } from 'zod';

export const maxDuration = 300;
export const config = { api: { bodyParser: false } };

// GET  /api/cases            → { cases: CaseSummary[] }
// POST /api/cases { studentIdentifier, externalCaseId, assignedTo? } → 201 { case: CaseSummary }
//
// El alcance de la lectura lo aplica `listCaseSummaries` desde las capacidades
// del rol (los tres roles autenticados pueden consultar todos los casos).
//
// El cuerpo es ESTRICTO: admite identificación, CaVe, elección de responsable y
// ticket real verificado en Flokzu. Un `created_by`, `role`, `actor` o `isTest`
// no puede falsificar la propiedad ni el rol. El autor SIEMPRE es `req.auth`.
//
// Los booleanos no se coaccionan y la marca de prueba se administra aparte.
const CreateCaseBodySchema = z.object({ studentIdentifier: StudentNumberSchema, externalCaseId: TicketIdSchema, assignedTo: z.string().uuid().optional() }).strict();

const CaseCursorSchema = z.object({
  offset: z.number().int().min(0).max(10_000_000),
  snapshot: z.string().datetime(),
  limit: z.number().int().min(1).max(100),
  status: z.enum(CASE_STATUSES).optional(),
  creatorRole: z.enum(['user', 'coordinator', 'manager']).optional(),
  creatorId: z.string().uuid().optional(),
  assignedTo: z.union([z.string().uuid(), z.literal('UNASSIGNED')]).optional(),
  workflowState: z.enum(['PENDING_ADVISOR', 'PENDING_COORDINATOR']).optional(),
  bucket: z.enum(['ALL', 'DRAFTS', 'IN_PROGRESS', 'COMPLETED', 'ERRORS']).optional(),
  stage: z.enum(['PENDING_AUDIT', 'PENDING_ADVISOR', 'PENDING_COORDINATOR']).optional(),
  search: z.string().max(200).optional(),
  country: z.string().max(80).optional(),
  channel: z.string().max(80).optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
}).strict();

const WorkflowFilterSchema = z.enum(['PENDING_ADVISOR', 'PENDING_COORDINATOR']);
const CaseBucketSchema = z.enum(['ALL', 'DRAFTS', 'IN_PROGRESS', 'COMPLETED', 'ERRORS']);

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
    if (req.query.view === 'flokzu-student') {
      assertCaseWriteCapability(req.auth!);
      const parsed = StudentNumberSchema.safeParse(req.query.studentIdentifier);
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'La matrícula debe contener exactamente 9 dígitos.');
      const tickets = await lookupPortalTickets(parsed.data);
      ok(res, { tickets: await describeExistingPortalCases(createServerClient(), req.auth!, parsed.data, tickets) });
      return;
    }
    if (req.query.view === 'student-options') {
      if (!capabilitiesForRole(req.auth!.role).canReadAllCases) throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para consultar expedientes.');
      const parsed = z.string().trim().min(1).max(200).safeParse(req.query.studentIdentifier);
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Matrícula inválida.');
      const { data, error } = await createServerClient().database.from('cases')
        .select('id,student_name,external_case_id,created_at').eq('student_identifier', parsed.data)
        .is('merged_into_case_id', null).eq('is_test', false).order('created_at', { ascending: false }).limit(20);
      if (error) throw new ApiError(503, 'DATABASE_ERROR', 'No se pudieron consultar los expedientes existentes.');
      ok(res, { cases: data });
      return;
    }
    if (req.query.view === 'assignment-options') {
      ok(res, { assignmentOptions: await listAssignmentOptions(createServerClient(), req.auth!) });
      return;
    }
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
      for (const key of ['bucket', 'stage', 'search', 'country', 'channel', 'createdFrom', 'createdTo'] as const) {
        if (req.query[key] !== undefined && typeof req.query[key] !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', `${key} debe ser una cadena`);
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
      const rawBucket = typeof req.query.bucket === 'string' ? req.query.bucket : undefined;
      const bucketParsed = rawBucket === undefined ? undefined : CaseBucketSchema.safeParse(rawBucket);
      if (bucketParsed && !bucketParsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'bucket no es válido');
      const stageParsed = z.enum(['PENDING_AUDIT', 'PENDING_ADVISOR', 'PENDING_COORDINATOR']).optional().safeParse(req.query.stage);
      if (!stageParsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'stage no es válido');
      const stage = stageParsed.data;
      if (stage && bucketParsed?.data !== 'IN_PROGRESS') throw new ApiError(400, 'VALIDATION_ERROR', 'La lista de etapa requiere la pestaña En curso');
      if (stage === 'PENDING_COORDINATOR' && !capabilitiesForRole(req.auth!.role).canFinalizeAnyCase) {
        throw new ApiError(403, 'AUTH_ERROR', 'La lista de cierre está disponible solo para Coordinador');
      }
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 200) : undefined;
      const country = typeof req.query.country === 'string' ? req.query.country.trim() : undefined;
      const channel = typeof req.query.channel === 'string' ? req.query.channel.trim() : undefined;
      const fromParsed = req.query.createdFrom === undefined ? undefined : z.string().datetime().safeParse(req.query.createdFrom);
      const toParsed = req.query.createdTo === undefined ? undefined : z.string().datetime().safeParse(req.query.createdTo);
      if (fromParsed && !fromParsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'createdFrom no es válido');
      if (toParsed && !toParsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'createdTo no es válido');
      if (fromParsed?.success && toParsed?.success && fromParsed.data > toParsed.data) throw new ApiError(400, 'VALIDATION_ERROR', 'El rango de fechas no es válido');
      const capabilities = capabilitiesForRole(req.auth!.role);
      if (workflowStateParsed?.success && !capabilities.canFinalizeAnyCase) {
        throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para consultar las bandejas de coordinación');
      }
      if (cursor && (cursor.limit !== parsedLimit.data || cursor.status !== statusParsed?.data || cursor.creatorRole !== creatorRoleParsed?.data || cursor.creatorId !== creatorIdParsed?.data || cursor.assignedTo !== assignedTo || cursor.workflowState !== workflowStateParsed?.data || cursor.bucket !== bucketParsed?.data || cursor.stage !== stage || cursor.search !== search || cursor.country !== country || cursor.channel !== channel || cursor.createdFrom !== fromParsed?.data || cursor.createdTo !== toParsed?.data)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'El cursor no corresponde a los filtros solicitados');
      }
      const limit = cursor?.limit ?? parsedLimit.data;
      const snapshot = cursor?.snapshot ?? new Date().toISOString();
      const status = cursor?.status ?? statusParsed?.data;
      const creatorRole = cursor?.creatorRole ?? creatorRoleParsed?.data;
      const creatorId = cursor?.creatorId ?? creatorIdParsed?.data;
      const workflowState = cursor?.workflowState ?? workflowStateParsed?.data;
      const bucket = cursor?.bucket ?? bucketParsed?.data ?? 'ALL';
      const effectiveSearch = cursor?.search ?? search;
      const effectiveCountry = cursor?.country ?? country;
      const effectiveChannel = cursor?.channel ?? channel;
      const createdFrom = cursor?.createdFrom ?? fromParsed?.data;
      const createdTo = cursor?.createdTo ?? toParsed?.data;
      const offset = cursor?.offset ?? 0;
      const listOptions = {
        offset,
        limit: limit + 1,
        snapshot,
        ...(status ? { status } : {}),
        ...(creatorRole ? { creatorRole: creatorRole as CaseCreatorRole } : {}),
        ...(creatorId ? { creatorId } : {}),
        ...(assignedTo ? { assignedTo } : {}),
        ...(effectiveCountry ? { country: effectiveCountry } : {}),
        ...(effectiveChannel ? { channel: effectiveChannel } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
      };
      let cases;
      let hasMore: boolean;
      let nextOffset: number;
      if (workflowState || bucket !== 'ALL' || effectiveSearch) {
        // La clasificación humana se deriva de case_reviews, así que las
        // bandejas se filtran sobre páginas acotadas ya enriquecidas. El cursor
        // guarda el offset de lectura para que búsqueda y bandeja paginen igual.
        const pageSize = 100;
        const matching = [];
        let scanOffset = offset;
        let extraMatchOffset: number | null = null;
        while (matching.length <= limit) {
          const batch = await listCaseSummaryPage(client, req.auth!, { ...listOptions, offset: scanOffset, limit: pageSize });
          if (batch.length === 0) break;
          for (let index = 0; index < batch.length; index += 1) {
            const row = batch[index]!;
            const matchesWorkflow = !workflowState || deriveWorkflowState(row.review ?? null) === workflowState;
            const hasCurrentAiResolution = caseToSummary(row).effectiveResolution?.source === 'AI';
            if (!matchesWorkflow || (workflowState === 'PENDING_ADVISOR' && !hasCurrentAiResolution)) continue;
            const summary = caseToSummary(row);
            if (!matchesCaseBucket(summary, bucket, capabilities.canFinalizeAnyCase)) continue;
            if (!matchesCaseActorScope(bucket, { canReviewOwnCases: capabilities.canReviewOwnCases, ownsCase: caseOwnedBy(row, req.auth!.sub), reviewedCase: row.review?.created_by === req.auth!.sub })) continue;
            if (stage && caseStageOf(summary) !== stage) continue;
            if (effectiveSearch) {
              const needle = effectiveSearch.toLocaleLowerCase('es');
              const searchable = [row.id, row.external_case_id ?? '', row.student_identifier ?? '', row.student_name ?? ''];
              if (!searchable.some(value => value.toLocaleLowerCase('es').includes(needle))) continue;
            }
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
        ? Buffer.from(JSON.stringify({ offset: workflowState || bucket !== 'ALL' || effectiveSearch ? nextOffset : offset + limit, snapshot, limit, ...(status ? { status } : {}), ...(creatorRole ? { creatorRole } : {}), ...(creatorId ? { creatorId } : {}), ...(assignedTo ? { assignedTo } : {}), ...(workflowState ? { workflowState } : {}), ...(bucket !== 'ALL' ? { bucket } : {}), ...(stage ? { stage } : {}), ...(effectiveSearch ? { search: effectiveSearch } : {}), ...(effectiveCountry ? { country: effectiveCountry } : {}), ...(effectiveChannel ? { channel: effectiveChannel } : {}), ...(createdFrom ? { createdFrom } : {}), ...(createdTo ? { createdTo } : {}) })).toString('base64url')
        : null;
      const statusCounts = cursor ? undefined : await countCaseSummaryStatuses(
        client,
        req.auth!,
        creatorRole as CaseCreatorRole | undefined,
        creatorId,
        assignedTo,
      );
      const bucketCounts = cursor ? undefined : await countCaseBuckets(client, req.auth!, {
        snapshot,
        ...(status ? { status } : {}),
        ...(creatorRole ? { creatorRole: creatorRole as CaseCreatorRole } : {}),
        ...(creatorId ? { creatorId } : {}),
        ...(assignedTo ? { assignedTo } : {}),
        ...(effectiveCountry ? { country: effectiveCountry } : {}),
        ...(effectiveChannel ? { channel: effectiveChannel } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
        ...(effectiveSearch ? { search: effectiveSearch } : {}),
      });
      const creatorOptions = !cursor && capabilities.canReadAllCases
        ? await listCaseCreatorOptions(client)
        : undefined;
      ok(res, {
        cases: cases.map((row) => caseToSummary(row, capabilities.canManageCases)),
        nextCursor,
        statusCounts,
        ...(bucketCounts ? { bucketCounts } : {}),
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
    assertCaseWriteCapability(req.auth!);
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new ApiError(415, 'VALIDATION_ERROR', 'La creación requiere consultar una matrícula en Flokzu. La importación Excel fue retirada.');
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

    const requestId = idempotencyKey(req);
    if (!requestId) throw new ApiError(400, 'VALIDATION_ERROR', 'Falta la identidad de la solicitud. Vuelve a consultar la matrícula.');
    const row = await createCaseFromPortal(createServerClient(), req.auth!, parsed.data, requestId);
    const importedAssets = (row.flokzu_data as { acquisition?: { assets?: unknown[] } } | null)?.acquisition?.assets;
    created(res, { case: caseToSummary({ ...row, evidence: [{ count: Array.isArray(importedAssets) ? importedAssets.length : 0 }] }, capabilitiesForRole(req.auth!.role).canManageCases), existingAuditId: row.existingAuditId ?? null });
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
  }

  methodNotAllowed(req, res, 'GET, POST, PATCH');
});
