import { describe, expect, it } from 'vitest';

import { classifyLegacyFactMapping, legacyFactToCanonicalCandidate } from './legacy-mappings';

describe('legacy → canonical mappings', () => {
  it('mapea automáticamente sólo equivalencias EXACT demostrables', () => {
    expect(classifyLegacyFactMapping('contact.effectiveContact')).toMatchObject({
      classification: 'EXACT',
      canonicalFactId: 'F-contacto_efectivo',
    });

    const candidate = legacyFactToCanonicalCandidate({
      factType: 'contact.effectiveContact',
      value: true,
      sourceRef: { evidenceId: 'ev-1', artifactId: 'art-1', sha256: 'c'.repeat(64) },
      confidence: 0.8,
    });

    expect(candidate).toMatchObject({
      factId: 'F-contacto_efectivo',
      proposedState: 'KNOWN',
      value: true,
      evidenceId: 'ev-1',
      artifactId: 'art-1',
      extractionConfidence: 0.8,
    });
  });

  it('rechaza mapeos ambiguos o inexistentes como verdad canónica', () => {
    expect(classifyLegacyFactMapping('classroom.hasActivities').classification).toBe('AMBIGUOUS');
    expect(classifyLegacyFactMapping('student.enrollment').classification).toBe('NO_MAPPING');
    expect(legacyFactToCanonicalCandidate({
      factType: 'classroom.hasActivities',
      value: false,
      sourceRef: { evidenceId: 'ev-1', artifactId: 'art-1' },
      confidence: 0.8,
    })).toBeNull();
  });
});
