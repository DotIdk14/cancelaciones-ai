import type {
  Campus,
  EvaluateAuditInput,
  EvidenceRef,
  Fact,
  NivelAcademico,
  TemporalContext,
} from '../contracts';
import { POLICY_VERSION } from '../contracts';

export interface BuildCanonicalEvaluateAuditInputParams {
  readonly facts: readonly Fact[];
  readonly evidences: readonly EvidenceRef[];
  readonly temporal: TemporalContext;
  readonly nivelAcademico: NivelAcademico | null;
  readonly campus: Campus | null;
  readonly policyVersion?: string;
}

export function buildCanonicalEvaluateAuditInput(
  params: BuildCanonicalEvaluateAuditInputParams,
): EvaluateAuditInput {
  validateTemporalContext(params.temporal);
  return {
    facts: params.facts,
    evidenceContext: {
      evidences: params.evidences,
      temporal: params.temporal,
      nivelAcademico: params.nivelAcademico,
      campus: params.campus,
    },
    policyVersion: params.policyVersion ?? POLICY_VERSION,
  };
}

export function validateTemporalContext(temporal: TemporalContext): void {
  validateOptionalDate('cicloFechaInicio', temporal.cicloFechaInicio);
  validateOptionalDate('fechaSolicitud', temporal.fechaSolicitud);
  validateOptionalDate('fechaIngreso', temporal.fechaIngreso);
  validateOptionalDate('inicioPrimerCiclo', temporal.inicioPrimerCiclo);
  if (
    temporal.avanceCurricularPercent !== null &&
    (!Number.isInteger(temporal.avanceCurricularPercent) ||
      temporal.avanceCurricularPercent < 0 ||
      temporal.avanceCurricularPercent > 100)
  ) {
    throw new Error('avance curricular debe ser entero 0..100 o null.');
  }
}

function validateOptionalDate(field: string, value: string | null): void {
  if (value === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field}: se esperaba fecha ISO YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field}: se esperaba fecha ISO YYYY-MM-DD.`);
  }
}
