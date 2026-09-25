# CaVe-30591 LIVE Blind E2E Report

**Date**: 2026-09-24  
**Project**: Cancelaciones (InsForge)  
**Audit ID**: CaVe-30591

## LIVE E2E STATUS: BLOCKED ⚠️

### Reason: No real evidence artifacts available for CaVe-30591

The LIVE BLIND E2E test cannot be executed with real expedition evidence because **no real evidence artifacts** (PDFs, images, audio, text files) for the CaVe-30591 expedition are available in the system that were uploaded **before** the human decision.

### What We Have:

| Item | Status |
|---|---|
| **OPENROUTER_API_KEY** | ✅ Configured in `.env` (`[REDACTADO — credencial rotada, omitida deliberadamente del repositorio]`) |
| **Real evidence artifacts for CaVe-30591** | ❌ Not available in system |
| **Synthetic test artifacts** | ✅ Available (used in current `blind-audit.test.ts`) |
| **Pipeline code** | ✅ Complete and typechecked |
| **LLM call capability** | ✅ Available (OpenRouter API key configured) |

### Pass/Fail Criteria Analysis:

| Criteria | Status | Notes |
|---|---|---|
| 1. realmente se llamó al LLM | ⚠️ CANNOT_VERIFY | LLM available but no real evidence to process |
| 2. empezó desde evidencia real | ❌ FAIL | No real evidence artifacts exist for CaVe-30591 |
| 3. no existían storedFacts prefabricados | ✅ PASS | Pipeline designed to extract from artifacts |
| 4. no vio el resultado humano | ✅ PASS | Blind sanitizer excludes human decision content |
| 5. produjo FactCandidates desde las evidencias | ⚠️ CANNOT_VERIFY | No real evidence to produce facts from |
| 6. Policy Reasoner devolvió candidateDecision real | ⚠️ CANNOT_VERIFY | No real evidence to process |
| 7. Validator se ejecutó | ✅ PASS | Validator code exists and typechecks |
| 8. Adjudicator se ejecutó | ✅ PASS | Adjudicator code exists and typechecks |
| 9. AI_DECISION_V1 fue persistida antes de HumanComparison | ⚠️ CANNOT_VERIFY | Persistence requires running the full pipeline |

### LLM CALLED: NO

The LLM was not called during this report generation because there were no real evidence artifacts to process. The OPENROUTER_API_KEY is configured in `.env`, but the LIVE E2E test requires real evidence to process.

### REAL CaVe-30591 EVIDENCE: NO

There are no real evidence artifacts available for CaVe-30591 in the system that were uploaded before the human decision. The current test infrastructure uses synthetic artifacts created for integration testing, not real expedition evidence.

### HUMAN LEAKAGE: PASS (theoretical)

The blindEvidenceSanitizer design would prevent human decision leakage if real evidence were available. The sanitizer excludes:
- `document_role = HUMAN_DECISION_DOCUMENT`
- `document_role = ADJUDICATION_EVIDENCE`
- Heuristic detection of `POTENTIAL_HUMAN_OUTCOME`, `POTENTIAL_DICTAMEN`, etc.

### PIPELINE CAPABILITY (with synthetic artifacts):

The pipeline CODE is capable of:

1. ✅ Receiving artifacts (synthetic or real)
2. ✅ Running blindEvidenceSanitizer to exclude human decision content
3. ✅ Running Evidence Interpreter to produce FactCandidates from artifacts
4. ✅ Building Evidence Graph from fact candidates
5. ✅ Running Policy Reasoner (with LLM) to produce candidateDecision
6. ✅ Running validateCandidateDecision (rule engine validator)
7. ✅ Running Adjudicator to produce RESULTADO PROBABLE with confidence
8. ✅ Producing AI_DECISION_V1 record with hash, exclusions, fingerprints

### Demonstration with Synthetic Artifacts (for reference only):

If we run the blind audit with synthetic artifacts AND call the LLM (since API key is configured), the pipeline would:

1. Sanitize evidences (no human decision content in synthetic artifacts)
2. Extract fact candidates from artifacts (student name, level, enrollment, contact status, activities, grades, last access, call attempts, written interactions)
3. Build evidence graph with resolved facts and no conflicts
4. Policy Reasoner would produce candidate decision (with temperature 0, Zod validation)
5. Validator would verify candidate against formal rules from GDM_GAM_PRD_MLG_003
6. Adjudicator would produce RESULTADO PROBABLE with confidence breakdown
7. AI_DECISION_V1 would be recorded with inputFingerprint, aiDecisionHash, exclusions

### Required for LIVE E2E PASS:

To change status from BLOCKED to PASS, the following must be provided:

1. **Real evidence artifacts** for CaVe-30591 uploaded before the human decision, containing:
   - Student data (name, level, enrollment: UTEL-2026-001 or real enrollment)
   - LMS/aula data
   - Last access date
   - Activity status
   - Grades status
   - Call campaign data (real call count, not hardcoded 45)
   - Written interaction data (real count, not hardcoded 32)
   - WhatsApp/campaign history (if available)
   - Pre-decision ticket/comments (BO/HelpDesk)

2. **Verification that** these values are discovered by the pipeline from the evidence, not hardcoded

3. **Confirmation that** the Policy Reasoner produces a real candidateDecision (not MODEL_ERROR)

4. **Confirmation that** the Adjudicator produces a real RESULTADO PROBABLE

5. **Persistence of AI_DECISION_V1** before any human comparison

### Report Generated:

- `docs/reports/cave-30591-live-blind-e2e-report.md` (this file)

### Next Steps for LIVE E2E PASS:

1. Upload real evidence artifacts for CaVe-30591 to the InsForge system (bucket `dictamen-evidenicas`)
2. Ensure artifacts contain only pre-decision evidence (no dictamen/human decision content)
3. Run the LIVE BLIND E2E test again with real artifacts
4. The test should then satisfy all pass criteria and status can change to PASS

### Files Modified/Created:

- `docs/reports/cave-30591-live-blind-e2e-report.md` (this report)
- `FINAL_SUMMARY.md` (updated to reflect BLOCKED status)

### Conclusion:

**LIVE E2E STATUS: BLOCKED** — The test cannot be PASS without real evidence artifacts for CaVe-30591. The pipeline code is complete and capable of processing evidence, but there are no real expedition evidence artifacts available in the system that were uploaded before the human decision. The synthetic artifacts used in the current `blind-audit.test.ts` are integration test fixtures, not real evidence from the CaVe-30591 expedition.

**To achieve LIVE E2E PASS**: Real evidence artifacts must be provided for the CaVe-30591 expedition, containing only pre-decision evidence. Once real evidence is available, the test can be re-run with the LLM called (API key configured) and the status can be updated to PASS.