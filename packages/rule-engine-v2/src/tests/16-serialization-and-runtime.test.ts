/**
 * Test 16/20 — Serialización, dependencias en tiempo de ejecución y CJK.
 *
 * ## Qué cubre
 *
 * - **Round-trip**: `JSON.stringify` → `JSON.parse` debe devolver el mismo
 *   resultado, porque el motor va a guardarse en `engine_runs.evaluation` y a
 *   leerse de vuelta. Un `Set`, un `Map` o un `undefined` en el contrato romperían
 *   ese viaje.
 * - **ESM**: el paquete es ESM. Un `require()` o un identificador usado antes de
 *   declararse rompe en runtime sin romper el typecheck.
 * - **CJK**: el proyecto exige español. Caracteres CJK colados en comentarios o
 *   literales son ruido de otro idioma dentro de una fuente normativa, y este
 *   test es el guardarraíl.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit } from '../index';
import type { EvidenceContext, Fact } from '../index';
import { bool, contradicted, evidencia, unknown as unknownFact } from '../testing/fixtures';

const SRC = join(__dirname, '..');

function contexto(): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: '2026-01-05',
      fechaSolicitud: '2026-01-15',
      fechaIngreso: '2026-01-05',
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

function evaluar(facts: Fact[]) {
  return evaluateAudit({ facts, evidenceContext: contexto(), policyVersion: POLICY_VERSION });
}

/**
 * Archivos TypeScript del paquete, sin `node_modules` ni `dist`.
 *
 * Este archivo se excluye a sí mismo: contiene literalmente los patrones que
 * busca (`require(`, `module.exports`, rangos CJK), así que incluirlo haría que
 * el guardarraíl fallara siempre.
 */
const SELF = '16-serialization-and-runtime.test.ts';

function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && entry !== SELF) out.push(full);
  }
  return out;
}

describe('serialización del resultado', () => {
  it('la evaluación sobrevive a un viaje por JSON', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    const idaYVuelta = JSON.parse(JSON.stringify(r)) as typeof r;
    expect(idaYVuelta).toEqual(r);
  });

  it('el viaje por JSON no pierde la separación normativo/provisional', () => {
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    const vuelta = JSON.parse(JSON.stringify(r)) as typeof r;
    expect(vuelta.normativeOutcome).toBe('BAJA');
    expect(vuelta.closestOutcome).toBe('BAJA');
  });

  it('el caso en revisión sigue sin resultado normativo tras el viaje', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    const vuelta = JSON.parse(JSON.stringify(r)) as typeof r;
    expect(vuelta.normativeStatus).toBe('REQUIRES_HUMAN_REVIEW');
    expect(vuelta.normativeOutcome).toBeNull();
  });

  it('el cortocircuito sobrevive al viaje', () => {
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    const vuelta = JSON.parse(JSON.stringify(r)) as typeof r;
    expect(vuelta.shortCircuit?.ruleId).toBe('R-FILTRO-CALIFICACIONES');
  });

  it('un caso sin cortocircuito serializa como null, no como ausente', () => {
    const r = evaluar([bool('F-retencion_realizada', true)]);
    const vuelta = JSON.parse(JSON.stringify(r)) as typeof r;
    expect(vuelta.shortCircuit).toBeNull();
  });

  it('la huella de la traza no cambia al serializar', () => {
    const r = evaluar([bool('F-retencion_realizada', true)]);
    const vuelta = JSON.parse(JSON.stringify(r)) as typeof r;
    expect(vuelta.trace.fingerprint).toBe(r.trace.fingerprint);
  });

  it('hechos en estado no booleano también sobreviven', () => {
    const r = evaluar([contradicted('F-retencion_realizada'), unknownFact('F-op_incidencia_sistema')]);
    const vuelta = JSON.parse(JSON.stringify(r)) as typeof r;
    expect(vuelta.trace.entries.length).toBe(r.trace.entries.length);
  });
});

describe('módulo ESM en tiempo de ejecución', () => {
  it('ningún archivo del paquete usa require()', () => {
    for (const file of sourceFiles()) {
      const contents = readFileSync(file, 'utf-8');
      // Un `require` en ESM falla sólo al ejecutar, no al compilar.
      expect(contents, file).not.toMatch(/\brequire\s*\(/);
    }
  });

  it('ningún archivo usa module.exports ni exports.', () => {
    for (const file of sourceFiles()) {
      const contents = readFileSync(file, 'utf-8');
      expect(contents, file).not.toMatch(/\bmodule\.exports\b/);
      expect(contents, file).not.toMatch(/^\s*exports\./m);
    }
  });

  it('el paquete declara type: module', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf-8')) as {
      type?: string;
    };
    expect(pkg.type).toBe('module');
  });
});

describe('guardarraíl de idioma (CJK)', () => {
  it('ningún archivo del paquete contiene caracteres CJK', () => {
    const cjk = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿＀-￯]/;
    const infractores: string[] = [];
    for (const file of sourceFiles()) {
      if (cjk.test(readFileSync(file, 'utf-8'))) infractores.push(file);
    }
    // El proyecto se documenta en español. Caracteres CJK en el motor serían
    // texto de otro idioma dentro de una fuente normativa.
    expect(infractores).toEqual([]);
  });
});
