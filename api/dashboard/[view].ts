import { z } from 'zod';
import {
  handleRoute,
  json,
  ok,
  methodNotAllowed,
  readJsonBody,
  ApiError,
  type QueryValue,
} from '../../src/server/http.js';
import { createServerClient } from '../../src/server/insforge.js';
import { capabilitiesForRole } from '../../src/server/capabilities.js';
import { addTicketComment, createTicket, INCIDENT_MODULES, listSanitizedErrors, listTickets, recordSanitizedError, TICKET_STATUSES, updateTicket } from '../../src/server/incidents.js';
import { parseDashboardFilters } from '../../src/server/dashboard-filters.js';
import {
  getAiCosts,
  getAiQuality,
  getDashboardFilterOptions,
  getDashboardSummary,
} from '../../src/server/dashboard-queries.js';
import {
  createAuditFeedback,
  createAuditVersion,
  createEvaluationDataset,
  createEvaluationRun,
  getContinuousImprovement,
  reviewAuditFeedback,
  changeAuditVersionStatus,
  FEEDBACK_CONCLUSIONS,
  FEEDBACK_ERROR_TYPES,
  runEvaluationBatch,
  registerCurrentProductionVersion,
} from '../../src/server/continuous-improvement.js';

// Vercel Hobby admite 12 Functions por deployment y, en un proyecto sin
// framework, cada archivo de `api/` es una Function. Los cuatro GET del
// dashboard salen de UNA sola función con el segmento dinámico `[view]`, de modo
// que las URLs públicas no cambian y el cliente no se entera:
//   GET /api/dashboard/summary  → 200 { summary }
//   GET /api/dashboard/quality  → 200 { quality }
//   GET /api/dashboard/ai-costs → 200 { costs }
//   GET /api/dashboard/options  → 200 { options }
const VIEWS = ['summary', 'ai-costs', 'quality', 'options', 'incidents', 'continuous-improvement'] as const;
type View = (typeof VIEWS)[number];

// Los lotes experimentales preparan como máximo un expediente y comparan las
// versiones seleccionadas; los resultados parciales quedan en InsForge para
// que el usuario pueda continuar si la Function llega a su límite.
export const maxDuration = 300;

function ticketDto<T extends { reporter_user_id?: string; events?: Array<{ author_user_id?: string }> }>(ticket: T): Omit<T, 'reporter_user_id'> & { events?: Array<Omit<NonNullable<T['events']>[number], 'author_user_id'>> } {
  const { reporter_user_id: _reporterId, events, ...safe } = ticket;
  return {
    ...safe,
    ...(events ? { events: events.map(({ author_user_id: _authorId, ...event }) => event) } : {}),
  } as Omit<T, 'reporter_user_id'> & { events?: Array<Omit<NonNullable<T['events']>[number], 'author_user_id'>> };
}

/**
 * Vocabulario cerrado: una vista que no existe es 404, no un 400 que adivine
 * cuál quiso pedir. Responde 404 y no 403 para no confirmar nada sobre el
 * despliegue (NO_RESOURCE_EXISTENCE_LEAK).
 */
function requiredView(query: Record<string, QueryValue>): View {
  const value = query.view;
  if (typeof value !== 'string' || !VIEWS.includes(value as View)) {
    throw new ApiError(404, 'NOT_FOUND', 'Vista de dashboard no encontrada');
  }
  return value as View;
}

// Vocabulario cerrado y el único filtro propio de la vista `ai-costs`. El resto
// de los params (`from`, `to`, `result`, `status`, `country`, `channel`) los valida
// `parseDashboardFilters`, que ya sabe redactar en español el 400.
const GranularitySchema = z.enum(['day', 'week', 'month'], {
  errorMap: () => ({ message: 'Granularidad no válida. Opciones: day, week, month.' }),
});

// `?granularity=` ausente o vacío -> `day`. Repetido (`?granularity=day&granularity=week`)
// es ambiguo y adivinar cuál vale sería inventar criterio: 400.
function parseGranularity(query: Record<string, QueryValue>): 'day' | 'week' | 'month' {
  const value = query.granularity;
  if (Array.isArray(value)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'El parámetro "granularity" se recibió varias veces: envía un solo valor.',
    );
  }
  if (value === undefined || value.trim() === '') return 'day';
  const parsed = GranularitySchema.safeParse(value.trim());
  if (!parsed.success) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `Parámetro "granularity": ${parsed.error.issues[0]?.message ?? 'valor no válido.'}`,
    );
  }
  return parsed.data;
}

// GET /api/dashboard/:view?from&to&result&status&country&channel[&granularity=day|week|month]
export default handleRoute(async (req, res) => {
  // El método se resuelve ANTES que la vista: un 405 no puede depender de que el
  // path además sea una vista existente.
  const view = requiredView(req.query);
  if (view === 'continuous-improvement') {
    const client = createServerClient();
    if (req.method === 'GET') {
      ok(res, await getContinuousImprovement(client, req.auth!));
      return;
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const action = z.object({ action: z.string() }).passthrough().safeParse(body);
      if (!action.success) throw new ApiError(400, 'VALIDATION_ERROR', 'La solicitud del módulo no es válida.');
      if (action.data.action === 'feedback') {
        const parsed = z.object({ action: z.literal('feedback'), caseId: z.string().uuid(), auditId: z.string().uuid(), errorType: z.enum(FEEDBACK_ERROR_TYPES), conclusion: z.enum(FEEDBACK_CONCLUSIONS), correctedProcedureSection: z.string().max(40).nullable(), justification: z.string().trim().min(10).max(5000), evidenceIds: z.array(z.string().uuid()).max(50) }).strict().safeParse(body);
        if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'La retroalimentación no cumple el formato esperado.');
        json(res, 201, { feedback: await createAuditFeedback(client, req.auth!, parsed.data) });
        return;
      }
      if (action.data.action === 'validate-feedback') {
        const parsed = z.object({ action: z.literal('validate-feedback'), feedbackId: z.string().uuid(), status: z.enum(['VALIDATED','REJECTED','NEEDS_CLARIFICATION']), note: z.string().trim().min(5).max(3000), checks: z.object({ finalResolution: z.boolean(), procedureSection: z.boolean(), evidenceReferences: z.boolean(), factsSupported: z.boolean(), priorityRuleChecked: z.boolean() }).strict(), facts: z.array(z.object({ fact: z.string().trim().min(3).max(500), evidenceIds: z.array(z.string().uuid()).min(1).max(20) }).strict()).max(30).optional(), eligibility: z.enum(['CONTEXTUAL','EVALUATION_ONLY']).optional() }).strict().safeParse(body);
        if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'La decisión de validación no cumple el formato esperado.');
        ok(res, await reviewAuditFeedback(client, req.auth!, parsed.data));
        return;
      }
      if (action.data.action === 'create-version') {
        const parsed = z.object({ action: z.literal('create-version'), versionKey: z.string().regex(/^audit-v[0-9]+\.[0-9]+(?:\.[0-9]+)?$/), name: z.string().trim().min(2).max(100), description: z.string().trim().min(10).max(2000), instructions: z.string().trim().min(20).max(12000), model: z.string().trim().min(3).max(160), parentVersionId: z.string().uuid().nullable().optional(), config: z.record(z.unknown()).default({}) }).strict().safeParse(body);
        if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'La versión del auditor no cumple el formato esperado.');
        json(res, 201, { version: await createAuditVersion(client, req.auth!, parsed.data) });
        return;
      }
      if (action.data.action === 'register-current-version') {
        const parsed = z.object({ action: z.literal('register-current-version') }).strict().safeParse(body);
        if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'La solicitud de versión activa no es válida.');
        json(res, 201, { version: await registerCurrentProductionVersion(client, req.auth!) });
        return;
      }
      if (action.data.action === 'version-status') {
        const parsed = z.object({ action: z.literal('version-status'), versionId: z.string().uuid(), status: z.enum(['EVALUATING','APPROVED','ACTIVE','ARCHIVED']) }).strict().safeParse(body);
        if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'La transición de versión no es válida.');
        ok(res, { version: await changeAuditVersionStatus(client, req.auth!, parsed.data.versionId, parsed.data.status) });
        return;
      }
      if (action.data.action === 'create-dataset') {
        const parsed = z.object({ action: z.literal('create-dataset'), name: z.string().trim().min(2).max(100), description: z.string().trim().min(10).max(1000), split: z.enum(['IMPROVEMENT','HELD_OUT']), exampleIds: z.array(z.string().uuid()).min(1).max(100) }).strict().safeParse(body);
        if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'El conjunto de evaluación no cumple el formato esperado.');
        json(res, 201, { dataset: await createEvaluationDataset(client, req.auth!, parsed.data) });
        return;
      }
      if (action.data.action === 'run-evaluation') {
        const parsed = z.object({ action: z.literal('run-evaluation'), datasetId: z.string().uuid(), versionIds: z.array(z.string().uuid()).min(2).max(4), budgetLimit: z.number().positive().max(50), idempotencyKey: z.string().uuid() }).strict().safeParse(body);
        if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'El experimento no cumple el formato esperado.');
        const run = await createEvaluationRun(client, req.auth!, parsed.data);
        const batch = await runEvaluationBatch(client, req.auth!, String((run as { id: string }).id));
        json(res, 202, batch);
        return;
      }
      if (action.data.action === 'resume-evaluation') {
        const parsed = z.object({ action: z.literal('resume-evaluation'), runId: z.string().uuid() }).strict().safeParse(body);
        if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'El experimento seleccionado no es válido.');
        ok(res, await runEvaluationBatch(client, req.auth!, parsed.data.runId));
        return;
      }
      throw new ApiError(400, 'VALIDATION_ERROR', 'La acción del módulo no existe.');
    }
    methodNotAllowed(req, res, 'GET, POST');
    return;
  }
  if (view !== 'incidents' && req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET');
    return;
  }
  if (view === 'incidents') {
    const client = createServerClient();
    const capabilities = capabilitiesForRole(req.auth!.role);
    if (req.method === 'GET') {
      const tickets = await listTickets(client, req.auth!, capabilities.canManageCases);
      const errors = capabilities.canManageCases ? await listSanitizedErrors(client) : [];
      ok(res, { tickets: tickets.map(ticketDto), errors });
      return;
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const reportSchema = z.object({
        kind: z.literal('ticket'),
        module: z.enum(INCIDENT_MODULES),
        description: z.string().trim().min(10).max(5000),
        context: z.object({ route: z.string().max(120).optional(), correlationId: z.string().uuid().optional() }).strict().optional(),
      }).strict();
      const errorSchema = z.object({
        kind: z.literal('client-error'),
        source: z.enum(['FRONTEND', 'ASYNC']),
        category: z.enum(['FRONTEND_ERROR', 'UNHANDLED_REJECTION']),
        module: z.string().max(80),
        route: z.string().max(160),
        correlationId: z.string().uuid(),
      }).strict();
      const ticketCommentSchema = z.object({ kind: z.literal('ticket-comment'), ticketId: z.string().uuid(), comment: z.string().trim().min(1).max(5000) }).strict();
      const ticket = reportSchema.safeParse(body);
      if (ticket.success) {
        const createdTicket = await createTicket(client, req.auth!, ticket.data);
        json(res, 201, { ticket: ticketDto(createdTicket) });
        return;
      }
      const clientError = errorSchema.safeParse(body);
      if (clientError.success) {
        await recordSanitizedError(client, {
          correlation_id: clientError.data.correlationId,
          source: clientError.data.source,
          category: clientError.data.category,
          module: clientError.data.module,
          route: clientError.data.route,
        });
        ok(res, { recorded: true });
        return;
      }
      const ticketComment = ticketCommentSchema.safeParse(body);
      if (ticketComment.success) {
        await addTicketComment(client, req.auth!, { ...ticketComment.data, canManage: capabilities.canManageCases });
        ok(res, { saved: true });
        return;
      }
      throw new ApiError(400, 'VALIDATION_ERROR', 'El reporte de incidencia no tiene el formato esperado.');
    }
    if (req.method === 'PATCH') {
      if (!capabilities.canManageCases) throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para administrar incidencias.');
      const parsed = z.object({ ticketId: z.string().uuid(), status: z.enum(TICKET_STATUSES), comment: z.string().trim().max(5000).optional() }).strict().safeParse(await readJsonBody(req));
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'La actualización del ticket no es válida.');
      const updated = await updateTicket(client, req.auth!, { ...parsed.data, comment: parsed.data.comment ?? '' });
      ok(res, { ticket: ticketDto(updated) });
      return;
    }
    methodNotAllowed(req, res, 'GET, POST, PATCH');
    return;
  }
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET');
    return;
  }
  const capabilities = capabilitiesForRole(req.auth!.role);
  if (view === 'quality' && !capabilities.canManageCases && !capabilities.canFinalizeAnyCase) {
    throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para consultar este módulo.');
  }
  if (view === 'ai-costs' && !capabilities.canManageCases) {
    throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para consultar este módulo.');
  }
  const client = createServerClient();

  // `options` es la única vista sin filtros: devuelve el catálogo. Recibe el
  // alcance autenticado para no ofrecer valores que solo existan en pruebas o en
  // casos que el actor no puede ver.
  if (view === 'options') {
    ok(res, { options: await getDashboardFilterOptions(client, req.auth) });
    return;
  }

  const filters = parseDashboardFilters(req.query);
  if (view === 'summary') {
    const summary = await getDashboardSummary(client, filters, req.auth);
    if (!capabilitiesForRole(req.auth!.role).canManageCases) {
      const { activity: _activity, cost: _cost, ...operationalSummary } = summary;
      ok(res, { summary: operationalSummary });
    } else ok(res, { summary });
    return;
  }
  if (view === 'quality') {
    ok(res, { quality: await getAiQuality(client, filters, req.auth) });
    return;
  }
  const costs = await getAiCosts(client, filters, parseGranularity(req.query), req.auth);
  ok(res, { costs });
});
