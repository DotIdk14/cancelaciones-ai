# Phase Prompt — Rebuild Decision Tree, Phase 1: Normative Extraction

**Status:** READY TO EXECUTE. This document is a prompt, not an implementation.
**Precondition:** the clean slate is committed (`bc30182`) and the four gates pass.
**Do not implement this prompt until the owner explicitly starts Phase 1.**

---

## Objective

Build the **normative knowledge base** of the decision tree directly from the
owner's official source, with zero derivation from the retired legacy engine.

This phase produces **data and citations, not a runtime engine**. The engine
boundary stays closed (`AUDIT_ENGINE_NOT_IMPLEMENTED`) at the end of this phase.

---

## Non-negotiable constraints

These override any implementation convenience. If a requirement conflicts with
one of these, stop and report.

1. **The only normative source is**
   `normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf`.
   Nothing else defines policy. No internet sources, no legacy code, no legacy
   reports, no historical cases.

2. **Do not reintroduce any of the following**, all of which were retired and
   whose absence is verified by the clean-slate gates:
   - `CANCELACION_*` outcomes and any equivalent enum
   - `NON_LICENCIATURA` (never existed in the source)
   - `ShadowPolicyResult` / `DECLARATIVE_SHADOW`
   - A closed set of exactly 3 rules
   - The `policy_code`/`policy_version` constants as rule identifiers
   - `engine_runs`, `engine_rule_results`, `audit_evaluation_envelopes` as
     runtime write targets

3. **`UNKNOWN` is not `false`.** Absence of evidence must be representable and
   must never collapse into a satisfied or failed condition. Every rule must be
   able to evaluate to `UNKNOWN` and the aggregator must propagate it.

4. **AI extracts; the engine decides.** LLM/AI may read, transcribe, classify
   and structure evidence. It may not decide, and it may not author normative
   rules. Rules come only from the source.

5. **Every rule cites exactly.** Document code, version, section, page. The
   retired legacy engine had **1 of 3 citations correct**; page numbers drifted
   by 2 and 3 pages. Verify each page against the PDF.

6. **The engine must be pure.** Deterministic, testable, and decoupled from
   React, Next.js, InsForge, OpenRouter, AssemblyAI, filesystem and HTTP. The
   knowledge base must be loadable without any of them.

7. **No operational precedence may be smuggled in as policy.** Any owner-approved
   priority must be stored and displayed separately from the normative source,
   with its own provenance.

8. **Trace every decision.** Rule, condition, fact, evidence reference. A result
   that cannot name its source citation is not shippable.

---

## Tasks

### Task 1 — Transcribe the source into a citable structure

Produce a structured transcription of the normative source. For every normative
statement, capture:

- `section` — the exact section identifier as printed (e.g. `5.2.a`)
- `page` — the PDF page, verified by opening the page
- `verbatim` — the exact wording, unmodified
- `type` — one of: `condition`, `exception`, `counterevidence`,
  `requirement`, `definition`, `procedure`, `temporal`
- `depends_on` — other sections this one modifies, limits, or overrides

Deliverable: `packages/normative/src/source/gdm-gam-prd-mlg-003.json` plus a
human-readable Markdown rendering with the same content.

**Do not** interpret, summarize, or merge statements at this step. If a
statement is ambiguous, record it as ambiguous and flag it. Do not guess.

### Task 2 — Build the rule extraction

From the transcription, derive rules. Each rule must carry:

```ts
interface NormativeRuleV1 {
  id: string;                    // stable, derived from section path, not invented
  statement: string;             // verbatim or minimally normalized
  citation: {
    documentCode: 'GDM_GAM_PRD_MLG_003';
    version: string;
    section: string;             // e.g. '5.2.a'
    page: number;                // VERIFIED against the PDF
  };
  type: 'condition' | 'exception' | 'requirement';
  dependsOn: string[];           // section ids
  conditions: NormativeConditionV1[];
  unknownHandling: 'propagate' | 'block' | 'escalate';
}
```

Rules must be **structurally derived from the document's own hierarchy**, not
from the legacy count. The source has more than 3 normative statements; the
legacy engine implemented 3. Do not reproduce the legacy count.

### Task 3 — Define conditions and three-valued logic

Every condition must be evaluable to `TRUE`, `FALSE`, or `UNKNOWN`, and must
declare what `UNKNOWN` means for it.

Cover explicitly, because the legacy engine got these wrong:

- **Temporal windows.** The source defines time constraints. Model start/end
  dates as first-class, per condition. The legacy engine had no window concept.
- **Counters and thresholds.** Model as data with their source citation, never
  as a bare number in code.
- **Counterevidence and exceptions.** Model which sections negate which. The
  legacy engine had no exception model.
- **Aggregation across conditions.** `AND` / `OR` with `UNKNOWN` propagation.
  `UNKNOWN` in an `OR` with a `TRUE` is `TRUE`; `UNKNOWN` in an `AND` with a
  `FALSE` is `FALSE`; otherwise `UNKNOWN`. State the rule in words and test it.

### Task 4 — Golden cases from the source, not from history

Build golden cases **only** from the source. Historical cases from
`docs/legacy/` are practice, not policy, and may only be used after being
explicitly validated against the source.

For each case, record which source sections it exercises. A case that cannot
cite its sections does not belong in the suite.

### Task 5 — Traceability report

Generate, for every rule and condition:

- source citation
- golden cases covering it
- coverage status
- rules with no case (explicit gaps, not silently omitted)

Output: `docs/reports/normative-coverage-phase1.md`.

---

## Definition of done

- [ ] Every rule cites document code, version, section and a **verified** page.
- [ ] No rule, constant, outcome or classification traces to legacy code.
- [ ] Every condition can evaluate to `UNKNOWN`.
- [ ] Temporal windows and exceptions are modeled, not approximated.
- [ ] Golden cases each cite the source sections they exercise.
- [ ] The knowledge base loads with no web, AI, DB or filesystem dependency.
- [ ] A coverage report exists and names its own gaps.
- [ ] The runtime boundary is still closed: `AUDIT_ENGINE_NOT_IMPLEMENTED`.
- [ ] `typecheck`, `lint`, `test` and `build` pass.
- [ ] The four gates from the clean slate still pass unchanged.

---

## Explicitly out of scope for Phase 1

- A runtime evaluator. The engine stays closed.
- Wiring the knowledge base into any API route, job or UI.
- Persisting normative results to any table.
- AI authoring, suggesting or reviewing rules.
- Any migration or DB change.
- Any change to the PII history debt (requires a separate coordinated action).

---

## Escalation

Stop and report to the owner if:

- The source is ambiguous on a point that changes a rule's meaning.
- A rule cannot be expressed without inventing a concept absent from the source.
- The source appears to contradict itself.
- Implementing something requires reviving a retired legacy construct.

Do not resolve ambiguity by choosing the most likely reading. Record the
ambiguity, its location, and the readings that the source supports.
