/**
 * Test 19/20 — Inmutabilidad de las fuentes normativas.
 *
 * ## `POLICY_IS_IMMUTABLE`
 *
 * Este es el test que hace cumplir el invariante más importante del proyecto.
 * Las tres fuentes normativas están selladas por SHA-256 en
 * `docs/policy-v2/source-lock.md` y en `src/sources.ts`. Si alguien edita un
 * PDF —o lo sustituye por otro— el motor seguiría produciendo resultados
 * idénticos, citando una fuente que ya no dice lo que el motor cree que
 * dice. Eso no es un bug de código: es una falsificación silenciosa de la
 * política.
 *
 * Por eso el test lee los archivos del disco en vez de confiar en las
 * constantes de TypeScript: las constantes pueden editarse junto con el código
 * sin que nada se queje, el PDF es la fuente real.
 *
 * ## Por qué el motor debe seguir siendo puro
 *
 * Este test sí toca el disco, y a propósito: es una verificación de integridad
 * que ocurre fuera del motor. `evaluateAudit()` no lee archivos, no usa reloj y
 * no hace red; si algún día lo hiciera, esta separación se rompería y el motor
 * dejaría de ser testeable y determinista.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULES, SOURCES, sourceById } from '../index';

/**
 * Raíz del repositorio. Este archivo vive en `<repo>/packages/rule-engine-v2/
 * src/tests`, así que son cuatro niveles hacia arriba: `tests` → `src` →
 * `rule-engine-v2` → `packages` → raíz.
 */
const ROOT = join(__dirname, '..', '..', '..', '..');
const NORMATIVE = join(ROOT, 'normative');

/** Rutas canónicas y sellos, tal como quedan registrados en `source-lock.md`. */
const LOCK: { readonly sourceLockId: string; readonly file: string; readonly sha256: string }[] = [
  {
    sourceLockId: 'SOURCE-01',
    file: 'GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf',
    sha256: '71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2',
  },
  {
    sourceLockId: 'SOURCE-02',
    file: 'GDM_GAM_PRD_MXL_008 Procedimiento D53 .docx.pdf',
    sha256: '49c30482571ebce425d5ff217584c1b390d7c0986f4e93ce033c98df4ee7c383',
  },
  {
    sourceLockId: 'SOURCE-03',
    file: 'Glosario de operación escolar.pdf',
    sha256: 'de15e50b4faa6919fb4b7de25cf9bb5e6ee538348b8657ba38d8a48e9463e9f5',
  },
];

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('las fuentes normativas están selladas', () => {
  it('cada PDF existe en la ruta canónica', () => {
    for (const entry of LOCK) {
      expect(existsSync(join(NORMATIVE, entry.file)), entry.file).toBe(true);
    }
  });

  it('el contenido en disco coincide con el SHA-256 registrado', () => {
    for (const entry of LOCK) {
      expect(sha256(join(NORMATIVE, entry.file)), entry.file).toBe(entry.sha256);
    }
  });

  it('el motor declara los mismos sellos que el disco', () => {
    // Las constantes de `sources.ts` y los archivos deben decir lo mismo.
    for (const entry of LOCK) {
      expect(sourceById(entry.sourceLockId as never).sha256, entry.sourceLockId).toBe(entry.sha256);
    }
  });

  it('el sello del disco coincide con el sello del motor, fuente por fuente', () => {
    for (const entry of LOCK) {
      const enDisco = sha256(join(NORMATIVE, entry.file));
      expect(enDisco).toBe(sourceById(entry.sourceLockId as never).sha256);
    }
  });
});

describe('identidad de las fuentes', () => {
  it('hay exactamente tres fuentes registradas', () => {
    expect(SOURCES).toHaveLength(3);
    expect(LOCK).toHaveLength(3);
  });

  it('no hay sellos duplicados', () => {
    const sellos = SOURCES.map((s) => s.sha256);
    expect(new Set(sellos).size).toBe(sellos.length);
  });

  it('cada fuente declara código, título, versión y paginación', () => {
    for (const source of SOURCES) {
      expect(source.documentCode.length, source.sourceLockId).toBeGreaterThan(0);
      expect(source.title.length, source.sourceLockId).toBeGreaterThan(0);
      expect(source.documentVersion.length, source.sourceLockId).toBeGreaterThan(0);
      expect(source.pages, source.sourceLockId).toBeGreaterThan(0);
    }
  });

  it('las 26 páginas de la fuente primaria se reflejan en el registro', () => {
    // `source-lock.md` fija 26 páginas; una discrepancia significaría que el PDF
    // ya no es el que se selló.
    expect(sourceById('SOURCE-01' as never).pages).toBe(26);
  });

  it('la fuente normativa primaria se identifica por su código de control', () => {
    // El nombre del archivo no es la identidad: el código impreso en las 26
    // páginas lo es. Por eso se comprueba el código, no el nombre.
    expect(sourceById('SOURCE-01' as never).documentCode).toBe('GDM_GAM_PRD_MLG_003');
    expect(sourceById('SOURCE-01' as never).documentVersion).toBe('5');
  });

  it('la fuente D53 se identifica por su propio código', () => {
    expect(sourceById('SOURCE-02' as never).documentCode).toContain('GDM_GAM_PRD_MXL_008');
  });

  it('el glosario se registra aparte de las procedimientos', () => {
    // El glosario define términos; no es un procedimiento y no decide desenlaces.
    expect(sourceById('SOURCE-03' as never).documentCode).toBe('GLOSARIO_OPERACION_ESCOLAR');
    expect(sourceById('SOURCE-03' as never).documentCode).not.toContain('GDM');
  });
});

describe('las citas del motor apuntan a fuentes selladas', () => {
  it('toda cita de toda regla resuelve a una fuente registrada', () => {
    const conocidas = new Set(SOURCES.map((s) => s.sourceLockId));
    const citas = new Set<string>();
    for (const rule of [...RULES]) {
      for (const ref of rule.sourceRefs) {
        expect(conocidas.has(ref.sourceLockId), `${rule.ruleId} -> ${ref.sourceLockId}`).toBe(true);
        expect(ref.sha256, rule.ruleId).toBe(sourceById(ref.sourceLockId as never).sha256);
        citas.add(ref.sourceLockId);
      }
    }
    // Y al menos una regla cita a cada fuente: si el glosario no lo citara
    // nadie, su registro sería decorativo.
    expect(citas.size).toBe(SOURCES.length);
  });
});