export type PolicySourceStatus = 'CANONICAL' | 'LEGACY' | 'PENDING_VERIFICATION' | 'SUPERSEDED';

/**
 * Registro de una fuente normativa.
 *
 * Los campos de verificación (`effectiveFrom`, `effectiveTo`, `verifiedBy`,
 * `verifiedAt`, `notes`) son OPCIONALES a propósito: son opcionales porque la
 * ausencia de evidencia de verificación NO equivale a una fuente canónica
 * (UNKNOWN_IS_NOT_FALSE) y porque las fuentes locales del repositorio todavía
 * no han sido verificadas por el propietario. Al ser opcionales, cualquier
 * llamador existente que construya un `PolicySourceRecord` sin ellos sigue
 * compilando sin cambios.
 */
export interface PolicySourceRecord {
  policyCode: string;
  policyVersion: string;
  documentId: string;
  sha256: string;
  status: PolicySourceStatus;
  /** Vigencia declarada por el propietario de la fuente; `null` si se desconoce. */
  effectiveFrom?: string | null;
  /** Fin de vigencia declarado; `null` si la fuente sigue vigente o se desconoce. */
  effectiveTo?: string | null;
  /** Actor que verificó la fuente contra el original oficial; `null` si nadie la verificó. */
  verifiedBy?: string | null;
  /** Instante de la verificación; `null` si nadie la verificó. */
  verifiedAt?: string | null;
  /** Nota libre del propietario; nunca se interpreta como criterio normativo. */
  notes?: string | null;
}

export interface PolicyRuleReference {
  policyCode: string;
  policyVersion: string;
  documentId: string;
  section: string;
  page?: number;
  citation?: string;
}

export interface ResolvedPolicyRuleReference extends PolicyRuleReference {
  status: PolicySourceStatus;
}

export interface PolicySourceRegistry {
  get(policyCode: string, policyVersion: string): PolicySourceRecord | undefined;
  list(): PolicySourceRecord[];
  canonicalSources(): PolicySourceRecord[];
  requireReference(reference: PolicyRuleReference): ResolvedPolicyRuleReference;
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const sourceKey = (policyCode: string, policyVersion: string): string => `${policyCode}|${policyVersion}`;

export function createPolicySourceRegistry(sources: readonly PolicySourceRecord[]): PolicySourceRegistry {
  const byKey = new Map<string, PolicySourceRecord>();
  const documentIds = new Set<string>();

  for (const source of sources) {
    if (!sha256Pattern.test(source.sha256)) {
      throw new Error(`POLICY_SOURCE_SHA256_INVALID: ${source.documentId}`);
    }

    const key = sourceKey(source.policyCode, source.policyVersion);
    if (byKey.has(key) || documentIds.has(source.documentId)) {
      throw new Error(`POLICY_SOURCE_DUPLICATE: ${key}`);
    }

    byKey.set(key, { ...source });
    documentIds.add(source.documentId);
  }

  const list = (): PolicySourceRecord[] => [...byKey.values()].map((source) => ({ ...source }));

  return {
    get(policyCode, policyVersion) {
      const source = byKey.get(sourceKey(policyCode, policyVersion));
      return source ? { ...source } : undefined;
    },
    list,
    canonicalSources() {
      return list().filter((source) => source.status === 'CANONICAL');
    },
    requireReference(reference) {
      const source = byKey.get(sourceKey(reference.policyCode, reference.policyVersion));
      if (!source || source.documentId !== reference.documentId) {
        throw new Error(`POLICY_SOURCE_NOT_FOUND: ${sourceKey(reference.policyCode, reference.policyVersion)}`);
      }
      return { ...reference, status: source.status };
    },
  };
}
