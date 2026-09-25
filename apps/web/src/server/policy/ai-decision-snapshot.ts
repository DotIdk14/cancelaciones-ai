import { createHash } from 'node:crypto';
import { canonicalizeV1 } from '@cancelaciones/domain';
import type { AiDecisionV1Snapshot } from '@cancelaciones/db';

export type { AiDecisionV1Snapshot };

/** Snapshot sin su propio hash: exactamente la parte que alimenta el hash. */
export type AiDecisionV1SnapshotHashable = Omit<AiDecisionV1Snapshot, 'hash'>;

/**
 * Campos que el hash DEBE cubrir. El tipo obliga a enumerarlos todos: si mañana
 * se agrega un campo al snapshot, el compilador falla acá hasta que se decida
 * si entra o no en el hash. No se permite `...rest` porque filtraría el hash.
 */
type AiDecisionV1HashField = keyof AiDecisionV1SnapshotHashable;

/**
 * Entrada del constructor: `decisionVersion` lo fija la función, no el llamador,
 * para que no sea posible construir un snapshot durable con otra versión.
 */
export type BuildAiDecisionV1SnapshotInput = Omit<AiDecisionV1SnapshotHashable, 'decisionVersion'>;

export function aiDecisionV1HashPayload(snapshot: AiDecisionV1SnapshotHashable): Record<AiDecisionV1HashField, unknown> {
  return {
    auditId: snapshot.auditId,
    factRunId: snapshot.factRunId,
    decisionVersion: snapshot.decisionVersion,
    policyCode: snapshot.policyCode,
    policyVersion: snapshot.policyVersion,
    policySourceId: snapshot.policySourceId,
    engineVersion: snapshot.engineVersion,
    promptVersion: snapshot.promptVersion,
    extractorVersion: snapshot.extractorVersion,
    provider: snapshot.provider,
    model: snapshot.model,
    inputFingerprint: snapshot.inputFingerprint,
    decisionSnapshot: snapshot.decisionSnapshot,
    ruleTraceSnapshot: snapshot.ruleTraceSnapshot,
    evidenceSnapshot: snapshot.evidenceSnapshot,
    createdAt: snapshot.createdAt,
  };
}

/**
 * SHA-256 sobre el snapshot canónico completo, sin truncar ningún campo.
 *
 * Se usa `canonicalizeV1` (no `canonicalFingerprintV1`) a propósito: el
 * fingerprint de dominio descarta campos operativos (`createdAt`, `updatedAt`,
 * `completedAt`, `executionId`, `runId`) y ese snapshot NO puede perderlos,
 * porque su inmutabilidad depende de que el hash cubra el snapshot entero.
 */
export function hashAiDecisionV1Snapshot(
  snapshot: AiDecisionV1SnapshotHashable & { hash?: string },
): string {
  const canonical = JSON.stringify(canonicalizeV1(aiDecisionV1HashPayload(snapshot))) ?? 'null';
  return createHash('sha256').update(canonical).digest('hex');
}

/** Construye el snapshot durable y calcula su hash en una sola operación. */
export function buildAiDecisionV1Snapshot(input: BuildAiDecisionV1SnapshotInput): AiDecisionV1Snapshot {
  const hashable: AiDecisionV1SnapshotHashable = {
    auditId: input.auditId,
    factRunId: input.factRunId,
    decisionVersion: 'AI_DECISION_V1',
    policyCode: input.policyCode,
    policyVersion: input.policyVersion,
    policySourceId: input.policySourceId,
    engineVersion: input.engineVersion,
    promptVersion: input.promptVersion,
    extractorVersion: input.extractorVersion,
    provider: input.provider,
    model: input.model,
    inputFingerprint: input.inputFingerprint,
    decisionSnapshot: input.decisionSnapshot,
    ruleTraceSnapshot: input.ruleTraceSnapshot,
    evidenceSnapshot: input.evidenceSnapshot,
    createdAt: input.createdAt,
  };

  return { ...hashable, hash: hashAiDecisionV1Snapshot(hashable) };
}
