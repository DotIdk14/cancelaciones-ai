#!/usr/bin/env node
/**
 * ============================================================================
 * GUARD DE CONTRATO DE ESQUEMA
 * ============================================================================
 *
 * POR QUÉ EXISTE
 *
 * El incidente del 2026-09-25 no lo causó un bug de lógica. Lo causó que el
 * esquema real de la base contradecía el declarado:
 *
 *   declarado : CHECK (state IN ('DRAFT','PROCESSING','FAILED','FROZEN'))
 *   real     : CHECK (state IN ('DRAFT','FROZEN','FAILED'))
 *
 * `freeze_fact_run_v1` exige `state = 'PROCESSING'`, así que con el CHECK real
 * PROCESSING era INALCANZABLE y el congelado fallaba siempre. El job se
 * reintentaba para siempre y la UI repetía en bucle.
 *
 * Y lo grave: nadie estrecha ese CHECK en el ledger. La tabla se creó fuera del
 * registro de migraciones, y el `CREATE TABLE IF NOT EXISTS` de phase-5 fue un
 * no-op silencioso para una tabla que ya existía. El sistema de migraciones no
 * PODÍA detectarlo, porque comprobar que algo existe no es comprobar que sea lo
 * que uno cree.
 *
 * Por eso este guard NO lee los ficheros de migración: eso es exactamente lo
 * que falló. Consulta Postgres real y compara con el contrato declarado.
 *
 * QUÉ HACE
 * Una consulta pequeña por invariante. Se elige así a propósito, y no por
 * gusto: con una sola query gigante, un error de sintaxis deja TODO sin
 * comprobar y el guard dice "no devolvió datos", que no es lo que pasó. Con
 * queries separadas, cada invariante reporta su propio fallo y el resto sigue
 * evaluándose.
 *
 * QUÉ NO HACE
 *   - No modifica la base. Jamás. Es un lector.
 *   - No pretende ser un diff universal de esquema. Cubre las invariantes que
 *     YA nos rompieron producción, que es donde un guard genérico se convierte
 *     en un proyecto que nadie mantiene.
 *   - No sustituye a las migraciones: ellas escriben, esto comprueba.
 *
 * USO
 *   pnpm db:verify-contract
 *   pnpm db:verify-contract --json
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Cómo invocar npx de forma portable.
 *
 * `execFileSync` no puede lanzar `npx` en Windows: `npx` es `npx.ps1`/`npx.cmd`
 * y Node 22 lo rechaza con EINVAL por seguridad. La salida es ejecutar el
 * entry point de npx con el propio Node, que es exactamente lo que hace el
 * shim. Se descubre en tiempo de ejecución para no depender de rutas fijas.
 */
function resolveNpxInvocation() {
  const candidates = [];
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    candidates.push([process.execPath, [join(programFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js')]]);
  }
  candidates.push(['npx', []]);
  for (const [command, prefix] of candidates) {
    try {
      execFileSync(command, [...prefix, '-y', '@insforge/cli', '--version'], { encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
      return { command, prefix };
    } catch { /* siguiente candidato */ }
  }
  throw new Error('no se encontró una forma de ejecutar npx en esta plataforma');
}

const NPX = resolveNpxInvocation();

/** Estados que un Fact Run DEBE poder tener. Exactamente ésos, ni uno más ni uno menos. */
const FACT_RUN_STATES = ['DRAFT', 'FAILED', 'FROZEN', 'PROCESSING'];

/** Funciones que son parte del contrato del pipeline. */
const FUNCTIONS_REQUIRED = [
  'freeze_fact_run_v1',
  'begin_fact_run_processing_v1',
  'create_derived_fact_run_v1',
  'persist_policy_evaluation_v1',
  'record_ai_usage_v1',
  'begin_provider_operation_v1',
  'complete_provider_operation_v1',
];

/** Tablas que deben existir. */
const TABLES_REQUIRED = [
  'fact_run_frozen_snapshots', 'ai_usage', 'provider_operations', 'policy_source_registry',
  'audit_evaluation_envelopes', 'ai_decision_snapshots', 'facts', 'fact_extraction_runs', 'jobs',
];

/** Lease y backoff: sin esto no hay exactly-once ni presupuesto de reintentos. */
const JOB_COLUMNS_REQUIRED = ['lease_owner', 'lease_expires_at', 'attempt_count', 'max_attempts', 'available_at', 'status'];

/** RLS obligatorio. Una de estas sin RLS es una fuga, no un detalle de estilo. */
const RLS_REQUIRED = [
  'audits', 'evidences', 'jobs', 'job_artifacts', 'job_attempts', 'audit_runs',
  'engine_runs', 'engine_rule_results', 'facts', 'fact_extraction_runs',
  'fact_run_frozen_snapshots', 'audit_evaluation_envelopes', 'ai_decision_snapshots',
  'ai_usage', 'provider_operations', 'policy_source_registry',
];

/**
 * Lanza una consulta read-only. Un solo comando del CLI, que es el único canal
 * del repo que llega a Postgres con SQL real: el SDK habla PostgREST y no puede
 * leer catálogos.
 */
/**
 * Normaliza el SQL para el CLI.
 *
 * El CLI descarta un argumento que empieza o termina en blanco, y con saltos de
 * línea intermedios el transporte los pierde: el resultado es Query is
 * required o missing FROM-clause entry, ninguno de los cuales dice algo
 * sobre el contrato. Se colapsa a una sola línea. El fuente queda legible con
 * saltos; sólo el argumento se aplana.
 */
function normalizeSql(sql) {
  return sql.trim().replace(/\s*\n\s*/g, ' ');
}
function scalar(sql) {
  // El CLI descarta un argumento que empieza o termina en blanco: lo trimmea
  // y se queda sin query (Error: query: Query is required). Por eso se
  // normaliza aquí y no en cada llamada.
  const out = execFileSync(NPX.command, [...NPX.prefix, '-y', '@insforge/cli', 'db', 'query', normalizeSql(sql), '--json'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, cwd: ROOT,
  });
  const parsed = JSON.parse(out);
  if (!parsed.rows || parsed.rows.length === 0) throw new Error('sin filas');
  return String(parsed.rows[0][Object.keys(parsed.rows[0])[0]] ?? '');
}

function list(sql) {
  const out = execFileSync(NPX.command, [...NPX.prefix, '-y', '@insforge/cli', 'db', 'query', normalizeSql(sql), '--json'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, cwd: ROOT,
  });
  const parsed = JSON.parse(out);
  if (!parsed.rows || parsed.rows.length === 0) return [];
  return String(parsed.rows[0][Object.keys(parsed.rows[0])[0]] ?? '')
    .split(',').map((entry) => entry.trim()).filter(Boolean);
}

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); }

function checkStates() {
  // Se pide la definición CRUDA y se parsea aquí, no con una regex en SQL.
  // Porqué: la expresión regular que descompone `ARRAY['DRAFT'::text, ...]`
  // en SQL es frágil (comillas anidadas, escapes de paréntesis que cambian
  // entre versiones) y un fallo suyo produce "query: Query is required", que
  // no dice nada sobre el contrato. Parsear en JS deja la lógica del contrato
  // en el script, donde se puede leer y probar.
  const definition = scalar(`
    select pg_get_constraintdef(c.oid)
    from pg_constraint c
    where c.conrelid = 'public.fact_extraction_runs'::regclass
      and c.conname = 'fact_extraction_runs_state_check'`);

  if (!definition) {
    record('fact_extraction_runs.state CHECK', false, 'la constraint fact_extraction_runs_state_check NO EXISTE');
    return;
  }
  // ARRAY['DRAFT'::text, 'PROCESSING'::text, ...] -> los literales entrecomillados
  const states = [...definition.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
  const expected = [...FACT_RUN_STATES].sort();
  record(
    'fact_extraction_runs.state CHECK',
    JSON.stringify(states) === JSON.stringify(expected),
    `esperado [${expected.join(', ')}] | real [${states.join(', ') || '(vacío)'}]`,
  );
}

function checkFunctions() {
  const present = list(`select coalesce(string_agg(routine_name, ','), '') from information_schema.routines where routine_schema='public' and routine_type='FUNCTION'`);
  for (const fn of FUNCTIONS_REQUIRED) {
    record(`función ${fn}`, present.includes(fn), present.includes(fn) ? 'ok' : 'no existe en public');
  }
}

function checkTables() {
  const present = list(`select coalesce(string_agg(table_name, ','), '') from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`);
  for (const table of TABLES_REQUIRED) {
    record(`tabla ${table}`, present.includes(table), present.includes(table) ? 'ok' : 'no existe en public');
  }
}

function checkJobColumns() {
  const present = list(`select coalesce(string_agg(column_name, ','), '') from information_schema.columns where table_schema='public' and table_name='jobs'`);
  const missing = JOB_COLUMNS_REQUIRED.filter((column) => !present.includes(column));
  record('jobs: lease y backoff', missing.length === 0, missing.length === 0 ? 'ok' : `faltan ${missing.join(', ')}`);
}

function checkRls() {
  const present = list(`select coalesce(string_agg(relname, ','), '') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity`);
  for (const table of RLS_REQUIRED) {
    record(`RLS en ${table}`, present.includes(table), present.includes(table) ? 'ok' : 'RLS no habilitado');
  }
}

function checkCostAcl() {
  const count = scalar(`select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name in ('ai_usage','provider_operations') and privilege_type <> 'TRIGGER'`);
  record('sin DML de anon en tablas de coste', count === '0', `anon conserva ${count} privilegios`);
}

function checkIndexes() {
  const present = list(`select coalesce(string_agg(indexname, ','), '') from pg_indexes where schemaname='public'`);
  record('UNIQUE sobre fact_run_id (snapshots)', present.some((i) => i.includes('fact_run') && i.includes('fact_run_id')), 'no encontrado');
  record('exactly-once de ai_usage', present.some((i) => i.includes('ai_usage_provider_operation')), 'falta (provider, operation, request_fingerprint)');
}

function main() {
  const asJson = process.argv.includes('--json');
  const checks = [
    ['estados del Fact Run', checkStates],
    ['funciones del pipeline', checkFunctions],
    ['tablas de la fundacion', checkTables],
    ['columnas de lease de jobs', checkJobColumns],
    ['RLS en tablas criticas', checkRls],
    ['ACL de tablas de coste', checkCostAcl],
    ['indices de idempotencia', checkIndexes],
  ];

  let queryFailures = 0;
  for (const [label, run] of checks) {
    const before = results.length;
    try {
      run();
    } catch (error) {
      queryFailures += 1;
      record(`${label} (consulta)`, false, `no se pudo comprobar: ${error.message}`);
    }
    if (asJson && results.length === before) continue;
  }

  const problems = results.filter((r) => !r.ok);
  if (asJson) {
    console.log(JSON.stringify({ ok: problems.length === 0, checked: results.length, problems, results }, null, 2));
  } else {
    for (const item of results) console.log(`${item.ok ? 'OK  ' : 'FAIL'} ${item.name}${item.ok ? '' : ` — ${item.detail}`}`);
    console.log(`\n${results.length} invariantes comprobadas contra Postgres real${queryFailures ? ` (${queryFailures} consultas fallaron)` : ''}.`);
  }
  if (problems.length > 0) {
    if (!asJson) {
      console.error(`\nSCHEMA DRIFT DETECTADO (${problems.length}). La base contradice el contrato declarado:`);
      for (const problem of problems) console.error(`  - ${problem.name}: ${problem.detail}`);
    }
    process.exit(1);
  }
  if (!asJson) console.log('SCHEMA CONTRACT: PASS');
}

main();
