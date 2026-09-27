# Canonical Evidence Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make uploaded or synthetic evidence produce a valid Rule Engine V2 canonical fact context automatically, preserving provenance, uncertainty and provisional resolution output.

**Architecture:** Keep Rule Engine V2 as a deterministic pure core. Add a pure canonical acquisition layer in `packages/rule-engine-v2`, then add web adapters and persistence so evidence artifacts can produce canonical facts without forcing the legacy `contact.*` model to become policy input. Keep `/audit` 501 until route-level proof exists.

**Tech Stack:** TypeScript strict, Vitest, Next.js route handlers, InsForge/Postgres migrations, existing `@cancelaciones/rule-engine-v2` contracts.

## Global Constraints

- Do not restart Rule Engine V2.
- Do not invent a blanket legacy field → canonical fact mapping.
- AI/parsers may extract evidence facts; Rule Engine V2 must decide deterministically.
- Extraction confidence is not rule support score.
- Preserve `UNKNOWN_IS_NOT_FALSE`.
- Preserve four current engine fact states: `KNOWN | UNKNOWN | NOT_APPLICABLE | CONTRADICTED`.
- Preserve D53/glossary auxiliary-source constraint and `R-RET-03` primary grounding.
- Preserve `MachineDecisionRef` fail-closed guard.
- Do not open the 501 route until a real canonical context can be built from evidence/metadata.
- Do not expose a 94-field questionnaire.
- No production code without a failing test first.

---

## File Structure

- Create `packages/rule-engine-v2/src/acquisition/types.ts`: `CanonicalFactCandidate`, acquisition categories, legacy mapping classifications.
- Create `packages/rule-engine-v2/src/acquisition/validate.ts`: deterministic candidate validation to engine `Fact`.
- Create `packages/rule-engine-v2/src/acquisition/merge.ts`: contradiction-preserving merge.
- Create `packages/rule-engine-v2/src/acquisition/matrix.ts`: generated/derived acquisition matrix from fact catalog plus curated classifications.
- Create `packages/rule-engine-v2/src/acquisition/context.ts`: build `EvaluateAuditInput` from canonical facts + temporal metadata.
- Create `packages/rule-engine-v2/src/acquisition/relevant-missing.ts`: operational missing-fact projection from evaluation output.
- Modify `packages/rule-engine-v2/src/index.ts`: export acquisition API.
- Create tests under `packages/rule-engine-v2/src/tests/24-*.test.ts` through `30-*.test.ts`.
- Create `docs/rule-engine-v2/canonical-fact-acquisition-matrix.json` and `.md`.
- Create migration under `migrations/` for canonical fact runs/candidates/facts/temporal context.
- Create web adapter under `apps/web/src/server/canonical-facts/` for exact legacy mappings and evidence artifact candidates.
- Modify `apps/web/src/server/audit-engine/boundary.ts` only to update preconditions accurately; do not remove 501 unless route proof exists.
- Modify final report path `docs/reports/canonical-evidence-integration-report.md` with A–T headings from the user.

---

### Task 1: Canonical acquisition matrix

**Files:**
- Create: `packages/rule-engine-v2/src/acquisition/types.ts`
- Create: `packages/rule-engine-v2/src/acquisition/matrix.ts`
- Modify: `packages/rule-engine-v2/src/index.ts`
- Test: `packages/rule-engine-v2/src/tests/24-acquisition-matrix.test.ts`
- Create: `docs/rule-engine-v2/canonical-fact-acquisition-matrix.json`
- Create: `docs/rule-engine-v2/canonical-fact-acquisition-matrix.md`

**Interfaces:**
- Produces `buildCanonicalFactAcquisitionMatrix(): CanonicalFactAcquisitionEntry[]`.
- Produces `AcquisitionCategory` with the exact categories requested by the user.

- [ ] Write failing tests proving the matrix has one entry per catalog fact, all requested fields, and no unknown category.
- [ ] Implement `types.ts` and `matrix.ts` using `FACT_DEFINITIONS` only, with conservative curated classification rules.
- [ ] Generate docs JSON/MD from the same data.
- [ ] Run `cd packages/rule-engine-v2 && npx vitest run src/tests/24-acquisition-matrix.test.ts`.
- [ ] Commit `feat(rule-engine-v2): add canonical fact acquisition matrix`.

### Task 2: Candidate validation and provenance

**Files:**
- Create: `packages/rule-engine-v2/src/acquisition/validate.ts`
- Test: `packages/rule-engine-v2/src/tests/25-canonical-candidate-validation.test.ts`

**Interfaces:**
- Consumes `CanonicalFactCandidate`.
- Produces `validateCanonicalFactCandidate(candidate): ValidatedCanonicalFactCandidate`.
- Produces `candidateToFact(candidate): Fact`.

- [ ] Write failing tests for boolean, enum, number range, date ISO validation, invalid factId rejection, and confidence separation.
- [ ] Implement minimal validation against `factDefinition(factId)` and engine constructors.
- [ ] Ensure extraction confidence stays in provenance metadata or acquisition result, never as rule support.
- [ ] Run focused test.
- [ ] Commit `feat(rule-engine-v2): validate canonical fact candidates`.

### Task 3: Merge and contradiction preservation

**Files:**
- Create: `packages/rule-engine-v2/src/acquisition/merge.ts`
- Test: `packages/rule-engine-v2/src/tests/26-canonical-merge.test.ts`

**Interfaces:**
- Produces `mergeCanonicalFacts(facts: readonly Fact[]): readonly Fact[]`.

- [ ] Write failing tests: identical facts merge provenance; true+false becomes `CONTRADICTED`; unknown never becomes false; contradicted survives.
- [ ] Implement merge deterministically sorted by `factId`.
- [ ] Run focused test.
- [ ] Commit `feat(rule-engine-v2): merge canonical facts with contradictions preserved`.

### Task 4: Temporal context and evaluation input builder

**Files:**
- Create: `packages/rule-engine-v2/src/acquisition/context.ts`
- Test: `packages/rule-engine-v2/src/tests/27-canonical-context.test.ts`

**Interfaces:**
- Produces `buildCanonicalEvaluateAuditInput(params): EvaluateAuditInput`.
- Produces temporal validation helpers without `Date.now()`.

- [ ] Write failing tests for temporal ISO validation, required provenance for dates, no current-date substitution, and serializable `EvaluateAuditInput`.
- [ ] Implement builder using existing `EvidenceContext`, `TemporalContext`, `POLICY_VERSION`.
- [ ] Run focused test.
- [ ] Commit `feat(rule-engine-v2): build canonical evaluation input`.

### Task 5: Relevant missing facts projection

**Files:**
- Create: `packages/rule-engine-v2/src/acquisition/relevant-missing.ts`
- Test: `packages/rule-engine-v2/src/tests/28-relevant-missing-facts.test.ts`

**Interfaces:**
- Produces `relevantMissingFactsForEvaluation(evaluation: AuditEvaluation): RelevantMissingFact[]`.

- [ ] Write failing tests: resolved case returns empty operational missing list; unresolved candidate returns only facts from candidate unresolved facts / blocking requirements; no 94-fact dump.
- [ ] Implement projection using `candidateTrace`, `missingFacts`, `policyConflicts`, `provisionalOnly`.
- [ ] Run focused test.
- [ ] Commit `feat(rule-engine-v2): project relevant missing facts`.

### Task 6: AMB-CON-01 regression

**Files:**
- Modify: `packages/rule-engine-v2/src/tests/23-authority-trace.test.ts` or create `packages/rule-engine-v2/src/tests/29-amb-con-01-regression.test.ts`

**Interfaces:**
- No new production interface.

- [ ] Write failing/guard test capturing current asymmetric materialization: reaching either affected rule surfaces `AMB-CON-01` and provisional ranking does not erase it.
- [ ] Only modify production if test reveals a regression.
- [ ] Run focused test.
- [ ] Commit `test(rule-engine-v2): pin amb-con-01 visibility`.

### Task 7: Deterministic evidence → canonical facts → engine fixture

**Files:**
- Create: `packages/rule-engine-v2/src/tests/30-canonical-evidence-e2e.test.ts`
- Possibly create test helper: `packages/rule-engine-v2/src/acquisition/testing-fixtures.ts`

**Interfaces:**
- Uses Tasks 1–5 and `evaluateAudit`.

- [ ] Write failing E2E with synthetic evidence refs/candidates that produces a provisional `closestOutcome` with trace.
- [ ] Add the minimum helper code needed to build candidates and facts.
- [ ] Assert no auxiliary source independently closes the case.
- [ ] Run focused test.
- [ ] Commit `test(rule-engine-v2): prove canonical evidence can drive engine`.

### Task 8: Web exact mappings and canonical adapter

**Files:**
- Create: `apps/web/src/server/canonical-facts/legacy-mappings.ts`
- Create: `apps/web/src/server/canonical-facts/build-context.ts`
- Test: `apps/web/src/server/canonical-facts/legacy-mappings.test.ts`
- Test: `apps/web/src/server/canonical-facts/build-context.test.ts`

**Interfaces:**
- Produces `classifyLegacyFactMapping(factType): LegacyMappingClassification`.
- Produces `legacyFactToCanonicalCandidate(row): CanonicalFactCandidate | null` for `EXACT` only.

- [ ] Write failing tests for EXACT, AMBIGUOUS and NO_MAPPING behavior.
- [ ] Implement only demonstrable exact mappings; do not map ambiguous values.
- [ ] Build context from canonical candidates + audit metadata.
- [ ] Run focused web tests.
- [ ] Commit `feat(web): build canonical candidates from exact legacy facts`.

### Task 9: Persistence migration

**Files:**
- Create: `migrations/20260927_canonical_fact_context.sql` with next valid timestamp/version style.
- Modify DB types only if package has typed repository methods.
- Test: add SQL-shape/unit tests if existing DB package supports migration tests.

**Interfaces:**
- Tables: `canonical_fact_runs`, `canonical_fact_candidates`, `canonical_facts`, `audit_temporal_context`.

- [ ] Write migration with no leading SQL comment when executed via InsForge gotcha path.
- [ ] Include JSONB provenance, extraction confidence, temporal context, fingerprints, immutable frozen run fields.
- [ ] Add indexes on `audit_id`, `run_id`, `fact_id`.
- [ ] Do not apply remotely unless explicitly safe in this session; verify locally via static/schema tests.
- [ ] Commit `feat(db): persist canonical fact contexts`.

### Task 10: Route boundary decision

**Files:**
- Modify: `apps/web/src/server/audit-engine/boundary.ts`
- Modify tests: `apps/web/src/server/audit-engine/boundary.test.ts`, possibly `http.test.ts`

**Interfaces:**
- Keep route 501 unless route can construct same canonical context as E2E.

- [ ] Write failing tests for updated precondition list.
- [ ] Update boundary facts: canonical acquisition exists; real route still blocked if persistence/real audit context unavailable.
- [ ] Do not return 200 without route-level proof.
- [ ] Commit `feat(web): update canonical evaluation boundary preconditions`.

### Task 11: A–T report and final gates

**Files:**
- Create: `docs/reports/canonical-evidence-integration-report.md`

**Interfaces:**
- Uses exact headings A–T supplied by user.

- [ ] Write report with exact headings A through T.
- [ ] Include counts: total canonical facts, automatically acquirable, direct extraction, derivation, audit metadata, temporal derivation, not currently acquirable, owner mapping required.
- [ ] Include real gate output, git diff summary, and normative status.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, plus focused tests.
- [ ] Commit `docs: report canonical evidence integration`.

## Self-Review

- Spec coverage: all user sections 1–34 map to Tasks 1–11; route opening remains guarded by Tasks 7 and 10.
- Placeholder scan: no TBD/TODO; each task names files, interfaces and expected tests.
- Type consistency: acquisition layer uses existing engine `Fact`, `FactProvenance`, `EvaluateAuditInput`, `AuditEvaluation` and new `CanonicalFactCandidate`.
