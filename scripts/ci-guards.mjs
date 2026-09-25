#!/usr/bin/env node
/**
 * Guardas de seguridad para CI.
 *
 * Dos comprobaciones, deliberadamente estrechas. Esto NO es DLP: no intenta
 * encontrar PII en general, solo falla ante las dos condiciones concretas que ya
 * seainen a producir un incidente en este repositorio.
 *
 *   1) TIMESTAMPS DE MIGRACION DUPLICADOS
 *      20260925120000_a.sql y 20260925120000_b.sql no pueden coexistir. El
 *      runner de migraciones ordena por timestamp, asi que dos ficheros con el
 *      mismo hacen que uno se aplique en silencio o que el otro se rechace, y no
 *      se sabe cual. Es un fallo de determinismo, no de estilo.
 *
 *   2) PII Y SECRETO EN FICHEROS VERSIONADOS
 *      El repositorio es publico. Detecta tres cosas:
 *        - correos de proveedores de correo gratuit@ (gmail, hotmail, ...), que
 *          es como se ve un correo personal real;
 *        - telefonos con forma de telefono, ignorando los numeros de relleno;
 *        - prefijos de credencial conocidos.
 *
 * PERMITIDO A PROPOSITO:
 *      - *.example.invalid / example.com / example.test / localhost
 *        (RFC 2606 / 6761: no se pueden resolver ni registrar).
 *      - telefonos cuyo numero nacional es todo ceros, que es la forma
 *        sintetica que se uso al sanear un fixture.
 *      - ficheros de bloqueo, .env.example y artefactos de build.
 *
 * Uso:  node scripts/ci-guards.mjs
 * Salida: 0 si todo bien, 1 con el detalle de cada fallo.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();

/** Ficheros que nunca se inspeccionan. */
const SKIP_FILES = new Set(['pnpm-lock.yaml', '.env.example', 'skills-lock.json']);
const SKIP_DIRS = ['node_modules', '.git', '.next', 'dist', 'tmp', '.insforge', '.vercel', 'coverage'];

/** Dominios que no son datos personales: no se pueden resolver ni registrar. */
const SAFE_EMAIL = /@(example\.(invalid|com|test)|localhost|insforge\.dev|github\.com|users\.noreply\.github\.com)$/i;

/** Correo de proveedor gratuito: es la forma que toma un correo personal real. */
const FREEMAIL = /[a-z0-9._%+-]+@(gmail|hotmail|outlook|live|icloud|proton(mail)?|yahoo)\.[a-z]{2,}/gi;

/**
 * Prefijos de credencial conocidos. Se lista el prefijo, no el secreto: el
 * guard falla ante la presencia del prefijo y nunca imprime el valor encontrado,
 * solo la posicion, para no copiar el secreto a los logs de CI.
 */
const SECRET_PREFIX = [
  /\bik_[0-9a-f]{16,}/gi, // InsForge API key
  /\buak_[A-Za-z0-9]{16,}/g, // InsForge user API key
  /\bsk-or-v1-[A-Za-z0-9]{16,}/g, // OpenRouter
  /\bsk-ant-[A-Za-z0-9]{16,}/g, // Anthropic
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT de sesion
];

function gitFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function isSkipped(rel) {
  if (SKIP_FILES.has(rel)) return true;
  return rel.split('/').some((segment) => SKIP_DIRS.includes(segment));
}

/**
 * Telefono con forma de telefono. Se acepta solo si el numero es de relleno.
 *
 * "De relleno" cubre dos formas, porque las dos existen en el repositorio:
 *   - todos ceros (`+52 00 00 00 00`);
 *   - clave de area real y suscriptor todo ceros (`+52 55 0000 0000`), que es la
 *     forma sintetica con la que se sanearon los fixtures.
 * En ambos casos el subscriber es 0000, que no es un numero asignable.
 */
function findRealLookingPhone(text) {
  const hits = [];
  const re = /(\+\d{1,3})[\s.-]?((?:\d[\s.-]?){9,14}\d)/g;
  for (const match of text.matchAll(re)) {
    const digits = match[2].replace(/\D/g, '');
    if (digits.length < 10) continue;
    if (/^0+$/.test(digits) || /^0+$/.test(digits.slice(2))) continue;
    hits.push({ index: match.index, shape: `${match[1]}*******` });
  }
  return hits;
}

const failures = { duplicateTimestamps: [], pii: [], secrets: [] };

// --- 1) Timestamps de migracion unicos ------------------------------------
// Se lee el DIRECTORIO, no `git ls-files`: una migration nueva todavia sin
// commitear es justo el momento en que se produce la colision, y si solo se
// mirara lo versionado el guard no diria nada hasta que ya fuera tarde.
const migrations = existsSync(path.join(ROOT, 'migrations'))
  ? readdirSync(path.join(ROOT, 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => `migrations/${name}`)
  : [];

const byStamp = new Map();
for (const file of migrations) {
  const stamp = path.basename(file).split('_')[0];
  if (!/^\d{8,}$/.test(stamp)) {
    failures.duplicateTimestamps.push(`${file}: el prefijo "${stamp}" no es un timestamp numerico`);
    continue;
  }
  if (!byStamp.has(stamp)) byStamp.set(stamp, []);
  byStamp.get(stamp).push(file);
}
for (const [stamp, files] of byStamp) {
  if (files.length > 1) failures.duplicateTimestamps.push(`${stamp}: ${files.join(' y ')}`);
}

// --- 2) PII y secretos en ficheros versionados ----------------------------
for (const rel of gitFiles()) {
  if (isSkipped(rel)) continue;
  let text;
  try {
    text = readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    continue; // binario o ilegible
  }

  for (const match of text.matchAll(FREEMAIL)) {
    if (SAFE_EMAIL.test(match[0])) continue;
    failures.pii.push(`${rel}: correo de proveedor gratuito en la posicion ${match.index}`);
  }
  for (const hit of findRealLookingPhone(text)) {
    failures.pii.push(`${rel}: telefono con forma real (${hit.shape}) en la posicion ${hit.index}`);
  }
  for (const re of SECRET_PREFIX) {
    re.lastIndex = 0;
    if (re.test(text)) failures.secrets.push(`${rel}: prefijo de credencial ${re.source.slice(0, 24)}`);
  }
}

// --- Informe ---------------------------------------------------------------
const sections = [
  ['TIMESTAMPS DE MIGRACION DUPLICADOS', failures.duplicateTimestamps],
  ['PII EN FICHEROS VERSIONADOS', failures.pii],
  ['CREDENCIALES EN FICHEROS VERSIONADOS', failures.secrets],
];

let total = 0;
for (const [title, items] of sections) {
  if (items.length === 0) {
    console.log(`OK   ${title}`);
    continue;
  }
  total += items.length;
  console.error(`FAIL ${title} (${items.length})`);
  for (const item of items) console.error(`     - ${item}`);
}

console.log(`\nmigraciones revisadas: ${migrations.length} | ficheros versionados revisados: ${gitFiles().length}`);
process.exit(total > 0 ? 1 : 0);
