import { describe, expect, it } from 'vitest';
import { assertCaseOwner, caseOwnedBy, type CaseRow } from '../src/server/cases.js';
import { ApiError } from '../src/server/errors.js';
import { fakeAuthContext, FAKE_COORDINATOR_SUB, FAKE_USER_SUB } from './helpers/auth.js';

const flokzuCase: CaseRow = {
  id: '00000000-0000-0000-0000-000000000010',
  status: 'DRAFT',
  student_identifier: '000123456',
  student_name: 'Estudiante sintético',
  created_by: FAKE_COORDINATOR_SUB,
  assigned_to: FAKE_USER_SUB,
  external_source: 'FLOKZU',
  external_case_id: 'CaVe-31024',
  created_at: '2026-10-12T00:00:00.000Z',
  updated_at: '2026-10-12T00:00:00.000Z',
};

describe('propiedad de tickets importados', () => {
  it('permite trabajar al Asesor asignado y mantiene al Coordinador como creador de auditoría', () => {
    const advisor = fakeAuthContext('user');
    expect(caseOwnedBy(flokzuCase, advisor.sub)).toBe(true);
    expect(() => assertCaseOwner(flokzuCase, advisor)).not.toThrow();
    expect(caseOwnedBy(flokzuCase, FAKE_COORDINATOR_SUB)).toBe(false);
    expect(() => assertCaseOwner(flokzuCase, fakeAuthContext('coordinator', { sub: FAKE_COORDINATOR_SUB }))).toThrowError(ApiError);
  });

  it('no asigna propiedad por creador a un ticket Flokzu pendiente', () => {
    const unassigned = { ...flokzuCase, assigned_to: null };
    expect(caseOwnedBy(unassigned, FAKE_USER_SUB)).toBe(false);
    expect(caseOwnedBy(unassigned, FAKE_COORDINATOR_SUB)).toBe(false);
  });

  it('conserva la propiedad por creador en los casos manuales existentes', () => {
    const manual = { ...flokzuCase, external_source: null, external_case_id: null, assigned_to: null };
    expect(caseOwnedBy(manual, FAKE_COORDINATOR_SUB)).toBe(true);
  });
  it('permite al Coordinador terminar la carga de un manual con CaVe asignado a un Asesor', () => {
    const manualWithCave = { ...flokzuCase, flokzu_data: null };
    expect(caseOwnedBy(manualWithCave, FAKE_COORDINATOR_SUB)).toBe(true);
    expect(caseOwnedBy(manualWithCave, FAKE_USER_SUB)).toBe(true);
    expect(caseOwnedBy({ ...manualWithCave, flokzu_data: {} }, FAKE_COORDINATOR_SUB)).toBe(false);
    expect(caseOwnedBy({ ...manualWithCave, merged_into_case_id: 'principal' }, FAKE_COORDINATOR_SUB)).toBe(false);
  });
});

it('un CaVe asignado permite trabajar aunque la clasificación administrativa antigua lo bloqueara', () => {
  const legacy = { ...flokzuCase, status: 'READY' as const, flokzu_data: {}, flokzu_audit_eligible: false };
  expect(caseOwnedBy(legacy, FAKE_USER_SUB)).toBe(true);
  expect(() => assertCaseOwner(legacy, fakeAuthContext('user'))).not.toThrow();
  expect(caseOwnedBy(legacy, FAKE_COORDINATOR_SUB)).toBe(false);
  expect(caseOwnedBy({ ...legacy, merged_into_case_id: 'principal' }, FAKE_USER_SUB)).toBe(false);
});
