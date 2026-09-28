import { POLICY_MANIFEST, PROCEDURE_V5_TEXT } from './policy-v5.generated';

// =============================================================================
// Procedimiento V5 — GDM_GAM_PRD_MLG_003
// =============================================================================
// Fuente normativa exclusiva del Audit Skill (POLICY_IS_IMMUTABLE).
// El texto procede de `policy/` (compilado por scripts/generate-policy.mjs) y
// se inyecta íntegro en el contexto del modelo. Este módulo NO decide nada:
// solo entrega la fuente al Skill.
// =============================================================================

export interface PolicySection {
  id: string;
  title: string;
  pages: number[];
  content: string;
}

export interface PolicyManifest {
  code: string;
  title: string;
  version: string;
  sourceFile: string;
  sourceSha256: string;
  sections: PolicySection[];
}

/** Metadatos del procedimiento oficial. */
export const PROCEDURE_MANIFEST: PolicyManifest = POLICY_MANIFEST;

/** Texto íntegro del procedimiento V5, listo para el contexto del modelo. */
export const PROCEDURE_TEXT: string = PROCEDURE_V5_TEXT;

/** Par de citación forzado para toda conclusión normativa. */
export const PROCEDURE_CITATION = {
  code: POLICY_MANIFEST.code,
  version: POLICY_MANIFEST.version,
  sourceSha256: POLICY_MANIFEST.sourceSha256,
} as const;

export function procedureMetaLine(): string {
  return [
    `Fuente normativa: ${POLICY_MANIFEST.code} — ${POLICY_MANIFEST.title} — Versión ${POLICY_MANIFEST.version}`,
    `Archivo fuente: ${POLICY_MANIFEST.sourceFile}`,
    `SHA-256: ${POLICY_MANIFEST.sourceSha256}`,
    `Secciones indexadas: ${POLICY_MANIFEST.sections.length}`,
  ].join('\n');
}