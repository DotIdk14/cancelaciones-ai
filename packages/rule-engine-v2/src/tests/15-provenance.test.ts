/**
 * Test 15/20 — Procedencia: hecho, regla y fuente.
 *
 * ## `PRESERVE_EVIDENCE_PROVENANCE`
 *
 * Una decisión motivada exige poder responder tres preguntas por separado:
 *
 * 1. **¿De qué evidencia salió este hecho?** → `Fact.provenance` y
 *    `Fact.evidenceRefs`.
 * 2. **Con qué regla se evaluó?** → `TraceEntry.ruleId` y `conditionFingerprint`.
 * 3. **¿En qué página y enunciado dice eso?** → `SourceRef` con `sha256`.
 *
 * Un resultado sin las tres respuestas es una afirmación, no una evaluación. Y
 * la tercera es la que impide que alguien cambie la fuente después del hecho y
 * siga produciendo el mismo resultado sin que nadie lo note.
 */

import { describe, expect, it } from 'vitest';
import {
  POLICY_VERSION,
  SOURCES,
  evaluateAudit,
  factDefinition,
  knownFact,
  ruleById,
} from '../index';
import type { EvidenceContext, Fact, SourceRef } from '../index';
import { bool, evidencia } from '../testing/fixtures';

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
 * SHA-256 esperados, copiados literalmente de `docs/policy-v2/source-lock.md`.
 *
 * Se comparan por `sourceLockId` y no por nombre de documento: si alguien
 * renombrara el archivo, el test debe seguir detectando que el contenido cambió.
 */
const SOURCE_LOCK: Record<string, string> = {
  'SOURCE-01': '71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2',
  'SOURCE-02': '49c30482571ebce425d5ff217584c1b390d7c0986f4e93ce033c98df4ee7c383',
  'SOURCE-03': 'de15e50b4faa6919fb4b7de25cf9bb5e6ee538348b8657ba38d8a48e9463e9f5',
};

describe('procedencia de la decisión', () => {
  it('cada fuente sellada declara un SHA-256 de 64 hexadecimales', () => {
    for (const source of SOURCES) {
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('los SHA-256 coinciden con docs/policy-v2/source-lock.md', () => {
    // Si cambia un hash sin cambiar el documento, alguien reescribió la fuente.
    expect(SOURCES).toHaveLength(3);
    for (const source of SOURCES) {
      expect(source.sha256, source.sourceLockId).toBe(SOURCE_LOCK[source.sourceLockId]);
    }
  });

  it('cada regla cita al menos una fuente sellada', () => {
    for (const id of ['R-FILTRO-CALIFICACIONES', 'R-ILOC', 'R-CV-DEF', 'R-REGLA-20-DIAS']) {
      const rule = ruleById(id);
      expect(rule?.sourceRefs.length ?? 0, id).toBeGreaterThan(0);
    }
  });

  it('toda cita apunta a una fuente registrada', () => {
    const conocidos = new Set(SOURCES.map((s) => s.sourceLockId));
    const citas: SourceRef[] = [];
    for (const id of ['R-FILTRO-CALIFICACIONES', 'R-ILOC', 'R-CV-DEF', 'R-D35-RELOJ-50']) {
      citas.push(...(ruleById(id)?.sourceRefs ?? []));
    }
    for (const cita of citas) {
      expect(conocidos.has(cita.sourceLockId), cita.sourceLockId).toBe(true);
    }
  });

  it('toda cita incluye página, sección y enunciado', () => {
    for (const id of ['R-FILTRO-CALIFICACIONES', 'R-ILOC', 'R-CV-DEF']) {
      for (const cita of ruleById(id)?.sourceRefs ?? []) {
        expect(cita.page, id).toBeGreaterThan(0);
        expect(cita.section.length, id).toBeGreaterThan(0);
        expect(cita.statementId.length, id).toBeGreaterThan(0);
      }
    }
  });

  it('la cita de la regla viaja dentro de la evaluación', () => {
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    const paso = r.trace.entries.find((e) => e.ruleId === 'R-FILTRO-CALIFICACIONES');
    expect(paso?.sourceRefs?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la evaluación expone las fuentes que tocó', () => {
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    expect(r.sourceRefs.length).toBeGreaterThan(0);
    for (const ref of r.sourceRefs) {
      expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('cada hecho del catálogo declara su procedencia', () => {
    for (const factId of ['F-retencion_realizada', 'F-canal_venta', 'F-actividad_licenciatura']) {
      const definition = factDefinition(factId);
      expect(definition.sourceRefs.length, factId).toBeGreaterThan(0);
    }
  });

  it('un hecho conocido conserva la evidencia de la que se extrajo', () => {
    const fact = knownFact('F-retencion_realizada', true, { evidenceRefs: [evidencia('EV-1')] });
    const r = evaluateAudit({
      facts: [fact],
      evidenceContext: contexto(),
      policyVersion: POLICY_VERSION,
    });
    const paso = r.trace.entries.find((e) => e.kind === 'FACT' && e.ref === 'F-retencion_realizada');
    const value = paso?.value as Record<string, unknown>;
    expect((value.evidenceRefs as unknown[]).length).toBeGreaterThan(0);
  });

  it('cada paso de regla lleva la huella de su condición', () => {
    // Sin esto, dos reglas con la misma condición sería indistinguibles en la
    // traza y no se podría detectar un cambio de lógica.
    const r = evaluar([bool('F-retencion_realizada', true)]);
    for (const paso of r.trace.entries.filter((e) => e.kind === 'RULE')) {
      const value = paso.value as Record<string, unknown>;
      expect(String(value.conditionFingerprint)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it('cada hecho faltante cita la fuente que lo define', () => {
    const r = evaluar([]);
    for (const requirement of r.missingFacts) {
      expect(requirement.sourceRefs.length, requirement.factId).toBeGreaterThan(0);
    }
  });

  it('los conflictos declaran su procedencia', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    for (const conflicto of r.policyConflicts) {
      expect(conflicto.sourceRefs.length, conflicto.conflictId).toBeGreaterThan(0);
    }
  });
});
