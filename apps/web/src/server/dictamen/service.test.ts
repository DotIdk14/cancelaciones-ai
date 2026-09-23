import { describe, expect, it } from 'vitest';
import { approveSnapshot, buildSnapshot, generateDraft, generateFinal, saveEvidenceSelection, submitHumanReview } from './service';
import type { AuthorizedContext } from '../reporting/authz';

// ---------------------------------------------------------------------------
// Mock de cliente InsForge encadenable (DatabaseClient es `any` en @cancelaciones/db)
// ---------------------------------------------------------------------------

type TableHandler = (ops: { insert?: unknown[]; update?: unknown; selectedData?: unknown }) => { data: unknown; error: { message: string } | null };

class MockQuery {
  private ops: { insert?: unknown[]; update?: unknown; selectedData?: unknown } = {};
  constructor(private table: string, private handler: TableHandler) {}
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  limit() { return this; }
  single() { return this; }
  insert(rows: unknown[]) { this.ops.insert = rows; return this; }
  update(value: unknown) { this.ops.update = value; return this; }
  delete() { return this; }
  get data() { return this.handler(this.ops).data; }
  get error() { return this.handler(this.ops).error; }
}

function mockClient(tables: Record<string, { data: unknown; error?: { message: string } | null }>) {
  return {
    database: {
      from(table: string) {
        const resolved = tables[table] ?? { data: [], error: null };
        return new MockQuery(table, () => ({ data: resolved.data, error: resolved.error ?? null }));
      },
    },
    storage: {
      from: () => ({ upload: async () => ({ data: {}, error: null }), download: async () => ({ data: new Uint8Array(0), error: null }) }),
    },
  } as unknown as AuthorizedContext['client'];
}

const auth = (client: ReturnType<typeof mockClient>): AuthorizedContext => ({
  user: { id: 'user-1' },
  client: client as AuthorizedContext['client'],
  auditId: 'audit-1',
});

const engineRun = {
  id: 'run-1',
  audit_id: 'audit-1',
  fact_run_id: 'factrun-1',
  policy_code: 'GDM_GAM_PRD_MLG_003',
  policy_version: '5',
  rules_fingerprint: 'r-fp',
  facts_fingerprint: 'f-fp',
  status: 'COMPLETED',
  suggested_outcome: 'CANCELACION_VENTA',
  outcome_status: 'DETERMINED',
  evaluation: { decisionStatus: 'READY_TO_APPROVE', suggestedReason: 'Cumple criterios de contacto.', trace: { ruleIds: ['R1'], factIds: ['F1'], evidenceRefs: [] } },
  created_at: '2026-09-23T10:00:00.000Z',
};

describe('submitHumanReview', () => {
  it('CORRECT sin humanReason falla con codigo controlado', async () => {
    const client = mockClient({
      engine_runs: { data: [engineRun] },
      human_reviews: { data: [] },
    });
    await expect(
      submitHumanReview(auth(client), { decisionType: 'CORRECT', humanOutcome: 'BAJA', humanReason: null }),
    ).rejects.toMatchObject({ code: 'MISSING_HUMAN_REASON' });
  });

  it('APPROVE persiste la revision humana', async () => {
    let inserted: Record<string, unknown> | null = null;
    const tables: Record<string, { data: unknown; error?: { message: string } | null }> = {
      engine_runs: { data: [engineRun] },
      human_reviews: { data: [] },
    };
    const client = {
      database: {
        from(table: string) {
          const query = {
            select() { return query; },
            eq() { return query; },
            order() { return query; },
            limit() { return query; },
            single() {
              const current = tables[table]?.data;
              return { data: Array.isArray(current) ? (current as unknown[])[0] : current, error: tables[table]?.error ?? null };
            },
            insert(rows: unknown[]) {
              if (table === 'human_reviews') { inserted = (rows as Record<string, unknown>[])[0]; tables[table] = { data: [rows[0]], error: null }; }
              return query;
            },
            update() { return query; },
            delete() { return query; },
            get data() { return tables[table]?.data ?? []; },
            get error() { return tables[table]?.error ?? null; },
          };
          return query;
        },
      },
      storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), download: async () => ({ data: new Uint8Array(0), error: null }) }) },
    } as unknown as AuthorizedContext['client'];

    const { review } = await submitHumanReview(auth(client), { decisionType: 'APPROVE' });
    expect(review.reviewedBy).toBe('user-1');
    const row = inserted as Record<string, unknown> | null;
    expect(row?.decision_type).toBe('APPROVE');
    expect((row?.machine_decision as { machineOutcome: string }).machineOutcome).toBe('CANCELACION_VENTA');
  });
});

describe('saveEvidenceSelection', () => {
  it('rechaza una evidencia que no pertenece a la auditoria', async () => {
    const client = mockClient({
      evidences: { data: [{ id: 'ev-1' }] },
      audit_evidence_selection: { data: [] },
    });
    await expect(saveEvidenceSelection(auth(client), [{ evidenceId: 'ev-ajena' }])).rejects.toMatchObject({
      code: 'EVIDENCE_NOT_IN_AUDIT',
    });
  });

  it('reemplaza la seleccion solo con evidencias de la auditoria', async () => {
    const tables: Record<string, { data: unknown; error?: { message: string } | null }> = {
      evidences: { data: [{ id: 'ev-1', originalFilename: 'expediente.pdf' }] },
      audit_evidence_selection: { data: [] },
    };
    const client = {
      database: {
        from(table: string) {
          const query = {
            select() { return query; },
            eq() { return query; },
            order() { return query; },
            limit() { return query; },
            single() {
              const current = tables[table]?.data;
              return { data: Array.isArray(current) ? (current as unknown[])[0] : current, error: tables[table]?.error ?? null };
            },
            insert(rows: unknown[]) { if (table === 'audit_evidence_selection') tables[table] = { data: rows, error: null }; return query; },
            update() { return query; },
            delete() { return query; },
            get data() { return tables[table]?.data ?? []; },
            get error() { return tables[table]?.error ?? null; },
          };
          return query;
        },
      },
      storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), download: async () => ({ data: new Uint8Array(0), error: null }) }) },
    } as unknown as AuthorizedContext['client'];

    const saved = await saveEvidenceSelection(auth(client), [{ evidenceId: 'ev-1', page: 3 }]);
    expect(saved).toHaveLength(1);
    expect(saved[0].page).toBe(3);
  });
});

describe('buildSnapshot', () => {
  it('falla sin engine run', async () => {
    const client = mockClient({
      engine_runs: { data: [] },
    });
    await expect(buildSnapshot(auth(client))).rejects.toMatchObject({ code: 'ENGINE_RUN_NOT_FOUND' });
  });

  it('genera un snapshot durable e idempotente por fingerprint', async () => {
    const tables: Record<string, { data: unknown; error?: { message: string } | null }> = {
      engine_runs: { data: [engineRun] },
      human_reviews: { data: [] },
      audit_manual_comments: { data: [] },
      audit_evidence_selection: { data: [] },
      report_snapshots: { data: [] },
    };
    const client = {
      database: {
        from(table: string) {
          const query = {
            select() { return query; },
            eq() { return query; },
            order() { return query; },
            limit() { return query; },
            insert(rows: unknown[]) {
              if (table === 'report_snapshots') tables[table] = { data: rows, error: null };
              return query;
            },
            update() { return query; },
            delete() { return query; },
            single() {
              const current = tables[table]?.data;
              return { data: Array.isArray(current) ? (current as unknown[])[0] : current, error: tables[table]?.error ?? null };
            },
            get data() { return tables[table]?.data ?? []; },
            get error() { return tables[table]?.error ?? null; },
          };
          return query;
        },
      },
      storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), download: async () => ({ data: new Uint8Array(0), error: null }) }) },
    } as unknown as AuthorizedContext['client'];

    const first = await buildSnapshot(auth(client));
    expect(first.created).toBe(true);
    expect(first.snapshot.snapshotFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.snapshot.status).toBe('DRAFT');

    // Idempotente: mismo fingerprint -> reutiliza el snapshot existente.
    const second = await buildSnapshot(auth(client));
    expect(second.created).toBe(false);
    expect(second.snapshot.id).toBe(first.snapshot.id);
  });
});

describe('generateFinal', () => {
  it('rechaza generar FINAL sin snapshot aprobado', async () => {
    const client = mockClient({
      report_snapshots: { data: [] },
    });
    await expect(generateFinal(auth(client))).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_FOUND' });
  });
});

describe('approveSnapshot', () => {
  it('rechaza aprobar sin snapshot', async () => {
    const client = mockClient({
      report_snapshots: { data: [] },
      human_reviews: { data: [] },
    });
    await expect(approveSnapshot(auth(client))).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_FOUND' });
  });

  it('rechaza aprobar sin revision humana registrada', async () => {
    const client = mockClient({
      report_snapshots: { data: [snapshotRow('DRAFT')] },
      human_reviews: { data: [] },
    });
    await expect(approveSnapshot(auth(client))).rejects.toMatchObject({ code: 'HUMAN_REVIEW_REQUIRED' });
  });

  it('aprueba el snapshot solo con revision humana (DRAFT -> FINAL)', async () => {
    const tables: Record<string, { data: unknown; error?: { message: string } | null }> = {
      report_snapshots: { data: [snapshotRow('DRAFT')] },
      human_reviews: { data: [humanReviewRow()] },
    };
    const client = {
      database: {
        from(table: string) {
          const query = {
            select() { return query; },
            eq() { return query; },
            order() { return query; },
            limit() { return query; },
            single() {
              const current = tables[table]?.data;
              return { data: Array.isArray(current) ? (current as unknown[])[0] : current, error: tables[table]?.error ?? null };
            },
            insert() { return query; },
            update() {
              if (table === 'report_snapshots') {
                const current = (tables[table]?.data as unknown[])[0] as Record<string, unknown>;
                tables[table] = { data: [{ ...current, status: 'FINAL', approved_by: 'user-1', approved_at: '2026-09-23T12:00:00.000Z' }], error: null };
              }
              return query;
            },
            delete() { return query; },
            get data() { return tables[table]?.data ?? []; },
            get error() { return tables[table]?.error ?? null; },
          };
          return query;
        },
      },
      storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), download: async () => ({ data: new Uint8Array(0), error: null }) }) },
    } as unknown as AuthorizedContext['client'];

    const approved = await approveSnapshot(auth(client));
    expect(approved.status).toBe('FINAL');
    expect(approved.approvedBy).toBe('user-1');
  });
});

describe('generateDraft', () => {
  it('es idempotente: reutiliza el DRAFT existente sin re-render', async () => {
    const snapshot = snapshotRow('DRAFT') as Record<string, unknown>;
    const existingDoc = dictamenDocRow();
    const tables: Record<string, { data: unknown; error?: { message: string } | null }> = {
      report_snapshots: { data: [snapshot] },
      audits: { data: [auditRow()] },
      dictamen_documents: { data: [existingDoc] },
    };
    const client = chainableClient(tables);
    const result = await generateDraft(auth(client));
    expect(result.generated).toBe(false);
    expect(result.document.id).toBe(existingDoc.id);
  });

  it('rechaza generar DRAFT sobre un snapshot aprobado (ya FINAL)', async () => {
    const client = mockClient({
      report_snapshots: { data: [snapshotRow('FINAL')] },
    });
    await expect(generateDraft(auth(client))).rejects.toMatchObject({ code: 'SNAPSHOT_ALREADY_FINAL' });
  });
});

describe('generateFinal', () => {
  it('rechaza generar FINAL si el snapshot sigue DRAFT', async () => {
    const client = mockClient({
      report_snapshots: { data: [snapshotRow('DRAFT')] },
    });
    await expect(generateFinal(auth(client))).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_APPROVED' });
  });

  it('genera FINAL idempotente desde un snapshot aprobado', async () => {
    const snapshot = snapshotRow('FINAL') as Record<string, unknown>;
    const existingDoc = dictamenDocRow('FINAL');
    const tables: Record<string, { data: unknown; error?: { message: string } | null }> = {
      report_snapshots: { data: [snapshot] },
      audits: { data: [auditRow()] },
      dictamen_documents: { data: [existingDoc] },
    };
    const client = chainableClient(tables);
    const result = await generateFinal(auth(client));
    expect(result.generated).toBe(false);
    expect(result.document.kind).toBe('FINAL');
  });
});

function chainableClient(tables: Record<string, { data: unknown; error?: { message: string } | null }>) {
  return {
    database: {
      from(table: string) {
        const query = {
          select() { return query; },
          eq() { return query; },
          order() { return query; },
          limit() { return query; },
          single() {
            const current = tables[table]?.data;
            return { data: Array.isArray(current) ? (current as unknown[])[0] : current, error: tables[table]?.error ?? null };
          },
          insert() { return query; },
          update() { return query; },
          delete() { return query; },
          get data() { return tables[table]?.data ?? []; },
          get error() { return tables[table]?.error ?? null; },
        };
        return query;
      },
    },
    storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), download: async () => ({ data: new Uint8Array(0), error: null }) }) },
  } as unknown as AuthorizedContext['client'];
}

function snapshotRow(status: 'DRAFT' | 'FINAL') {
  return {
    id: 'snap-1',
    audit_id: 'audit-1',
    fact_run_id: 'factrun-1',
    engine_run_id: 'run-1',
    policy_code: 'GDM_GAM_PRD_MLG_003',
    policy_version: '5',
    snapshot_fingerprint: 'a'.repeat(64),
    machine: { machineOutcome: 'CANCELACION_VENTA' },
    human: null,
    manual_comments: {},
    selected_evidence: [],
    template_hash: 'aaaabbbbccccdddd',
    rule_trace: { ruleIds: ['R1'] },
    status,
    approved_by: status === 'FINAL' ? 'user-1' : null,
    approved_at: status === 'FINAL' ? '2026-09-23T12:00:00.000Z' : null,
    created_by: 'user-1',
    created_at: '2026-09-23T10:00:00.000Z',
  };
}

function humanReviewRow() {
  return {
    id: 'rev-1',
    audit_id: 'audit-1',
    machine_decision: { machineOutcome: 'CANCELACION_VENTA' },
    decision_type: 'APPROVE',
    human_outcome: null,
    human_cause: null,
    human_reason: 'De acuerdo.',
    reviewed_by: 'user-1',
    reviewed_at: '2026-09-23T11:00:00.000Z',
    created_at: '2026-09-23T11:00:00.000Z',
    updated_at: '2026-09-23T11:00:00.000Z',
    updated_by: 'user-1',
  };
}

function auditRow() {
  return {
    id: 'audit-1',
    display_name: 'Expediente sintetico',
    status: 'READY',
    external_case_id: 'CASE-1',
    created_by: 'user-1',
    created_at: '2026-09-23T09:00:00.000Z',
    updated_at: '2026-09-23T09:00:00.000Z',
  };
}

function dictamenDocRow(kind: 'DRAFT' | 'FINAL' = 'DRAFT') {
  return {
    id: `doc-${kind.toLowerCase()}`,
    snapshot_id: 'snap-1',
    audit_id: 'audit-1',
    kind,
    doc_fingerprint: 'b'.repeat(64),
    pdf_sha256: 'c'.repeat(64),
    storage_bucket: 'dictamen-reportes',
    storage_key: `dictamen/audit-1/snap-1/${kind.toLowerCase()}.pdf`,
    template_hash: 'aaaabbbbccccdddd',
    generated_by: 'user-1',
    generated_at: '2026-09-23T12:00:00.000Z',
    created_at: '2026-09-23T12:00:00.000Z',
  };
}