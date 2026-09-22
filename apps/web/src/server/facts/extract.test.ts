import { describe, expect, it } from 'vitest';
import { extractFactsFromArtifacts } from './extract';

function artifact(id: string, extractedFacts: unknown[], text = '') {
  return {
    id,
    jobId: `job-${id}`,
    evidenceId: `evidence-${id}`,
    artifactType: 'visual-transcription',
    result: { text, extractedFacts },
    contentSha256: `sha-${id}`,
    createdAt: '2026-09-22T00:00:00Z',
  };
}

describe('fact extraction completeness and aggregation', () => {
  it('normalizes six visible emails as written contact events', () => {
    const result = extractFactsFromArtifacts({
      auditId: 'audit-test',
      runId: 'run-test',
      artifacts: [artifact('one', [{
        factType: 'contact.writtenInteractions',
        value: {
          sourceCompleteness: 'COMPLETE',
          events: Array.from({ length: 6 }, (_, index) => ({ channel: 'EMAIL', dateTime: `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00Z` })),
        },
      }])],
    });
    const written = result.find((fact) => fact.factType === 'contact.writtenInteractions')?.value as { events: unknown[]; observedCount: number };
    expect(written.observedCount).toBe(6);
    expect(written.events).toHaveLength(6);
  });

  it('keeps paginated collections partial instead of treating visible rows as complete', () => {
    const result = extractFactsFromArtifacts({
      auditId: 'audit-test',
      runId: 'run-test',
      artifacts: [artifact('one', [], 'Página 1 de 3\nMostrando 1-5 de 15')],
    });
    const written = result.find((fact) => fact.factType === 'contact.writtenInteractions')?.value as { sourceCompleteness: string; warnings: string[] };
    expect(written.sourceCompleteness).toBe('PARTIAL');
    expect(written.warnings).toContain('POTENTIALLY_PARTIAL_LIST');
  });

  it('aggregates events from multiple artifacts and deduplicates only identical observable identities', () => {
    const result = extractFactsFromArtifacts({
      auditId: 'audit-test',
      runId: 'run-test',
      artifacts: [
        artifact('one', [{ factType: 'contact.writtenInteractions', value: { sourceCompleteness: 'COMPLETE', events: [{ channel: 'WHATSAPP', dateTime: '2026-09-01T10:00:00Z' }] } }]),
        artifact('two', [{ factType: 'contact.writtenInteractions', value: { sourceCompleteness: 'COMPLETE', events: [{ channel: 'EMAIL', dateTime: '2026-09-02T10:00:00Z' }] } }]),
      ],
    });
    const written = result.find((fact) => fact.factType === 'contact.writtenInteractions')?.value as { events: unknown[]; observedCount: number };
    expect(written.observedCount).toBe(2);
  });
});
