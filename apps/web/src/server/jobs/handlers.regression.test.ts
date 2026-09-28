import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { sha256Hex } from '@cancelaciones/shared';
import type { ClaimedJob, DatabaseClient } from '@cancelaciones/db';
import { createFakeDatabase, type FakeDatabase, type FakeRow } from '../../../../../packages/db/src/testing/fake-db';

/**
 * `env` es una frontera externa (variables de entorno), no parte del runtime que
 * se quiere probar. Se sustituye por un env válido y explícito para que el test
 * no dependa de lo que haya en la máquina ni sangre la clave real a ningún log.
 */
vi.mock('@/server/config/env', () => {
  const ai = {
    NEXT_PUBLIC_INSFORGE_URL: 'https://db.test',
    NEXT_PUBLIC_INSFORGE_ANON_KEY: 'anon',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    INSFORGE_API_KEY: 'service',
    OPENROUTER_API_KEY: 'openrouter-test',
    OPENROUTER_FAST_MODEL: 'fast',
    OPENROUTER_ANALYST_MODEL: 'analyst',
    OPENROUTER_REVIEWER_MODEL: 'reviewer',
    OPENROUTER_VISION_MODEL: 'vision',
  };
  return { getAiEnv: () => ai, getInsForgeEnv: () => ai, getServerEnv: () => ai };
});

const { executeClaimedJob } = await import('./handlers');

const NOW = '2026-01-01T00:00:00.000Z';

type RpcCall = { name: string; args: Record<string, unknown> };

function auditRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'audit_1',
    status: 'DRAFT',
    external_case_id: 'CAVE-1',
    created_by: 'user_1',
    display_name: 'Caso de prueba',
    class_start_date: '2026-01-05',
    ticket_start_at: '2026-01-06',
    student_name: 'Estudiante',
    student_enrollment: 'ENR-1',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function evidenceRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'ev-1',
    audit_id: 'audit_1',
    nombre_archivo: 'captura.png',
    tipo: 'image/png',
    kind: 'IMAGE',
    storage_bucket: 'dictamen-evidencias',
    storage_key: 'audit_1/ev_1/captura.png',
    storage_url: null,
    mime_type: 'image/png',
    detected_mime_type: 'image/png',
    size_bytes: 8,
    sha256: 'a'.repeat(64),
    original_filename: 'captura.png',
    safe_filename: 'captura.png',
    status: 'STORED',
    content_status: 'PENDING',
    content_error: null,
    uploaded_by: 'user_1',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function runRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'run_1',
    audit_id: 'audit_1',
    run_number: 1,
    status: 'CREATED',
    evidence_fingerprint: 'f'.repeat(64),
    policy_code: 'GDM_GAM_PRD_MLG_003',
    policy_version: '5',
    policy_source_sha256: null,
    analyst_model: 'analyst',
    analyst_prompt_version: 'ai-native-v1',
    reviewer_model: 'reviewer',
    reviewer_prompt_version: 'ai-native-v1',
    policy_sections_consulted: [],
    tool_call_count: 0,
    agent_step_count: 0,
    error_code: null,
    error_message: null,
    created_by: 'user_1',
    created_at: NOW,
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

function jobRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'job_evidence',
    audit_id: 'audit_1',
    job_type: 'EVIDENCE_PROCESSING',
    operation_scope: 'evidence:ev-1',
    idempotency_key: 'evidence:ev-1',
    input_fingerprint: 'b'.repeat(64),
    payload: {},
    evidence_id: 'ev-1',
    status: 'RUNNING',
    progress: 0,
    attempt_count: 1,
    max_attempts: 3,
    last_error_code: null,
    last_error_message_sanitized: null,
    available_at: NOW,
    created_at: NOW,
    started_at: NOW,
    finished_at: null,
    timeout_at: null,
    ...overrides,
  };
}

const CONTENT_TEXT = 'Solicito la cancelacion de la venta del periodo 2026-1.';

function artifactRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'art_1',
    job_id: 'job_evidence',
    evidence_id: 'ev-1',
    artifact_type: 'evidence-content',
    result: { evidenceId: 'ev-1', kind: 'IMAGE', status: 'READY', text: CONTENT_TEXT, audio: null, pages: 0, error: null, aiCall: null },
    content_sha256: sha256Hex(CONTENT_TEXT),
    extractor_version: 'ai-native-evidence-v1',
    provider: 'deterministic',
    created_at: NOW,
    ...overrides,
  };
}

/** Base en memoria con las RPC de jobs registradas y registradas para inspección. */
function setupDatabase(tables: Record<string, FakeRow[]> = {}): { database: FakeDatabase; rpcs: RpcCall[] } {
  const database = createFakeDatabase({ tables });
  const rpcs: RpcCall[] = [];
  const noop = { ...jobRow() };
  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    enqueue_job: () => noop,
    claim_next_job: () => null,
    complete_job: () => ({ ...noop, status: 'SUCCEEDED' }),
    schedule_job_retry: () => ({ ...noop, status: 'QUEUED' }),
    fail_job_permanent: () => ({ ...noop, status: 'FAILED' }),
    record_job_artifact: () => ({ id: 'art_generated' }),
  };
  for (const [name, handler] of Object.entries(handlers)) {
    database.registerRpc(name, (args) => {
      rpcs.push({ name, args });
      return handler(args);
    });
  }
  return { database, rpcs };
}

function memoryStorage(files: Record<string, Uint8Array>) {
  const downloads: string[] = [];
  return {
    downloads,
    storage: {
      from(bucket: string) {
        return {
          async download(key: string) {
            downloads.push(`${bucket}/${key}`);
            const bytes = files[`${bucket}/${key}`];
            if (!bytes) return { data: null, error: { message: `no such key ${key}` } };
            return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
          },
          async upload() {
            return { error: null };
          },
        };
      },
    },
  };
}

function claimed(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: 'job_1',
    attemptNumber: 1,
    auditId: 'audit_1',
    jobType: 'EVIDENCE_PROCESSING',
    payload: {},
    evidenceId: null,
    attemptCount: 0,
    maxAttempts: 3,
    timeoutAt: null,
    ...overrides,
  };
}

const contextFor = (database: DatabaseClient, storage?: ReturnType<typeof memoryStorage>['storage']) => ({
  database,
  storage,
  workerId: 'worker_1',
});

const rpcNames = (rpcs: RpcCall[]) => rpcs.map((call) => call.name);
const findRpc = (rpcs: RpcCall[], name: string) => rpcs.find((call) => call.name === name);

function aiCallRows(database: FakeDatabase): FakeRow[] {
  return database.rows('ai_call_log');
}

afterEach(() => {
  delete process.env.LOCAL_DEMO;
});

describe('executeClaimedJob: tipos de job que no existen', () => {
  test('un job desconocido se cierra con UNSUPPORTED_JOB_TYPE y sin escribir nada', async () => {
    const { database, rpcs } = setupDatabase();

    await executeClaimedJob(contextFor(database), claimed({ jobType: 'NO_EXISTE' as ClaimedJob['jobType'] }));

    const failure = findRpc(rpcs, 'fail_job_permanent');
    expect(failure?.args.p_job_id).toBe('job_1');
    expect(failure?.args.p_worker_id).toBe('worker_1');
    expect(failure?.args.p_error_code).toBe('UNSUPPORTED_JOB_TYPE');
    // Reintentar un tipo desconocido no lo va a hacer existir.
    expect(rpcNames(rpcs)).not.toContain('schedule_job_retry');
    expect(rpcNames(rpcs)).not.toContain('complete_job');
    expect(rpcNames(rpcs)).not.toContain('record_job_artifact');
  });
});

describe('executeClaimedJob: AUDIO_TRANSCRIPTION sin proveedor de transcripción', () => {
  test('falla el job y NO deja ningún artefacto de transcripción en su lugar', async () => {
    const { database, rpcs } = setupDatabase({ evidences: [evidenceRow({ kind: 'AUDIO', content_status: 'WAITING_EXTERNAL' })] });

    await executeClaimedJob(
      contextFor(database),
      claimed({
        jobType: 'AUDIO_TRANSCRIPTION',
        evidenceId: 'ev-1',
        payload: { evidenceId: 'ev-1', assemblyId: 'asm_1' },
        attemptCount: 0,
        maxAttempts: 1,
      }),
    );

    const failure = findRpc(rpcs, 'fail_job_permanent');
    expect(failure?.args.p_error_code).toBe('JOB_FAILED');
    expect(String(failure?.args.p_error_message_sanitized)).toContain('AUDIO_PROVIDER_MISSING');
    // Regresión: si el handler escribiera un artefacto "placeholder", el
    // webhook vería una transcripción registrada que en realidad no existe y
    // marcaría la evidencia como leída.
    expect(rpcNames(rpcs)).not.toContain('record_job_artifact');
    expect(rpcNames(rpcs)).not.toContain('enqueue_job');
    expect(rpcNames(rpcs)).not.toContain('complete_job');
  });

  test('con intentos disponibles pide reintento en vez de declarar el caso perdido', async () => {
    const { database, rpcs } = setupDatabase();

    await executeClaimedJob(
      contextFor(database),
      claimed({ jobType: 'AUDIO_TRANSCRIPTION', evidenceId: 'ev-1', payload: { evidenceId: 'ev-1', assemblyId: 'asm_1' }, attemptCount: 0, maxAttempts: 3 }),
    );

    const retry = findRpc(rpcs, 'schedule_job_retry');
    expect(retry?.args.p_error_code).toBe('JOB_RETRY');
    expect(retry?.args.p_attempt_number).toBeUndefined();
    expect(rpcNames(rpcs)).not.toContain('record_job_artifact');
    expect(rpcNames(rpcs)).not.toContain('fail_job_permanent');
  });

  test('un payload sin assemblyId se rechaza sin tocar nada', async () => {
    const { database, rpcs } = setupDatabase();

    await executeClaimedJob(contextFor(database), claimed({ jobType: 'AUDIO_TRANSCRIPTION', evidenceId: 'ev-1', payload: { evidenceId: 'ev-1' }, maxAttempts: 1 }));

    const failure = findRpc(rpcs, 'fail_job_permanent');
    expect(String(failure?.args.p_error_message_sanitized)).toContain('AUDIO_TRANSCRIPTION_PAYLOAD_INVALID');
    expect(rpcNames(rpcs)).not.toContain('record_job_artifact');
  });

  test('el mensaje de error se acota para no meter una traza entera en la base', async () => {
    const { database, rpcs } = setupDatabase();

    await executeClaimedJob(contextFor(database), claimed({ jobType: 'AUDIO_TRANSCRIPTION', evidenceId: 'ev-1', payload: { evidenceId: 'ev-1' }, maxAttempts: 1 }));

    const message = String(findRpc(rpcs, 'fail_job_permanent')?.args.p_error_message_sanitized);
    expect(message.length).toBeLessThanOrEqual(500);
  });
});

describe('executeClaimedJob: EVIDENCE_PROCESSING con almacenamiento en memoria', () => {
  beforeEach(() => {
    // LOCAL_DEMO cambia la frontera del proveedor, no el runtime: el doble de
    // `createFakeAiProvider` es el único camino sin red hacia el mismo código.
    process.env.LOCAL_DEMO = '1';
  });

  test('una imagen queda lista, se marca la evidencia y se guarda el artefacto con su coste', async () => {
    const { database, rpcs } = setupDatabase({ evidences: [evidenceRow()] });
    const store = memoryStorage({ 'dictamen-evidencias/audit_1/ev_1/captura.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) });

    await executeClaimedJob(
      contextFor(database, store.storage),
      claimed({ jobType: 'EVIDENCE_PROCESSING', evidenceId: 'ev-1', payload: { evidenceId: 'ev-1' } }),
    );

    expect(store.downloads).toEqual(['dictamen-evidencias/audit_1/ev_1/captura.png']);
    const evidence = database.rows('evidences')[0]!;
    expect(evidence.content_status).toBe('READY');
    expect(evidence.content_error).toBeNull();

    const artifact = findRpc(rpcs, 'record_job_artifact');
    expect(artifact?.args.p_artifact_type).toBe('evidence-content');
    const result = artifact?.args.p_result as { status: string; text: string; kind: string };
    expect(result.status).toBe('READY');
    expect(result.kind).toBe('IMAGE');
    expect(result.text.length).toBeGreaterThan(0);
    expect(artifact?.args.p_evidence_id).toBe('ev-1');
    expect(artifact?.args.p_content_sha256).toBe(sha256Hex(result.text));
    expect(artifact?.args.p_extractor_version).toBe('ai-native-evidence-v1');
    // El coste de la visión queda en el log de llamadas, no solo en el artefacto.
    expect(aiCallRows(database).map((row) => row.purpose)).toEqual(['vision']);
    expect(findRpc(rpcs, 'complete_job')?.args.p_progress).toBe(100);
    expect(rpcNames(rpcs)).not.toContain('enqueue_job');
  });

  test('un audio sin proveedor deja la evidencia FAILED y solo pide la transcripción', async () => {
    const { database, rpcs } = setupDatabase({
      evidences: [evidenceRow({ kind: 'AUDIO', detected_mime_type: 'audio/mpeg', mime_type: 'audio/mpeg', storage_key: 'audit_1/ev_1/entrevista.mp3', safe_filename: 'entrevista.mp3', original_filename: 'entrevista.mp3' })],
    });
    const store = memoryStorage({ 'dictamen-evidencias/audit_1/ev_1/entrevista.mp3': Uint8Array.from([0x49, 0x44, 0x33]) });

    await executeClaimedJob(
      contextFor(database, store.storage),
      claimed({ jobType: 'EVIDENCE_PROCESSING', evidenceId: 'ev-1', payload: { evidenceId: 'ev-1' } }),
    );

    const artifact = findRpc(rpcs, 'record_job_artifact');
    // El nombre del artefacto dice qué pasó: una solicitud de transcripción, no
    // una transcripción. Un "placeholder" sería indistinguible de la real.
    expect(artifact?.args.p_artifact_type).toBe('audio-transcription-request');
    expect(String((artifact?.args.p_result as { error: { code: string } }).error.code)).toBe('AUDIO_PROVIDER_MISSING');
    expect(database.rows('evidences')[0]!.content_status).toBe('FAILED');
    // La columna durable guarda el mensaje legible por el usuario; el código
    // estable queda en el artefacto, que es lo que se lee desde el job.
    expect(String(database.rows('evidences')[0]!.content_error)).toContain('proveedor de transcripción');
    // Sin assemblyId no hay nada que transcribir: no se encola un job imposible.
    expect(rpcNames(rpcs)).not.toContain('enqueue_job');
    expect(aiCallRows(database)).toHaveLength(0);
  });

  test('una evidencia que no está STORED falla el job sin escribir artefactos', async () => {
    const { database, rpcs } = setupDatabase({ evidences: [evidenceRow({ status: 'PENDING' })] });
    const store = memoryStorage({});

    await executeClaimedJob(
      contextFor(database, store.storage),
      claimed({ jobType: 'EVIDENCE_PROCESSING', evidenceId: 'ev-1', payload: { evidenceId: 'ev-1' }, maxAttempts: 1 }),
    );

    expect(String(findRpc(rpcs, 'fail_job_permanent')?.args.p_error_message_sanitized)).toContain('EVIDENCE_NOT_FOUND');
    expect(store.downloads).toEqual([]);
    expect(rpcNames(rpcs)).not.toContain('record_job_artifact');
  });
});

describe('executeClaimedJob: AUDIT_RUN de punta a punta', () => {
  beforeEach(() => {
    process.env.LOCAL_DEMO = '1';
  });

  const evidenceReady = [evidenceRow({ content_status: 'READY' })];

  test('deja run, dictamen, traza de tools y coste coherentes entre sí', async () => {
    const { database, rpcs } = setupDatabase({
      audits: [auditRow()],
      evidences: evidenceReady,
      jobs: [jobRow()],
      job_artifacts: [artifactRow()],
    });
    const store = memoryStorage({});

    await executeClaimedJob(
      contextFor(database, store.storage),
      claimed({ jobType: 'AUDIT_RUN', payload: {} }),
    );

    const run = database.rows('audit_runs')[0]!;
    expect(run.status).toBe('NEEDS_INPUT');
    // El run registra el modelo que el agente usó de verdad, no una etiqueta fija:
    // sin esto la traza no sirve para saber con qué se dictaminó.
    expect(run.analyst_model).toBe('fake-analyst');
    expect(run.reviewer_model).toBe('fake-reviewer');
    expect(run.agent_step_count).toBe(2);
    expect(run.tool_call_count).toBe(3);
    expect(run.finished_at).not.toBeNull();
    expect(database.rows('audits')[0]!.status).toBe('NEEDS_INPUT');

    // Un único resultado por run, en estado terminal y con el veredicto del revisor.
    const results = database.rows('audit_results');
    expect(results).toHaveLength(1);
    expect(results[0]!.stage).toBe('FINAL');
    expect(results[0]!.status).toBe('NEEDS_INPUT');
    expect((results[0]!.review as { verdict: string }).verdict).toBe('CONFIRMED');

    // Traza durable: las tres tools que el agente ejecutó, todas cerradas bien.
    const tools = database.rows('tool_executions');
    expect(tools.map((tool) => tool.name)).toEqual(['listEvidence', 'readEvidence', 'submitAssessment']);
    expect(tools.map((tool) => tool.status)).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);
    expect(tools.every((tool) => tool.run_id === run.id)).toBe(true);
    expect(new Set(tools.map((tool) => tool.idempotency_key)).size).toBe(3);

    // El texto de la evidencia llegó al agente por el artefacto, no por la fila.
    const purposes = aiCallRows(database).map((row) => String(row.purpose));
    expect(purposes.filter((purpose) => purpose === 'case-analyst')).toHaveLength(2);
    expect(purposes.filter((purpose) => purpose === 'audit-reviewer')).toHaveLength(1);

    expect(findRpc(rpcs, 'complete_job')?.args.p_job_id).toBe('job_1');
    expect(rpcNames(rpcs)).not.toContain('fail_job_permanent');
  });

  test('mientras haya evidencia pendiente no se llama al modelo', async () => {
    const { database, rpcs } = setupDatabase({
      audits: [auditRow()],
      evidences: [evidenceRow({ content_status: 'PENDING' })],
      jobs: [jobRow()],
      job_artifacts: [],
    });

    await executeClaimedJob(contextFor(database, memoryStorage({}).storage), claimed({ jobType: 'AUDIT_RUN', payload: {} }));

    const retry = findRpc(rpcs, 'schedule_job_retry');
    expect(retry?.args.p_error_code).toBe('WAITING_FOR_EVIDENCE');
    expect(retry?.args.p_delay_seconds).toBe(30);
    expect(database.rows('tool_executions')).toHaveLength(0);
    expect(database.rows('audit_results')).toHaveLength(0);
    expect(database.rows('audit_runs')[0]!.status).toBe('PROCESSING_EVIDENCE');
  });

  test('reprocesar un run ya terminal no reescribe el dictamen guardado', async () => {
    const dictamenPrevio = {
      id: 'res_1',
      audit_id: 'audit_1',
      run_id: 'run_1',
      stage: 'FINAL',
      status: 'COMPLETED',
      classification: 'CANCELACION_VENTA',
      summary: 'Dictamen ya emitido.',
      assessment: { status: 'COMPLETED' },
      review: { verdict: 'CONFIRMED' },
      created_at: NOW,
    };
    const { database, rpcs } = setupDatabase({
      audits: [auditRow({ status: 'COMPLETED' })],
      evidences: [evidenceRow({ content_status: 'READY' })],
      jobs: [jobRow()],
      job_artifacts: [artifactRow()],
      audit_runs: [runRow({ status: 'COMPLETED' })],
      audit_results: [dictamenPrevio],
    });

    await executeClaimedJob(
      contextFor(database, memoryStorage({}).storage),
      claimed({ jobType: 'AUDIT_RUN', payload: { runId: 'run_1' }, maxAttempts: 1 }),
    );

    // Un run terminal no se reescribe y su dictamen tampoco: si el reproceso
    // pasara, el caso tendría dos veredictos y el reportador no sabría cuál.
    expect(String(findRpc(rpcs, 'fail_job_permanent')?.args.p_error_message_sanitized)).toContain('estado terminal');
    expect(database.rows('audit_results')).toEqual([dictamenPrevio]);
    expect(database.rows('audit_runs')[0]!.status).toBe('COMPLETED');
    expect(database.rows('tool_executions')).toHaveLength(0);
  });
});

describe('executeClaimedJob: fallo a mitad del AUDIT_RUN', () => {
  beforeEach(() => {
    process.env.LOCAL_DEMO = '1';
  });

  const tables = () => ({
    audits: [auditRow({ status: 'PROCESSING' })],
    evidences: [evidenceRow({ content_status: 'READY' })],
    jobs: [jobRow()],
    job_artifacts: [artifactRow()],
    audit_runs: [runRow({ status: 'CREATED' })],
  });

  test('en el último intento el run, la auditoría y el job quedan FAILED, no RUNNING', async () => {
    const { database, rpcs } = setupDatabase(tables());
    // La traza de tools no arranca: es un fallo de infraestructura en pleno
    // análisis, el peor momento para dejar el run colgando.
    database.failTable('tool_executions', 'tool_executions no disponible');

    await executeClaimedJob(
      contextFor(database, memoryStorage({}).storage),
      claimed({ jobType: 'AUDIT_RUN', payload: { runId: 'run_1' }, attemptCount: 2, maxAttempts: 3 }),
    );

    const run = database.rows('audit_runs')[0]!;
    expect(run.status).toBe('FAILED');
    expect(run.error_code).toBe('JOB_FAILED');
    expect(String(run.error_message)).toContain('TOOL_EXECUTION_FAILED');
    expect(run.finished_at).not.toBeNull();
    expect(database.rows('audits')[0]!.status).toBe('FAILED');
    expect(findRpc(rpcs, 'fail_job_permanent')?.args.p_error_code).toBe('JOB_FAILED');
    expect(database.rows('audit_results')).toHaveLength(0);
  });

  test('con intentos disponibles se reintenta sin marcar el run como fallido', async () => {
    const { database, rpcs } = setupDatabase(tables());
    database.failTable('tool_executions', 'tool_executions no disponible');

    await executeClaimedJob(
      contextFor(database, memoryStorage({}).storage),
      claimed({ jobType: 'AUDIT_RUN', payload: { runId: 'run_1' }, attemptCount: 0, maxAttempts: 3 }),
    );

    const retry = findRpc(rpcs, 'schedule_job_retry');
    expect(retry?.args.p_error_code).toBe('JOB_RETRY');
    const run = database.rows('audit_runs')[0]!;
    // Un reintento que dejara el run en FAILED no podría reintentarse: el run
    // terminal no se reescribe y el segundo intento moriría en la transición.
    expect(run.status).toBe('ANALYZING');
    expect(run.error_code).toBeNull();
    expect(database.rows('audits')[0]!.status).toBe('PROCESSING');
    expect(rpcNames(rpcs)).not.toContain('fail_job_permanent');
  });

  test('una auditoría inexistente no se procesa', async () => {
    const { database, rpcs } = setupDatabase({ audits: [], evidences: [], jobs: [], job_artifacts: [] });

    await executeClaimedJob(
      contextFor(database, memoryStorage({}).storage),
      claimed({ jobType: 'AUDIT_RUN', payload: { runId: 'run_1' }, maxAttempts: 1 }),
    );

    expect(String(findRpc(rpcs, 'fail_job_permanent')?.args.p_error_message_sanitized)).toContain('AUDIT_NOT_FOUND');
    expect(database.rows('audit_results')).toHaveLength(0);
  });
});
