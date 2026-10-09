// =============================================================================
// generate-policy.mjs — Compila policy/ (procedimiento V5) a un módulo TS.
//
// POR QUÉ: el runtime de Vercel Functions (esbuild) no resuelve globs ni
// `?raw` de Vite, así que el Audit Skill importa el procedimiento como un
// módulo TypeScript generado. `policy/` sigue siendo la fuente normativa
// inmutable (POLICY_IS_IMMUTABLE); este script solo la serializa.
//
// Se ejecuta en `prebuild` y `predev`. El archivo generado se commitea para
// que el repositorio compile aunque el script no se haya ejecutado.
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const policyDir = join(root, 'policy');
const outDir = join(root, 'src', 'skills', 'audit');
const outFile = join(outDir, 'policy-v5.generated.ts');

const manifestPath = join(policyDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('[generate-policy] No existe policy/manifest.json — no se generó el módulo.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.code !== 'GDM_GAM_PRD_MLG_003' || manifest.version !== '5') {
  console.error('[generate-policy] El manifest no corresponde al procedimiento esperado (GDM_GAM_PRD_MLG_003 v5).');
  process.exit(1);
}

const sections = manifest.sections
  .map((section) => {
    // `section.file` es relativo a `policy/` (ej: "sections/1.md").
    const file = join(policyDir, section.file);
    if (!existsSync(file)) {
      console.error(`[generate-policy] Falta la sección ${section.id} (${section.file}).`);
      process.exit(1);
    }
    const raw = readFileSync(file, 'utf8');
    // Quita el frontmatter YAML (--- ... ---) y deja solo el contenido markdown.
    const body = raw.replace(/^---[\s\S]*?---\s*/, '').trim();
    return {
      id: section.id,
      title: section.title,
      pages: section.pages ?? [],
      content: body,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

function tsString(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const header = `// =============================================================================
// ARCHIVO GENERADO — NO EDITAR A MANO.
// Fuente: policy/ (GDM_GAM_PRD_MLG_003 v5). Regenerar con: npm run policy:generate
// =============================================================================
`;

const lines = [
  header,
  `import type { PolicyManifest, PolicySection } from './procedure-v5';`,
  ``,
  `export const POLICY_CODE = ${tsString(manifest.code)};`,
  `export const POLICY_TITLE = ${tsString(manifest.title)};`,
  `export const POLICY_VERSION = ${tsString(manifest.version)};`,
  `export const POLICY_SOURCE_FILE = ${tsString(manifest.sourceFile)};`,
  `export const POLICY_SOURCE_SHA256 = ${tsString(manifest.sourceSha256)};`,
  ``,
  `export const POLICY_SECTIONS: PolicySection[] = ${tsString(sections)};`,
  ``,
  `export const POLICY_MANIFEST: PolicyManifest = {`,
  `  code: POLICY_CODE,`,
  `  title: POLICY_TITLE,`,
  `  version: POLICY_VERSION,`,
  `  sourceFile: POLICY_SOURCE_FILE,`,
  `  sourceSha256: POLICY_SOURCE_SHA256,`,
  `  sections: POLICY_SECTIONS,`,
  `};`,
  ``,
];

const fullTextLines = [
  `// Texto completo concatenado del procedimiento, listo para el contexto del modelo.`,
  `export const PROCEDURE_V5_TEXT: string = ${tsString(fullText(sections))};`,
  ``,
];

function fullText(sections) {
  const parts = [
    `PROCEDIMIENTO ${manifest.code} — ${manifest.title} — VERSIÓN ${manifest.version}`,
    `Fuente oficial: ${manifest.sourceFile} (SHA-256: ${manifest.sourceSha256})`,
    '',
  ];
  for (const section of sections) {
    parts.push(`## Sección ${section.id} — ${section.title} (páginas ${section.pages.join(', ') || '—'})`);
    parts.push(section.content);
    parts.push('');
  }
  return parts.join('\n');
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, [lines.join('\n'), fullTextLines.join('\n')].join('\n'), 'utf8');
console.log(`[generate-policy] OK — ${sections.length} secciones → ${outFile.replace(root, '.')}`);
