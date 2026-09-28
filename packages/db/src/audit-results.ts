import { assessmentSchema, reviewSchema, type Assessment, type Review } from '@cancelaciones/shared';
import type { DatabaseClient } from './client';
import { asText } from './rows';

const TABLE = 'audit_results';

export const AUDIT_RESULT_STAGES = ['ANALYST', 'REVIEWER', 'FINAL'] as const;
export type AuditResultStage = (typeof AUDIT_RESULT_STAGES)[number];

export const AUDIT_RESULT_STATUSES = ['COMPLETED', 'NEEDS_INPUT', 'FAILED'] as const;
export type AuditResultStatus = (typeof AUDIT_RESULT_STATUSES)[number];

export interface AuditResultRecord {
  id: string;
  auditId: string;
  runId: string;
  stage: AuditResultStage;
  status: AuditResultStatus;
  classification: string | null;
  summary: string;
  assessment: Assessment;
  review: Review | null;
  createdAt: string;
}

export interface CreateAuditResultInput {
  auditId: string;
  runId: string;
  stage: AuditResultStage;
  status: AuditResultStatus;
  classification?: string | null;
  summary: string;
  assessment: Assessment;
  review?: Review | null;
}

const COLUMNS = ['id', 'audit_id', 'run_id', 'stage', 'status', 'classification', 'summary', 'assessment', 'review', 'created_at'].join(',');

interface Row {
  id: string;
  audit_id: string;
  run_id: string;
  stage: AuditResultStage;
  status: AuditResultStatus;
  classification: string | null;
  summary: string | null;
  assessment: Assessment;
  review: Review | null;
  created_at: string;
}

function toRecord(row: Row): AuditResultRecord {
  return {
    id: row.id,
    auditId: row.audit_id,
    runId: row.run_id,
    stage: row.stage,
    status: row.status,
    classification: asText(row.classification),
    summary: row.summary ?? '',
    assessment: row.assessment,
    review: row.review ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Repositorio de `audit_results`: el dictamen por etapa.
 *
 * El UNIQUE de `run_id` dice que un run produce UN resultado, y esta tabla es la
 * que el reportador lee para emitir el Dictamen. Por eso el assessment se valida
 * con el schema de `@cancelaciones/shared` ANTES de tocar la base: un dictamen
 * NEEDS_INPUT sin `missingEvidence` es el INDETERMINADO que el esquema elimina a
 * propósito, y un resultado así guardado ya no se puede volver a validar más
 * tarde sin reescribir historia.
 */
export function createAuditResultRepository(database: DatabaseClient) {
  return {
    async create(input: CreateAuditResultInput): Promise<AuditResultRecord> {
      // Validación primero: si el dictamen no se sostiene, no se deja ni una fila.
      const assessment = assessmentSchema.parse(input.assessment);
      const review = input.review ? reviewSchema.parse(input.review) : null;

      const { data: existentes, error: lookupError } = await database
        .from(TABLE)
        .select('id,run_id')
        .eq('run_id', input.runId)
        .limit(1);

      if (lookupError) throw new Error(lookupError.message ?? 'No se pudo comprobar el resultado previo del run.');
      if (((existentes ?? []) as Row[]).length > 0) {
        throw new Error(`El run ${input.runId} ya tiene un resultado: audit_results.run_id es UNIQUE y no se reescribe.`);
      }

      const { data, error } = await database
        .from(TABLE)
        .insert([
          {
            audit_id: input.auditId,
            run_id: input.runId,
            stage: input.stage,
            status: input.status,
            classification: input.classification ?? assessment.classification ?? null,
            summary: input.summary,
            assessment,
            review,
          },
        ])
        .select(COLUMNS)
        .single();

      if (error) throw new Error(error.message ?? 'No se pudo guardar el resultado de la auditoria.');
      if (!data) throw new Error('La base no devolvio el resultado recien creado.');
      return toRecord(data as Row);
    },

    async findByRun(runId: string): Promise<AuditResultRecord | null> {
      const { data, error } = await database.from(TABLE).select(COLUMNS).eq('run_id', runId).limit(1);
      if (error) throw new Error(error.message ?? `No se pudo leer el resultado del run ${runId}.`);
      const rows = (data ?? []) as Row[];
      return rows.length > 0 ? toRecord(rows[0]) : null;
    },

    /**
     * El dictamen que se entrega: el FINAL más reciente. Se filtra por `stage`
     * en la consulta y no en memoria, porque un caso con muchas pasadas no
     * debería traer al reportador los dictámenes que ya no valen.
     */
    async finalForAudit(auditId: string): Promise<AuditResultRecord | null> {
      const { data, error } = await database
        .from(TABLE)
        .select(COLUMNS)
        .eq('audit_id', auditId)
        .eq('stage', 'FINAL')
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw new Error(error.message ?? `No se pudo leer el dictamen final de ${auditId}.`);
      const rows = (data ?? []) as Row[];
      return rows.length > 0 ? toRecord(rows[0]) : null;
    },
  };
}

export type AuditResultRepository = ReturnType<typeof createAuditResultRepository>;
