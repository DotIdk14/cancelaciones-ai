// Servicio de plantilla del Dictamen (server-only).
// Carga templates/Dictamen.pdf desde la raiz del repo, verifica que el layout
// derivado (template-layout.json) corresponde al hash actual y expone el hash.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import layoutJson from './template-layout.json';

export const TEMPLATE_FILE_NAME = 'Dictamen.pdf';
export const REPORT_BUCKET = 'dictamen-reportes';

export interface DictamenTemplatePrepared {
  bytes: Uint8Array;
  sha256: string;
  fileName: string;
}

export interface TemplateLayoutSpan {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
}

export interface TemplateLayoutPage {
  page: number;
  widthPt: number;
  heightPt: number;
  spans: TemplateLayoutSpan[];
  fillRects: Array<{ x: number; y: number; width: number; height: number; color: string }>;
}

export interface TemplateLayout {
  fileName: string;
  templateHash: string;
  pageCount: number;
  pages: TemplateLayoutPage[];
  provenance: { source: string; generator: string; generatedAt: string };
}

const layout = layoutJson as unknown as TemplateLayout;

/** Hash sha256 de los bytes de la plantilla. */
export function templateSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Carga la plantilla oficial y verifica que el layout derivado sigue siendo
 * valido (mismo hash). Si la plantilla cambia, el render NO debe continuar
 * silenciosamente: exige regenerar el layout.
 */
const TEMPLATE_RELATIVE = '../../../../templates/Dictamen.pdf';

function resolveTemplatePath(): string {
  // Prioridad: env override > cwd de la app (dev/produccion de Next) > ruta
  // relativa al source (bundle de smoke). El hash valida la plantilla en todos
  // los casos.
  const envPath = process.env.DICTAMEN_TEMPLATE_PATH;
  if (envPath) return resolve(envPath);
  const candidates = [
    resolve(process.cwd(), '../../templates/Dictamen.pdf'), // cwd = apps/web
    resolve(process.cwd(), 'templates/Dictamen.pdf'), // cwd = raiz del repo
    resolve(fileURLToPath(new URL(TEMPLATE_RELATIVE, import.meta.url))),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export async function loadDictamenTemplate(): Promise<DictamenTemplatePrepared> {
  const templatePath = resolveTemplatePath();
  const bytes = new Uint8Array(await readFile(templatePath));
  const sha256 = templateSha256(bytes);
  if (sha256 !== layout.templateHash) {
    throw new Error(
      `La plantilla templates/Dictamen.pdf cambio (hash ${sha256.slice(0, 12)} != layout ${layout.templateHash.slice(0, 12)}). ` +
        'Regenera apps/web/src/server/reporting/template-layout.json con scripts/extract-template-layout.mjs antes de renderizar.',
    );
  }
  return { bytes, sha256, fileName: TEMPLATE_FILE_NAME };
}

export function getTemplateLayout(): TemplateLayout {
  return layout;
}

/** Hash de la plantilla conocido por el layout derivado (referencia canonica). */
export function getKnownTemplateHash(): string {
  return layout.templateHash;
}