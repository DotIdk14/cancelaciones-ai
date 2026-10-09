# Role-Based Human Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Each task ends with focused validation and independent review. Do not start implementation until this plan is reviewed and the worktree is isolated.

**Goal:** Add server-enforced Asesor, Coordinador, and read-only Gerente access, sequential human review, explicit test/real case classification, and role-specific SPA views.

**Architecture:** Keep Google OAuth and the single-package Vite/React app. Derive role capabilities from server-verified `app_memberships`; persist the Asesor and Coordinador decisions separately while leaving the AI assessment untouched; derive workflow state in DTOs. Test cases are explicitly classified and excluded from operational metrics.

**Tech Stack:** TypeScript, React, Vite, Vercel Functions, InsForge/Postgres, Zod, Vitest, SQL migrations.

**Spec:** `docs/superpowers/specs/2026-10-08-role-based-human-review-design.md`

## Global Constraints

- Preserve Google OAuth with server-side PKCE; do not add signup or password login.
- InsForge remains server-side; never introduce `VITE_` or `NEXT_PUBLIC_` secrets.
- `app_memberships` is the authorization source; role resolution fails closed.
- Asesor can access only owned cases; Coordinador can review all cases; Gerente is read-only globally.
- Keep `audits.result_json` as the AI assessment source of truth; human decisions remain separate.
- Persist workflow state; do not rely on process memory.
- Keep `api/` at or below 12 Vercel Functions; currently 12/12, so add no endpoint file.
- Preserve 404 for out-of-scope resources; do not rely on RLS alone because the server uses a privileged client.
- Migrations are forward-only/idempotent and require `scripts/migration-checks/<migration>.checks.json`.
- Never use real operational cases as test fixtures or mutate them in validation.
- Do not commit, push, or alter host configuration as part of this plan without explicit authorization.

## Review Focus

1. Forged role, actor, reviewer name, or case kind in request bodies must never grant access or falsify attribution — test each relevant API schema/handler.
2. A user/Asesor accessing another owner's case must receive 404 on reads and writes — exercise every case-scoped endpoint and the shared fake store.
3. Gerente must not mutate any resource even if it can read it — test direct API calls, not just hidden UI controls.
4. Partial/duplicate/retried review submissions must not overwrite the Asesor decision or create conflicting final decisions — test idempotency/conflict semantics and durable state.
5. Test cases must not appear in operational dashboard totals, filter options, or real-case queues — test list and dashboard query paths, including row limits.

---

### Task 1: Isolated branch and baseline

**Files:** None initially.

**Interfaces:**
- Consumes: approved spec and this plan.
- Produces: isolated branch/worktree for all implementation and validation.

- [ ] **Step 1: Check repository state and active work**

Run `git status --short --branch` and inspect `git worktree list`. Identify unrelated modifications and do not overwrite or clean them.

- [ ] **Step 2: Create an isolated worktree/branch**

Use the approved worktree workflow and a descriptive branch such as `feat/role-based-human-review`. Keep worktree and branch separate from concurrent sessions. If the target branch/worktree already exists or repository state changes unexpectedly, stop and report rather than force-switching.

- [ ] **Step 3: Verify branch and baseline**

Run `git status --short --branch`, inspect recent history, and run focused baseline tests: `npm test -- --run tests/security-regressions.test.ts tests/human-review.test.ts tests/cases-list.test.ts`. Record any pre-existing failure before edits.

Expected: clean isolated worktree; baseline result captured. Do not create a commit.

### Task 2: Role and capability contract

**Files:**
- Modify: `src/server/auth.ts`
- Modify: `api/auth/[action].ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/useSession.ts`
- Test: `tests/helpers/auth.ts`
- Test: `tests/auth-smoke.test.ts` and focused auth tests

**Interfaces:**
- Consumes: existing `requireAuth` and membership role lookup.
- Produces: persisted `AppRole = 'user' | 'coordinator' | 'manager'` (`user` is displayed as Asesor) and an `AuthContext` capability contract: `canReadAllCases`, `canReviewOwnCases`, `canFinalizeAnyCase`, `canWriteOwnedCases`. Gerente has read-only capabilities; unknown DB roles deny access.

- [ ] **Step 1: Add failing tests for each role and unknown role**

Assert membership mapping, capability values, and fail-closed behavior. Existing `user` memberships retain their stored role and receive Asesor capabilities.

- [ ] **Step 2: Run focused auth tests and confirm failure**

Run `npm test -- --run tests/auth-smoke.test.ts` (plus the specific auth test file discovered in the worktree). Expected: new assertions fail because manager/advisor capabilities are absent.

- [ ] **Step 3: Implement server role/capability mapping**

Derive capabilities once from the server-verified role. Do not accept role or actor from client input. Decide and test the persisted role identifiers consistently with Task 3's migration; map existing `user` memberships to advisor semantics without temporarily granting broader rights.

- [ ] **Step 4: Return role in the existing refresh/session response**

Extend the existing auth refresh response and SPA session DTO with role. Do not add an API Function. The browser role is presentation-only and must not replace server checks.

- [ ] **Step 5: Run focused auth tests**

Run `npm test -- --run tests/auth-smoke.test.ts` and the specific role mapping tests. Expected: PASS; unknown roles remain denied.

### Task 3: Forward-only schema migration and migration checks

**Files:**
- Create: next lexically/temporally valid `migrations/*_human-review-roles-case-kind.sql`
- Create: `scripts/migration-checks/<same-migration-basename>.checks.json`
- Test: migration contract/check tests and SQL assertions

**Interfaces:**
- Consumes: role identifiers and review fields defined in Task 2 and Task 4.
- Produces: DB constraint admitting existing `user`, `coordinator`, and new `manager` roles without rewriting live membership rows; separate coordinator review fields; and a test-case flag on `cases` aligned with the existing `docs/superpowers/plans/2026-10-06-case-test-flag.md` design (`cases.is_test boolean not null default false`); existing cases default to real.

- [ ] **Step 1: Inspect actual migration ordering and checks format**

Read latest migrations, `scripts/apply-migration.mjs`, and neighboring migration check JSON. Confirm role CHECK and case review schema from migrations, not only the stale docs.

- [ ] **Step 2: Write failing migration/schema assertions**

Cover allowed role identifiers, preservation of existing membership rows, review columns/constraints, default `REAL`, and rejection of invalid case kinds. Do not connect tests to production.

- [ ] **Step 3: Implement idempotent forward-only SQL**

Expand the membership role constraint to retain existing `user` and `coordinator` values and admit `manager`; do not rewrite live memberships. Add separate coordinator decision (`APPROVE | CHANGE`), final resolution, actor UUID, timestamp, and optional comment fields to the live review representation, plus consistency checks where feasible. `APPROVE` must retain the Asesor resolution; `CHANGE` records the different final resolution. Add the case kind default/check. Do not alter `audits.result_json` or reuse `COMPLETED` for human workflow.

- [ ] **Step 4: Add migration checks compatible with the actual migration runner**

The runner executes statements individually and substitutes checks JSON for the source `$verify$` block. Ensure checks detect partial application and assert the exact constraints/columns; include a safe rerun check.

- [ ] **Step 5: Run migration validation without applying to production**

Run the repository's migration/check tests and SQL static validation available in the project. Expected: PASS. Applying the migration to the real backend is a separate gated operation; do not do it during local automated tests.

### Task 4: Durable two-stage review flow

**Files:**
- Modify: `src/server/reviews.ts`
- Modify: `src/server/comparison-service.ts`
- Modify: `src/server/cases.ts`
- Modify: `src/server/dto.ts`
- Modify: `src/skills/review/schema.ts` and `src/skills/review/types.ts`
- Modify: `api/cases/[caseId]/review/index.ts`
- Test: `tests/human-review.test.ts`, `tests/reviews-persistence.test.ts`, `tests/security-regressions.test.ts`, `tests/helpers/fake-store.ts`

**Interfaces:**
- Consumes: `AuthContext` capabilities (Task 2) and migrated schema (Task 3).
- Produces: review DTO containing separate advisor/coordinator decisions and derived workflow state `PENDING_ADVISOR | PENDING_COORDINATOR | FINALIZED`; exact naming should follow project conventions and be used consistently.

- [ ] **Step 1: Add failing tests for stage transitions and attribution**

Test no review → advisor pending; advisor submission → coordinator pending; coordinator submission → finalized; advisor cannot submit twice/overwrite; coordinator cannot finalize twice; server-derived actor/timestamp; Gerente cannot submit; Coordinator cannot submit as Advisor. Define retries as idempotent only when identical request semantics are safe; otherwise return a stable conflict without changing stored decisions.

- [ ] **Step 2: Run targeted human review tests and confirm failure**

Run `npm test -- --run tests/human-review.test.ts tests/reviews-persistence.test.ts`. Expected: new two-stage tests fail against the single-review implementation.

- [ ] **Step 3: Implement role-specific review commands and persistence**

Keep Asesor and Coordinador decisions separately immutable. Derive actor from authenticated `sub`, timestamp from server, and display attribution from trusted membership/session data; stop treating `reviewerName` from the request as authoritative. Preserve AI result immutability and existing comparison behavior unless tests show it must be separated from coordinator finalization.

- [ ] **Step 4: Implement case-scope and capability guards**

Replace role-blind `assertCaseOwner` call sites with explicit read/write/review/finalize guards. Asesor writes only owned cases; Coordinador finalizes any case; Gerente reads globally but has no mutation capability. Update fake-store helpers in lockstep with production semantics.

- [ ] **Step 5: Derive workflow status in DTOs**

Compute status from persisted review steps. Do not mutate `cases.status` or use audit `COMPLETED` to mean workflow finalization.

- [ ] **Step 6: Run focused review and security regression tests**

Run `npm test -- --run tests/human-review.test.ts tests/reviews-persistence.test.ts tests/security-regressions.test.ts`. Expected: PASS, with assertions updated to the approved coordinator finalization capability and advisor ownership boundary.

### Task 5: Case ownership, case kind, and dashboard scope

**Files:**
- Modify: `src/server/cases.ts`
- Modify: `src/server/dashboard.ts`
- Modify: `src/server/dashboard-filters.ts`
- Modify: `src/server/dto.ts`
- Modify: `api/cases/index.ts`
- Test: `tests/cases-list.test.ts`, `tests/dashboard*.test.ts`, `tests/helpers/fake-store.ts`

**Interfaces:**
- Consumes: role capabilities and review workflow DTO.
- Produces: `CaseSummary`/detail DTO with `isTest` and workflow state; dashboard queries/options scoped and filtered server-side (test cases excluded via the `applyTestScope` helper applied BEFORE count/limit, per `docs/superpowers/plans/2026-10-06-case-test-flag.md`).

- [ ] **Step 1: Add failing tests for case kind and visibility**

Test create input accepts only a boolean `isTest` (strict, never coerced from arbitrary text), rejects forged ownership/role/actor fields, defaults an omitted flag to real, and lists only advisor-owned cases. Test coordinator/manager global read; manager mutation denial is covered at API layer.

- [ ] **Step 2: Add failing tests for test-case dashboard exclusion and filter options**

Test TEST cases are excluded from operational counts and dimension options. Include more rows than `DASHBOARD_MAX_ROWS` with cross-owner data to verify scope/filter happens before limit and no undercount/foreign dimension leak occurs.

- [ ] **Step 3: Implement server-side `isTest` parsing and DTO propagation**

Validate with strict Zod before DB writes. Keep owner, actor, and role server-derived. Project kind/state into list and detail responses.

- [ ] **Step 4: Fix dashboard authorization and test filtering**

Pass authenticated scope into filter-option queries. Apply owner and `REAL` predicates in SQL before row limits; ensure coordinator/manager global reads do not accidentally include TEST rows in operational metrics.

- [ ] **Step 5: Run case and dashboard tests**

Run `npm test -- --run tests/cases-list.test.ts tests/dashboard.test.ts tests/dashboard-db.test.ts tests/dashboard-filters.test.ts tests/dashboard-dimensions.test.ts`. Expected: PASS.

### Task 6: Role-specific SPA views and review UI

**Files:**
- Modify: `src/lib/api.ts`, `src/lib/useSession.ts`, `src/lib/labels.ts`
- Modify: `src/App.tsx`, `src/lib/useHashRoute.ts`, `src/components/AppNav.tsx` (verify actual path)
- Modify: `src/components/CaseReviewPanel.tsx`, `src/components/CaseDetailPage.tsx`, `src/components/CasesPanel.tsx`, `src/components/NewCasePanel.tsx`
- Test: `tests/login-screen.test.ts`, `tests/routes.test.ts`, `tests/hash-route.test.ts`, `tests/CaseReviewPanel.test.ts`, `tests/CasesPanel.test.ts`, `tests/NewCasePanel.test.tsx`, `tests/CaseDetailWorkspace.test.ts`

**Interfaces:**
- Consumes: role/session DTO and case/review DTOs from Tasks 2, 4, 5.
- Produces: role-gated navigation and controls; explicit case kind selector; review stage panels for Asesor and Coordinador; read-only global Gerente view.

- [ ] **Step 1: Add failing UI tests for role navigation and controls**

Assert Asesor sees own-case workflow and no global views, Coordinador sees all cases and finalization controls, Gerente sees all cases but no mutation controls. Verify direct route rendering still relies on API authorization.

- [ ] **Step 2: Add failing tests for two review stages and case kind selector**

Assert advisor decision is shown as immutable after submission; coordinator can maintain/change resolution; final state is displayed; selector clearly distinguishes test and real case.

- [ ] **Step 3: Implement session role and role-aware navigation**

Use role only for presentation; don't treat hash-route guards as security boundaries. Keep existing login/preview behavior intact or explicitly disable preview for real-user validation.

- [ ] **Step 4: Implement stage-specific review controls and labels**

Show only actions permitted by the role and current persisted workflow state. Display attribution from server response. Gerente receives read-only controls even on direct case detail routes.

- [ ] **Step 5: Implement case kind selector and visible labels**

Make the choice explicit on case creation, show persistent classification in case list/detail, and avoid ambiguous demo/real styling or copy.

- [ ] **Step 6: Run focused SPA tests**

Run the named UI tests above. Expected: PASS; test for keyboard operation and semantic labels of the selector and decision controls.

### Task 7: Provisioning docs, cleanup of dead paths, and regression coverage

**Files:**
- Modify: `AGENTS.md`, relevant `docs/DATABASE.md`, `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md` (verify actual docs)
- Review/remove only if confirmed unused: `src/server/human-review.ts`, `src/components/HumanReviewPanel.tsx`, `src/skills/review-schema.ts`
- Test: `tests/security-regressions.test.ts` and any contract tests affected

**Interfaces:**
- Consumes: final role identifiers, workflow, and case-kind contracts from prior tasks.
- Produces: accurate operator docs, membership provisioning procedure, and no misleading unused human-review implementation.

- [ ] **Step 1: Verify all imports/callers of suspected legacy review paths**

Use code search and tests; delete only files proven dead, or document why retained. Do not copy legacy schema semantics into live flow.

- [ ] **Step 2: Update authorization and operational documentation**

Document membership role assignment, permissions, migration order/checks, local DB behavior, and test-vs-real case handling. Never include real user identifiers, credentials, tokens, or PII.

- [ ] **Step 3: Add/complete role × action API matrix tests**

Cover Asesor own/other, Coordinator own/other, Gerente read/global mutation, unknown role, and direct endpoint access for each mutation family using synthetic fixtures.

- [ ] **Step 4: Run focused documentation/contract and security tests**

Run relevant contract and regression tests. Expected: PASS; no authorization path is tested only via UI.

### Task 8: Migration rehearsal and real-backend demo-user provisioning

**Files:** None unless migration checks need corrections.

**Interfaces:**
- Consumes: completed application/migration tasks and explicit demo identity details.
- Produces: verified migrated backend and three demo identities (one per role) only if the secure supported provisioning method and identities are available.

- [ ] **Step 1: Verify current target and membership state without exposing PII**

Use the approved InsForge read-only tooling; report only counts/role categories, not emails or tokens. If project identity/target cannot be verified, stop.

- [ ] **Step 2: Rehearse migration and checks in a non-production target**

Apply to a staging/test backend first if available; verify idempotence and checks. Do not infer safety from SQL text alone because the current runner executes statements individually.

- [ ] **Step 3: Obtain/confirm three demo identities and provisioning mode**

Create no passwords or external auth credentials. Use Google OAuth identities that the user controls and the supported InsForge membership admin workflow. If demo users would be added to the live DB, present the exact identities/role assignments and effects for explicit confirmation before writes.

- [ ] **Step 4: Apply the approved production migration and memberships only after confirmation**

This is a HIGH_RISK database/auth change. Capture redacted command/result evidence, verify migration checks and rollback/forward-recovery procedure, and stop on partial application or unexpected membership values.

Expected: migration schema checks pass; three demo memberships are correctly role-assigned only after explicit confirmation. No real cases are created or modified by provisioning.

### Task 9: Local browser walkthrough and release validation

**Files:** None unless issues are found, then return to owning task.

**Interfaces:**
- Consumes: completed implementation and approved demo identities.
- Produces: validated local walkthrough against real backend, with no unapproved real-data writes.

- [ ] **Step 1: Check existing local processes and environment target**

Identify project-owned Vite/API processes; do not kill any process without proving ownership. Verify local API points to intended InsForge target without printing secrets. Confirm secure cookie behavior on localhost before relying on OAuth session.

- [ ] **Step 2: Start the local app and open the explicit browser tab**

Start Vite bound to localhost/127.0.0.1 (not externally exposed) and open the local URL in the browser. Use the live authenticated flow, not `?preview=dashboard` DEMO mode, for role validation.

- [ ] **Step 3: Walk through three demo roles**

Verify advisor owns-only, coordinator global review/finalization, manager global read-only, test/real selector and labels, test-case dashboard exclusion. Use only approved synthetic TEST cases; never edit real operational cases.

- [ ] **Step 4: Run focused package checks and closing scanners**

Run affected test groups, then `npm run typecheck`, lint, and build if scripts exist. Run `gitleaks detect --source . --redact` because this public repository has that trigger. No dependency change is planned; run dependency scanning only if manifests/lockfiles change.

- [ ] **Step 5: Independent security/code review**

Have `seguridad-apis` and `seguridad-owasp` assess authorization/API changes; `revisor-codigo` independently review the final diff and real DB/migration risks. Resolve all high/critical findings through the required escalation process before closure.

- [ ] **Step 6: Report results without committing**

Report branch, browser walkthrough outcome, actual validation commands/results, security gates, migration/provisioning status, and any unresolved risks. Do not commit or push unless explicitly requested.

## Execution notes

- The feature spans related auth, database, API, dashboard, and UI behavior; keep the work sequential where contracts are shared. Independent review/security analysis may run in parallel only after the implementation diff stabilizes.
- User requested “Space Bunny Free” for subagents. Before dispatch, resolve the exact model with the model catalog and verify availability. Do not silently substitute another provider/model; if unavailable twice, ask the user.
- The plan recommends subagent-driven execution with one implementer per task and independent review at task boundaries. The security and migration tasks require explicit HIGH_RISK gates.
- The user approved operating local UI against the real DB, but that is not blanket approval to run tests that mutate live business data. Migration, membership provisioning, and each live write remain separately gated and must use approved synthetic demo identities/data.
