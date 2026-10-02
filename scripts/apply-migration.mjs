// =============================================================================
// Aplica una migración de InsForge sentencia por sentencia.
//
// POR QUÉ EXISTE ESTE SCRIPT Y NO UN `npm run db:migrate`:
//
// El CLI tiene el flujo canónico (`db migrations up`), pero en este repositorio
// está bloqueado por un problema PREEXISTENTE y ajeno a este trabajo:
//
//   El `migrations/00000000000000_baseline.sql` local nunca se aplicó por la CLI.
//   La base real se construyó con las migraciones `phase-*` (que crearon ~90
//   tablas), no con el baseline de 3 tablas que describe AGENTS.md. Como el
//   baseline local es más ANTIGUO que el head remoto y no está registrado como
//   aplicado, el CLI aborta con:
//
//     "Migration 00000000000000_baseline.sql is older than the current remote
//      head (20260929040000) and is not applied remotely."
//
// Ni `up --all` ni `up --to <archivo>` lo evitan: ambos validan la cadena local
// completa antes de aplicar nada. Reconciliar con `db migrations fetch` resolvería
// el aviso, pero REESCRIBE el directorio `migrations/` y puede eliminar el
// `baseline.sql` que documentan README.md y AGENTS.md, con riesgo de colisión
// con otra sesión de trabajo. Es una decisión que corresponde a quien mantiene el
// repositorio, no a una tarea de dashboard.
//
// Y `db query` no acepta el bloque `DO $verify$` de una migración (lo rechaza
// como "no parseable por motivos de seguridad"), así que ni siquiera por esa vía
// se ejecuta la verificación.
//
// QUÉ HACE ESTO, por tanto:
//   1. Divide el archivo en sentencias y las ejecuta con `db query`, que sí
//      acepta DDL. Todas las sentencias de una migración de este repositorio son
//      idempotentes (`IF NOT EXISTS`, `CREATE OR REPLACE`, `REVOKE`/`GRANT`), así
//      que repetirlas no hace daño.
//   2. Ejecuta la verificación como CONSULTAS SELECT equivalentes, que es lo
//      único que `db query` permite. Mismas comprobaciones, mismos fallos.
//
// LO QUE NO HACE, y hay que saberlo:
//   - NO registra la migración en `system.migrations`. Eso lo hace la CLI, y su
//     tabla es un esquema gestionado de InsForge. Escribir en ella a mano sería
//     saltarse el control de concurrencia del CLI y dejar el estado peor que
//     antes. Consecuencia: `db migrations list` seguirá sin mostrar esta
//     migración, y `up --all` seguirá bloqueado por el mismo problema preexistente
//     que ya lo bloqueaba antes de este trabajo.
//   - NO sustituye al CLI. Cuando el `baseline.sql` se reconcile, esta migración
//     se puede volver a aplicar por la vía normal sin efecto duplicado, porque
//     todo su DDL es idempotente.
//
// Uso:  node scripts/apply-migration.mjs migrations/<archivo>.sql
// =============================================================================

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const target = process.argv[2];

if (target === undefined || !target.endsWith('.sql')) {
  console.error('Uso: node scripts/apply-migration.mjs migrations/<archivo>.sql');
  process.exit(1);
}

const source = readFileSync(target, 'utf8');
// El DDL para `db query`, y la verificación aparte.
const verifyIndex = source.lastIndexOf('DO $verify$');
const ddl = verifyIndex === -1 ? source : source.slice(0, verifyIndex);
const verify = verifyIndex === -1 ? '' : source.slice(verifyIndex);

/**
 * Divide el DDL en sentencias.
 *
 * Se parte por `;` en vez de usar un parser de PL/pgSQL porque este archivo solo
 * contiene DDL: los literales de texto que hay (`COMMENT ON ... IS '...'`) no
 * contienen punto y coma, y el `CREATE OR REPLACE VIEW` tiene su cuerpo entre
 * paréntesis pero termina en un `;` de verdad, que es el que corta aquí.
 */
function splitStatements(sql) {
  return splitOutsideLiterals(stripComments(sql))
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * Trocea por `;` SIN partir dentro de un literal de texto.
 *
 * Hace falta porque los `COMMENT ON ... IS '...'` llevan texto con punto y coma
 * dentro de las comillas. Repartir a ciegas partiría esa sentencia en dos y
 * mandaría a `db query` un fragmento inválido.
 */
function splitOutsideLiterals(sql) {
  const parts = [];
  let current = '';
  let inLiteral = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "'") {
      // `''` es un literal escapado, no el cierre del que estamos dentro.
      const isEscaped = index > 0 && sql[index - 1] === "'" && inLiteral;
      if (inLiteral && isEscaped) {
        current += char;
        continue;
      }
      inLiteral = !inLiteral;
      current += char;
      continue;
    }
    if (char === ';' && !inLiteral) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * Quita los comentarios de línea.
 *
 * Se eliminan ANTES de trocear, y el orden importa mucho: un `;` puede quedar
 * DENTRO de un comentario (los textos de estas migraciones los traen), y si se
 * troceara primero, ese `;` cortaría la sentencia por la mitad y el trozo
 * resultante empezaría por texto de comentario en lugar de por DDL.
 */
function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

/** Nombre legible de una sentencia: su primera línea de código real. */
function statementLabel(statement) {
  const firstCodeLine = statement.split('\n').find((line) => line.trim().length > 0);
  return (firstCodeLine ?? '').trim().slice(0, 64);
}

/**
 * Ruta al entrypoint de la CLI de InsForge.
 *
 * POR QUÉ NO `npx @insforge/cli`: en Windows, `execFileSync('npx.cmd', …)` falla
 * con `EINVAL` porque `.cmd` no es un ejecutable y Node no puede lanzarlo sin
 * shell. Y con `shell: true` el SQL se parte en varias piezas: los saltos de línea
 * de una sentencia multi-línea los ve el shell como separadores de argumentos, y
 * la CLI recibe 3 argumentos donde esperaba 1 ("too many arguments for
 * 'query'"). Ninguna de las dos vías funciona con SQL multilínea.
 *
 * La solución es invocar el binario de Node directamente contra el `package.json`
 * de la CLI, con el SQL como UN argumento. Se localiza en la caché de `npx` (donde
 * `npx` la dejó al instalar) y se pinnea por `package.json` en vez de a una
 * versión: si la CLI cambia, este script sigue funcionando sin tocarlo.
 */
const CLI_PACKAGE = resolveCliPackage();

function resolveCliPackage() {
  // `npx` la deja en `<npm-cache>/_npx/<hash>/node_modules/@insforge/cli`. Se
  // recorren todos los directorios porque el hash cambia según cuándo se
  // resolvió la instalación.
  const candidates = [];
  if (process.env.npm_config_cache) {
    candidates.push(`${process.env.npm_config_cache}\\_npx`);
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(`${process.env.LOCALAPPDATA}\\npm-cache\\_npx`);
  }

  for (const npxRoot of candidates) {
    let entries;
    try {
      entries = readdirSync(npxRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const cliDir = `${npxRoot}\\${entry.name}\\node_modules\\@insforge\\cli`;
      try {
        const manifest = JSON.parse(readFileSync(`${cliDir}\\package.json`, 'utf8'));
        const bin = manifest.bin;
        const binPath = typeof bin === 'string' ? bin : (bin?.cli ?? Object.values(bin ?? {})[0]);
        if (typeof binPath !== 'string') continue;
        const resolved = `${cliDir}\\${binPath.replace(/^\.\//, '')}`;
        if (existsSync(resolved)) return resolved;
      } catch {
        // Directorio sin la CLI o sin manifest legible: se sigue buscando.
      }
    }
  }

  console.error('No se encontró @insforge/cli en la caché de npx.');
  console.error('Instálala una vez con: npx -y @insforge/cli@latest current');
  process.exit(1);
}

function run(label, sql) {
  const trimmed = sql.trim();
  if (trimmed.length === 0) return { ok: true, output: '' };
  process.stdout.write(`  ${label} ... `);
  try {
    const output = execFileSync(process.execPath, [
      CLI_PACKAGE,
      'db',
      'query',
      trimmed,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    console.log('ok');
    return { ok: true, output };
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    console.log('FALLO');
    console.error(detail.length > 0 ? detail : `sin detalle (código ${error.status ?? '?'})`);
    return { ok: false, output: detail };
  }
}

/** Una consulta de verificación que devuelva un número o un texto. */
function check(description, sql, expect) {
  process.stdout.write(`  ${description} ... `);
  let output;
  try {
    output = execFileSync(
      process.execPath,
      [CLI_PACKAGE, 'db', 'query', sql, '--json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
    );
  } catch (error) {
    console.log('ERROR al consultar');
    console.error(`${error.stdout ?? ''}${error.stderr ?? ''}`.trim());
    return false;
  }
  const clean = output.replace(/^\uFEFF/, '');
  const matches = expect.every((needle) => clean.includes(needle));
  console.log(matches ? 'ok' : 'FALLO');
  if (!matches) console.error(`    esperado ${JSON.stringify(expect)} en: ${clean.slice(0, 400)}`);
  return matches;
}

console.log(`Aplicando ${target} (sentencia por sentencia)\n`);

const statements = splitStatements(ddl);
console.log(`DDL: ${statements.length} sentencias`);

let failed = 0;
for (const [index, statement] of statements.entries()) {
  const label = `${String(index + 1).padStart(2)}/${statements.length} ${statementLabel(statement)}`;
  if (!run(label, statement).ok) {
    failed += 1;
    break; // Sin halting: seguir tras un fallo deja la migración a medias.
  }
}

if (failed > 0) {
  console.error('\nLa migración se detuvo en una sentencia. No se continúa a la verificación.');
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Verificación
// -----------------------------------------------------------------------------
//
// Equivalente al `DO $verify$` del archivo, expresado con SELECT. `db query` no
// acepta bloques procedurales, así que cada comprobación es una consulta que debe
// devolver el valor esperado, y se registra cuáles no cuadran.
console.log('\nVerificación');

const checks = [
  [
    'las 6 dimensiones del caso existen como text NULL-able',
    `SELECT count(*)::int AS total FROM information_schema.columns
     WHERE table_schema='public' AND table_name='cases'
       AND column_name IN ('country','campus','modality','project','responsible','guideline')
       AND is_nullable='YES' AND data_type='text'`,
    ['"total": 6'],
  ],
  [
    'case_human_reviews existe',
    `SELECT count(*)::int AS total FROM information_schema.tables
     WHERE table_schema='public' AND table_name='case_human_reviews'`,
    ['"total": 1'],
  ],
  [
    'su FK apunta a audits, NO a legacy_audits',
    `SELECT count(*)::int AS total FROM pg_constraint
     WHERE conrelid='public.case_human_reviews'::regclass AND contype='f'
       AND confrelid='public.audits'::regclass`,
    ['"total": 1'],
  ],
  [
    'no referencia legacy_audits',
    `SELECT count(*)::int AS total FROM pg_constraint
     WHERE conrelid='public.case_human_reviews'::regclass
       AND confrelid='public.legacy_audits'::regclass`,
    ['"total": 0'],
  ],
  [
    'audit_id es UNIQUE (una revisión por auditoría)',
    `SELECT count(*)::int AS total FROM pg_constraint
     WHERE conrelid='public.case_human_reviews'::regclass AND contype='u'
       AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                           WHERE attrelid='public.case_human_reviews'::regclass
                             AND attname='audit_id')]::smallint[]`,
    ['"total": 1'],
  ],
  [
    'la vista existe y es una vista',
    `SELECT count(*)::int AS total FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='audit_dashboard_metrics' AND c.relkind='v'`,
    ['"total": 1'],
  ],
  [
    'la vista expone 31 columnas',
    `SELECT count(*)::int AS total FROM pg_attribute
     WHERE attrelid='public.audit_dashboard_metrics'::regclass
       AND attnum > 0 AND NOT attisdropped`,
    ['"total": 31'],
  ],
  [
    'la vista expone las 7 columnas nuevas',
    `SELECT count(*)::int AS total FROM pg_attribute
     WHERE attrelid='public.audit_dashboard_metrics'::regclass AND attnum > 0
       AND NOT attisdropped
       AND attname IN ('country','campus','modality','project','responsible',
                       'guideline','human_result')`,
    ['"total": 7'],
  ],
  [
    'la vista NO es accesible por anon/authenticated',
    `SELECT count(*)::int AS total FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) g
     WHERE c.oid='public.audit_dashboard_metrics'::regclass
       AND g.grantee IN ((SELECT oid FROM pg_roles WHERE rolname='anon'),
                         (SELECT oid FROM pg_roles WHERE rolname='authenticated'))`,
    ['"total": 0'],
  ],
  [
    'project_admin tiene SELECT en la vista',
    `SELECT count(*)::int AS total FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) g
     WHERE c.oid='public.audit_dashboard_metrics'::regclass
       AND g.grantee='project_admin'::regrole AND g.privilege_type='SELECT'`,
    ['"total": 1'],
  ],
  [
    'project_admin puede INSERTar en case_human_reviews',
    `SELECT count(*)::int AS total FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) g
     WHERE c.oid='public.case_human_reviews'::regclass
       AND g.grantee='project_admin'::regrole AND g.privilege_type='INSERT'`,
    ['"total": 1'],
  ],
  [
    'case_human_reviews NO es accesible por anon/authenticated',
    `SELECT count(*)::int AS total FROM pg_class c
     CROSS JOIN LATERAL aclexplode(c.relacl) g
     WHERE c.oid='public.case_human_reviews'::regclass
       AND g.grantee IN ((SELECT oid FROM pg_roles WHERE rolname='anon'),
                         (SELECT oid FROM pg_roles WHERE rolname='authenticated'))`,
    ['"total": 0'],
  ],
];

let checksFailed = 0;
for (const [description, sql, expect] of checks) {
  if (!check(description, sql, expect)) checksFailed += 1;
}

console.log('');
if (checksFailed === 0) {
  console.log(`Migración aplicada y verificada: ${target}`);
  console.log('Nota: NO queda registrada en system.migrations (ver cabecera del script).');
  process.exit(0);
}

console.error(`${checksFailed} comprobación(es) fallaron. Revisa la salida anterior.`);
if (verify.length > 0) {
  console.error('\nEl bloque DO $verify$ del archivo es la versión canónica; estas son sus mismas');
  console.error('comprobaciones expresadas como SELECT porque db query no acepta bloques DO.');
}
process.exit(1);
