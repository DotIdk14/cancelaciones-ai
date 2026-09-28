import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface PolicySectionManifest { id: string; title: string; pages: number[]; file: string; chars: number }
export interface PolicyManifest { code: string; title: string; version: string; publishedAt: string; sections: PolicySectionManifest[] }
export interface PolicySearchHit { section: string; title: string; score: number; snippet: string }

const cache = new Map<string, PolicyManifest>();
const defaultRoot = resolve(process.cwd(), '../../policy');

export function loadPolicyManifest(rootDir = defaultRoot): PolicyManifest {
  const root = resolve(rootDir);
  const cached = cache.get(root);
  if (cached) return cached;
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as PolicyManifest;
  cache.set(root, manifest);
  return manifest;
}

export function readPolicySection(sectionId: string, rootDir = defaultRoot): { section: PolicySectionManifest; text: string } {
  const manifest = loadPolicyManifest(rootDir);
  const section = manifest.sections.find((item) => item.id === sectionId);
  if (!section) throw new Error(`POLICY_SECTION_NOT_FOUND:${sectionId}`);
  return { section, text: readFileSync(join(resolve(rootDir), section.file), 'utf8') };
}

export function searchPolicy(query: string, rootDir = defaultRoot): PolicySearchHit[] {
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return loadPolicyManifest(rootDir).sections
    .map((section) => {
      const text = readPolicySection(section.id, rootDir).text;
      const lower = `${section.title}\n${text}`.toLowerCase();
      const score = tokens.reduce((total, token) => total + countToken(lower, token), 0);
      return { section: section.id, title: section.title, score, snippet: snippetFor(text, tokens) };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);
}

function countToken(text: string, token: string): number {
  return text.split(token).length - 1;
}

function snippetFor(text: string, tokens: string[]): string {
  const lower = text.toLowerCase();
  const first = tokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 120);
  return text.slice(start, start + 600);
}
