# Phase 7 Report

## Current Status

PASS_WITH_WARNINGS

Development Gate: PASS

Live Real-Case Validation: DEFERRED

Production Readiness: NO

## Last Updated

2026-09-23

## Executive Summary

Phase 7 implements the official Dictamen workflow: human review, evidence selection, durable report snapshot, Draft `Dictamen.pdf`, approval, and Final `Dictamen.pdf`, rendered over the canonical official template `templates/Dictamen.pdf`. The machine decision remains immutable; a human correction never overwrites the machine outcome.

The development gate passes: lint, typecheck, tests, and build are green. The migration and the private storage bucket were applied to the live InsForge project. The synthetic E2E fixture is explicitly marked `SYNTHETIC / DEVELOPMENT ONLY` and `NON_PRODUCTION_VALIDATION`; no real expediente was used and no real-case validation is claimed.

Real-case E2E validation remains DEFERRED to the MVP Acceptance Gate (`docs/quality/mvp-acceptance-gate.md`): ORIGINAL EVIDENCE -> ARTIFACT -> FACTS -> FROZEN FACT RUN -> ENGINE RUN -> ACTIONABLE MACHINE RESULT -> TRACE -> HUMAN REVIEW -> SNAPSHOT -> DRAFT -> APPROVAL -> FINAL.

LIVE_REAL_CASE_VALIDATION = DEFERRED

## Development Gate

PASS

Justification:

- `packages/reporting` pure Phase 7 logic exists (26 tests).
- PDF renderer exists over `templates/Dictamen.pdf` with canonical hash `e5c62e10…`.
- Render is deterministic and idempotent; DRAFT and FINAL produce distinct bytes.
- DRAFT carries a BORRADOR watermark; values of example cells are erased.
- `dictamen/service.ts` orchestrates snapshot, approval, draft/final, human review, and evidence selection.
- Snapshot is durable and idempotent by fingerprint (auditId, factRunId, engineRunId, policy, machine/human, comments, selected evidence, template hash, rule trace).
- FINAL is only generated from an approved snapshot; DRAFT is not a FINAL document.
- Human review supports APPROVE and CORRECT; CORRECT requires a mandatory `humanReason`.
- Evidence selection validates that every selected evidence belongs to the audit (cross-audit rejection).
- Migration `20260924110000_phase-7-dictamen-reporting.sql` created the 4 Phase 7 tables in the live InsForge project.
- Private storage bucket `dictamen-reportes` exists for generated PDFs.
- Synthetic E2E fixture exists (`POST /api/dev/synthetic-case`) and is 403-blocked when `NODE_ENV=production`.
- Local synthetic E2E validation passed against `http://localhost:3000` (`NON_PRODUCTION_VALIDATION`).
- 9 reusable frontend components exist and are wired into the audit detail page.
- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.

## Gate Split

Implementation Gate: PASS.

Real-Case Validation: DEFERRED.

Production / MVP Acceptance Gate: NOT_READY.

Deferred real-case validation is centralized in `docs/quality/mvp-acceptance-gate.md` and must pass before MVP/production acceptance.

## Machine Decision

Implemented and immutable.

- `machineOutcome`, `machineDecisionStatus`, and `machineReason` are frozen into the report snapshot from the engine run.
- A human correction (`CORRECT`) records `humanOutcome`/`humanCause`/`humanReason` beside, never replacing, the machine decision.
- PRESERVE_MACHINE_DECISION is enforced: the machine record stored in `human_reviews.machine_decision` is the frozen machine reference captured at review time.

## Human Review

Implemented.

- `POST /api/audits/[auditId]/human-review` registers APPROVE or CORRECT.
- CORRECT without `humanReason` fails with controlled code `MISSING_HUMAN_REASON`.
- Duplicate review for the same audit updates the existing row (one review per audit).
- Persisted: `reviewedBy`, `reviewedAt`, `decisionType`, machine decision frozen.
- The approval of a snapshot requires a registered human review (`HUMAN_REVIEW_REQUIRED` otherwise).

## Evidence Selection

Implemented with provenance preservation.

- `GET/PUT /api/audits/[auditId]/evidence-selection`.
- Server validates each `evidenceId` belongs to the audit; a foreign evidence is rejected (`EVIDENCE_NOT_IN_AUDIT`).
- Selection replaces the previous selection atomically (delete + insert) with originals untouched.
- The snapshot freezes the selected evidence (artifactId, sha256, page, region, cell, originalFilename, selectedAt).

## Report Snapshot

Implemented and durable.

- `POST /api/audits/[auditId]/report-snapshot`.
- Fingerprint covers auditId, factRunId, engineRunId, machine, human, manual comments, selected evidence, policy, and template hash.
- Idempotent: the same fingerprint reuses the existing snapshot; a materially different state creates a new one.
- Snapshot status is `DRAFT` until approved, then exactly one `FINAL` per audit (partial unique index).
- Facts for rendering come from the frozen fact run; AI is not reprocessed (`DO_NOT_REPROCESS_AI_UNNECESSARILY`).

## Draft Dictamen.pdf

Implemented.

- `POST /api/audits/[auditId]/dictamen/draft`.
- Renders over `templates/Dictamen.pdf` (hash-validated).
- Carries BORRADOR watermark; example values are erased.
- Idempotent per document fingerprint; re-running does not duplicate the document.
- Generates a new DRAFT if the snapshot fingerprint changes (new snapshot).

## Approval

Implemented.

- `POST /api/audits/[auditId]/dictamen/approve`.
- Requires an existing snapshot and a registered human review.
- Snapshot transitions DRAFT -> FINAL with `approvedBy` and `approvedAt`.

## Final Dictamen.pdf

Implemented and immutable.

- `POST /api/audits/[auditId]/dictamen/final`.
- Only allowed from an approved (FINAL) snapshot; DRAFT snapshots return `SNAPSHOT_NOT_APPROVED`, approved snapshots return idempotent result.
- Unique index prevents a second FINAL per snapshot kind; bytes are SHA-256 frozen in the document row.
- Download: `GET /api/audits/[auditId]/dictamen/[docId]/download` (authz-protected, streams without caching).

## Synthetic Fixture

Implemented, development only.

- `POST /api/dev/synthetic-case` creates a full synthetic chain (audit, pending evidences, jobs/artifacts, fact run, engine run with actionable decision).
- Tagged `SYNTHETIC_TAG = 'SYNTHETIC / DEVELOPMENT ONLY / NON_PRODUCTION_VALIDATION'`.
- Returns 403 when `NODE_ENV=production`.
- Used for UI/E2E development; it does not close the MVP acceptance gate.

## Local Synthetic E2E Validation

PASS (`NON_PRODUCTION_VALIDATION`)

Command: `node --env-file=.env scripts/e2e-phase7.mjs` from `apps/web` with an in-memory synthetic user session.

Validated route chain against the local dev server:

1. `POST /api/dev/synthetic-case`
2. `POST /api/audits/{auditId}/human-review`
3. `PUT /api/audits/{auditId}/evidence-selection`
4. `POST /api/audits/{auditId}/report-snapshot`
5. `POST /api/audits/{auditId}/dictamen/draft`
6. `POST /api/audits/{auditId}/dictamen/approve`
7. `POST /api/audits/{auditId}/dictamen/final`
8. `GET /api/audits/{auditId}/dictamen/{docId}/download`

Result:

- auditId: `306db6e1-a381-4515-90c4-d2b60701bb18`
- factRunId: `e9addfb5-b63d-48a5-9286-d1f596da0f67`
- engineRunId: `91d7fec3-9a85-4dd9-a601-78b36f1804d0`
- evidenceCount: `2`
- snapshotStatus: `DRAFT`
- approvedStatus: `FINAL`
- draftGenerated: `true`
- finalGenerated: `true`
- finalDocumentId: `66e5c8b6-62b2-420e-82aa-a1a2cb5c0fca`
- finalBytes: `109940`
- finalSha256: `d0e8f5786608f4d3cb798981877404939491e472e3cc678676c809f268c07f9e`

Bug found and fixed during this validation: the download route selected `dictamen_documents.detected_mime_type`, a non-existent column. The route now selects only existing document columns and always streams `application/pdf`.

## Frontend

Implemented: 9 reusable components colocated in `apps/web/src/app/(private)/auditorias/[auditId]/components/`:

- `AuditStatusBadge`
- `MachineDecisionCard`
- `HumanReviewCard`
- `RuleGroupList`
- `MissingItemsPanel`
- `EvidenceSelector`
- `ManualCommentsPanel`
- `ReportPreviewCard`
- `AuditTimeline`

Plus `DictamenWorkflow` (snapshot -> draft -> approve -> final buttons and document list) and shared `components/types.ts`. The audit detail page uses all of them and loads human review, evidence selection, snapshot, documents, and timeline.

## InsForge Migration

PASS

- Migration file: `migrations/20260924110000_phase-7-dictamen-reporting.sql`.
- Applied to live project Cancelaciones (`https://4pw4jdzv.us-west.insforge.app`) via SQL import.
- Verified tables exist: `human_reviews`, `audit_evidence_selection`, `report_snapshots`, `dictamen_documents`.
- Verified helper functions exist: `set_updated_at`, `current_app_role`.
- RLS policies match the prior audit-visibility pattern (creator or OWNER).

## Storage

PASS

- Private bucket `dictamen-reportes` created in the live InsForge project.
- PDFs are written to `dictamen/{auditId}/{snapshotId}/{kind}.pdf`.
- Downloads go through the authenticated API (no public bucket exposure).

## Renderer Validation

PASS

- Smoke render (`apps/web/scripts/smoke-render.mjs`) succeeded: watermark, annex, determinism, and rasterization correct.
- Draft SHA-256: `6f166549d3d261583bd1b2d1e51e4425c9da8370a954ef782bd7bb977d1a872a`.
- Final SHA-256: `abbca1ece3078408cbd4a1785a0ed86a006d4ab9f47a0c9ffe246ca89a83436f`.
- Render unit tests pass (5 tests): valid PDF bytes, page count, DRAFT != FINAL, BORRADOR watermark, example value erasure.

## Trace

League of the frozen snapshot:

- Rule trace references rule IDs, fact IDs, evidence refs, suggested outcome, and decision status.
- Every snapshot links policy, engine run, fact run, template hash, and evidence selection, so any generated document can be traced back through its audit trail.

## Audit Log

Durable events recorded for Phase 7 operations:

- `HUMAN_REVIEW_SUBMITTED`
- `EVIDENCE_SELECTION_UPDATED`
- `REPORT_SNAPSHOT_CREATED`
- `REPORT_SNAPSHOT_APPROVED`
- `DICTAMEN_DRAFT_GENERATED`
- `DICTAMEN_FINAL_GENERATED`

## Tests

PASS

Command: `pnpm test`

Latest result: PASS on 2026-09-23.

- `apps/web`: 34 tests across 7 files (dictamen service 14, authz 4, render 5, policy 5, facts 3, auditorias 2, evidence upload 1).
- `packages/reporting`: 26 tests.
- `packages/policy-engine`: 12 tests.
- `packages/db`: 3 tests.

Coverage highlights:

- CORRECT without reason -> `MISSING_HUMAN_REASON`.
- Evidence not in audit -> `EVIDENCE_NOT_IN_AUDIT`.
- Snapshot idempotent by fingerprint.
- DRAFT does not overwrite an approved snapshot; FINAL only from approved snapshot.
- Draft/Final idempotent re-generation reuses existing documents.
- Authz: 401 no session, 404 unknown audit, 403 cross-audit, allowed for creator.

## Lint

PASS

Command: `pnpm lint`

Latest result: PASS on 2026-09-23 (`--max-warnings=0`).

## Typecheck

PASS

Command: `pnpm typecheck`

Latest result: PASS on 2026-09-23.

## Build

PASS

Command: `pnpm build`

Latest result: PASS on 2026-09-23.

## Security

Current checks:

- no API keys printed in reports: PASS
- no `.env` file tracked except `.env.example`: PASS
- no PII fixtures committed: PASS
- synthetic fixture refuses to run in production: PASS
- `dictamen-reportes` bucket is private: PASS
- PDFs never cached (`Cache-Control: private, no-store`): PASS
- no real Dictamen used as input: PASS
- historical cases untouched: PASS

## Remaining Warnings

- No real expediente E2E was executed; real-case validation stays DEFERRED.
- `NON_PRODUCTION_VALIDATION` only for development; the MVP gate must still be closed with real evidence.
- V5 policy coverage remains partial.
- Missing OWNER normative sources remain blocked.
- Policy effective-date selection remains OWNER ambiguity.
- These warnings block MVP acceptance, production readiness, and operational deployment sign-off until resolved.

## Phase 8 Readiness

YES

Phase 7 implementation supports Phase 8 development; the next phase is provisioned in `docs/phase-prompts/phase-8.md`.

## MVP / Production Gate

NOT_READY

The following remain pending for MVP acceptance (see `docs/quality/mvp-acceptance-gate.md`):

- real original evidence in the live backend
- real artifact processing
- real frozen Fact Run
- real Engine Run
- real machine result with trace to evidence
- real human review
- real snapshot, draft, approval, and final on a real case
- real-case DRAFT/FINAL byte audit

## Documentation Cleanup

CANONICAL REPORT: `docs/reports/phase-7-report.md`

NEXT PHASE PROMPT: `docs/phase-prompts/phase-8.md`

INFORMATION LOSS CHECK: PASS

DUPLICATE REPORTS REMAINING: NO
