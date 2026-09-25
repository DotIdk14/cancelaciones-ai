import type { ContactAttempt, ContactCollection, Fact } from './index';

interface GoldenCase {
  name: string;
  input: {
    policyCode: string;
    policyVersion: '5';
    facts: Fact[];
  };
  inputFingerprint: string;
  expectedFingerprint: string;
  metadata: {
    synthetic: true;
    notes: string;
  };
}

const provenance = { evidenceId: 'synthetic-evidence' } as const;
const metadata = { synthetic: true, notes: 'Behavior lock; not normative truth.' } as const;

function syntheticFact<T>(id: string, type: string, value: T): Fact<T> {
  return { id: `synthetic-${id}`, type, value, source: provenance, extractionConfidence: 1 };
}

function calls(count: number): ContactAttempt[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `synthetic-call-${index + 1}`,
    kind: 'CALL',
    occurredAt: new Date(Date.UTC(2026, 0, 1, index * 6)).toISOString(),
  }));
}

function writtenInteractions(): ContactAttempt[] {
  return [
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `synthetic-written-week-1-${index + 1}`,
      kind: 'WRITTEN' as const,
      occurredAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `synthetic-written-week-2-${index + 1}`,
      kind: 'WRITTEN' as const,
      occurredAt: new Date(Date.UTC(2026, 0, 8 + index)).toISOString(),
    })),
  ];
}

const completeCalls = syntheticFact('complete-calls', 'contact.callAttempts', calls(16));
const incompleteCalls = syntheticFact('incomplete-calls', 'contact.callAttempts', calls(15));
const completeWritten = syntheticFact('complete-written', 'contact.writtenInteractions', writtenInteractions());
const incompleteWritten = syntheticFact('incomplete-written', 'contact.writtenInteractions', writtenInteractions().slice(0, 9));
const effectiveContact = syntheticFact('effective-contact', 'contact.effectiveContact', false);
const noEffectiveContact = syntheticFact('no-effective-contact', 'contact.effectiveContact', true);
const undergraduateLevel = syntheticFact('undergraduate-level', 'student.level', 'LICENCIATURA');
const graduateLevel = syntheticFact('graduate-level', 'student.level', 'POSGRADO');
const noLogin = syntheticFact('no-login', 'classroom.hasLogin', false);
const noEvaluationMode = syntheticFact('no-evaluation-mode', 'classroom.hasEvaluationMode', false);
const noActivities = syntheticFact('no-activities', 'classroom.hasActivities', false);
const gradesAbsent = syntheticFact('grades-absent', 'classroom.hasGrades', false);
const gradesObserved = syntheticFact('grades-observed', 'classroom.hasGrades', true);
const partialCalls = syntheticFact('partial-calls', 'contact.callAttempts', {
  events: [],
  observedCount: 16,
  sourceCompleteness: 'PARTIAL',
} satisfies ContactCollection);
const partialWritten = syntheticFact('partial-written', 'contact.writtenInteractions', {
  events: writtenInteractions().slice(0, 6),
  observedCount: 6,
  sourceCompleteness: 'PARTIAL',
} satisfies ContactCollection);
const unknownCalls = syntheticFact('unknown-calls', 'contact.callAttempts', {
  events: [],
  observedCount: 16,
  sourceCompleteness: 'UNKNOWN',
} satisfies ContactCollection);
const unknownWritten = syntheticFact('unknown-written', 'contact.writtenInteractions', {
  events: [],
  observedCount: 10,
  sourceCompleteness: 'UNKNOWN',
} satisfies ContactCollection);

const fingerprints = {
  'complete-licenciatura': ['7bce39d4c8a356a2e1e8f77c02cbcbb04834409deb3416f87cfa96c99ef8db58', 'f95394ddaf0c5dc22a8fa133e0ae01c6546fc9e487c75894b05cc97deee43fea'],
  'missing-all-facts': ['4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', '3771a40414cd4b339b18059cfbefa5de6ac99b6e62d070d0934b4f8cc028321e'],
  'partial-contact-collections': ['ed2fd088d80fa94d2e1e3393c757f4b0444ba162d9711c29171734cf97c0a9bf', '50fde4d4728d90ee68dbea95aba70a320c40fe36ece22e146b0f56dd4d6726d5'],
  'unknown-academic-level': ['614419f3c83348b161b1582ec13159d1878b7b628e7f62f11a1554f5d475da92', '3c60ef592e08931650ba33aeb915be484774864088d114e084243331f27243ae'],
  'non-licenciatura': ['bbb2b50c23584acda4f09cb38e65a700ae9e871b3b5bfc466b393ead20594491', 'eadb0627eed359d7ff5c79ac359bcef440b24e9ca79a815cd0d99b950d3a6030'],
  'grades-observed': ['92a1b8597099ef932e6a12ef35f0572d25d68013b333815e23516d0d72220469', 'e260009ec5894046348f37c80ad5b088bd07f57c0f374579b3ada2a097a3b5b1'],
  'grades-absent': ['ea6680de55290e8c18b993dc423f39125f202e23f7fac2e84edee2da0a5b5982', '638bed7bfa343ea1007bc81faf9d00453bbf9749d0e9f2c2e90d90cd4ccc29b3'],
  'contact-threshold-satisfied': ['7c557a69b2aff0f0428debb269a9a48c53033a576ad5137050b54cdc3dc47c41', '2e501f028f60dfeb59c3fdfc31d6b1cf871d48ec7883590cedb3e56bf370fb7a'],
  'contact-threshold-not-satisfied': ['dce71863391ee6d0948ba935cd185e9272e88708eb58f9dc9b15dc8b031be1cc', 'b149edeac1a35fba5cedaa122a192346bedf8df5657b627867ed303bb9d3ea68'],
  'coverage-gaps-v5': ['4af0fd3e517a382c77363b9ca4574c95cdf2d8895a793a941522c9db52e3dac9', '197c968fe336dd033d58a67cef2c7bbe3c2ee7121fa2c5c00c5d165ac4135521'],
  'unknown-contact-collections': ['50b19363a894ec2c70207facd46e0023ffce602ab7fc2f27e0bd2d714fe788ff', '81f97514c5cafb7327e8e5d2254a2b87f76d0bed1731427dc929fe20dae61a7a'],
  'conflict-current-engine-probe': ['53af2fc6278adc0d65adda8056b0fe6238cd4d43f0d98db48be569796569c2cf', '9b1f69617e802bc987f44ff4a678cfc29e02188f535ce9bd87d04ffc1e0231f6'],
} as const;

const caseDefinition = (name: keyof typeof fingerprints, facts: Fact[]): GoldenCase => ({
  name,
  input: { policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts },
  inputFingerprint: fingerprints[name][0],
  expectedFingerprint: fingerprints[name][1],
  metadata,
});

const completeFacts = [
  completeCalls,
  completeWritten,
  effectiveContact,
  undergraduateLevel,
  noLogin,
  noEvaluationMode,
  noActivities,
  gradesAbsent,
];

const conflictProbeFacts = [
  completeCalls,
  completeWritten,
  noEffectiveContact,
  undergraduateLevel,
  noLogin,
  noEvaluationMode,
  gradesObserved,
];

export const goldenCases = [
  caseDefinition('complete-licenciatura', completeFacts),
  caseDefinition('missing-all-facts', []),
  caseDefinition('partial-contact-collections', [partialCalls, partialWritten]),
  caseDefinition('unknown-academic-level', [completeCalls, completeWritten, effectiveContact, noActivities]),
  caseDefinition('non-licenciatura', [completeCalls, completeWritten, effectiveContact, graduateLevel, noActivities, gradesAbsent]),
  caseDefinition('grades-observed', [effectiveContact, undergraduateLevel, noLogin, noEvaluationMode, noActivities, gradesObserved]),
  caseDefinition('grades-absent', [effectiveContact, undergraduateLevel, noLogin, noEvaluationMode, noActivities, gradesAbsent]),
  caseDefinition('contact-threshold-satisfied', [completeCalls, completeWritten, noEffectiveContact, undergraduateLevel, noLogin, noEvaluationMode]),
  caseDefinition('contact-threshold-not-satisfied', [incompleteCalls, incompleteWritten, noEffectiveContact, undergraduateLevel, noLogin, noEvaluationMode]),
  caseDefinition('coverage-gaps-v5', [gradesAbsent]),
  caseDefinition('unknown-contact-collections', [unknownCalls, unknownWritten]),
  {
    name: 'conflict-current-engine-probe',
    input: { policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts: conflictProbeFacts },
    inputFingerprint: fingerprints['conflict-current-engine-probe'][0],
    expectedFingerprint: fingerprints['conflict-current-engine-probe'][1],
    metadata: { synthetic: true, notes: 'Current engine does not materialize a conflict between the grades exclusion and cancellation outcome in this rule set.' },
  },
] as const;
