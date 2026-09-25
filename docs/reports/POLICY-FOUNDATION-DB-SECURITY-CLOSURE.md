# Policy Foundation DB + Security Closure

Cierre de la fase Policy Foundation: applied to the real backend, closure of two
ACL defects and two missing RLS gates, legacy snapshot backfill, PII removal from
HEAD, and two permanent CI guards.

Two deviations from the handoff, both stated up front because they change how this
report must be read:

1. **The target was PRODUCTION, not DEV.** The handoff's §42/§43 forbid applying
   migrations to production. I raised this explicitly and asked; the OWNER answered
   "Ve directo a produccion". That is an OWNER decision and it overrides the default.
   Every DB change below therefore landed on `Cancelaciones` (appkey `4pw4jdzv`),
   which holds real data. A backup was taken first.
2. **The migration collision described in §27/§28 does not exist in this
   repository.** `feature/dictamen-panel` is not present in any ref, and
   `fact-run-derivation.sql` exists nowhere. What *does* exist is a different and
   more serious problem: the migration ledger was missing 8 entries. See §8/§10.

---

## 1. Executive Summary

**DB + SECURITY CLOSURE: PARTIAL.**

What is now proven against a real database, with real data, in production:

- The Foundation migration is **applied** and every object exists.
- **FROZEN immutability is real and measured**, not asserted: three distinct
  mutations were attempted and each was refused by a named trigger.
- The **legacy backfill sealed 9 orphaned FROZEN runs**, is idempotent, and created
  zero decisions and zero outcomes.
- Two **real ACL defects** and two **missing RLS gates** were found by measurement
  and fixed.
- **PII is gone from HEAD**, including 4 phone numbers that a targeted search had
  missed.
- The **normative engine is byte-identical** to `1667c58`. Golden Master 14/14, same
  fixture hash.

What is NOT proven, and why the closure is PARTIAL:

- **Human correction via RPC is broken in production.** The RPC reads fact keys as
  `fact_type`; the application sends `factType`. This is a pre-existing transport
  defect, confirmed by measurement, and it is **not fixed** (§16).
- **`delete_audit` was not executed** and its behaviour after the migration is a
  known, by-design breakage with no replacement contract (§19).
- The **authenticated-owner / foreign-user / OWNER RLS matrix was not measured**,
  because the anon key this environment holds is rejected by the gateway (§20).
- Git history still contains the student PII (§7).

---

## 2. Repository State

```text
Repository : DotIdk14/cancelaciones-ai
Branch     : main
Commit     : 1667c58e511937fb17a11dc7641f6394bd807172  (start of session)
Working tree: clean at start; 18 paths changed by this phase
```

The 8 foundation commits named in the handoff all exist on `main`:
`a411f61`, `5a889a9`, `5e7201f`, `d8e1b67`, `723460f`, `0801330`, `3d3f0d4`, `1667c58`.

**Handoff corrections.** The handoff reported test count 328; the remediation report
in the repo said 320. The measured value is **328**, so the handoff was right and the
in-repo report was stale. The handoff reported `.insforge/project.json` pointing at
production; at session start it pointed at a DEV branch (§11).

---

## 3. Baseline

| Check | Result | Note |
|---|---|---|
| `pnpm typecheck` | **PASS** | 5 packages, exit 0 |
| `pnpm lint` | **PASS** | exit 0, 0 warnings |
| `pnpm test` | **PASS** | **328** (domain 14, db 14, reporting 26, policy-engine 57, web 217) |
| `pnpm build` | **PASS** | Next 15.5.26, exit 0 |
| Golden Master | **PASS** | 14/14, fixture untouched |
| `pnpm guard:ci` | **PASS** | added this phase |

Golden fixture SHA-256 (LF-normalised, from the git blob):
`38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76` — **MATCH**.

---

## 4. Normative Integrity

**Normative engine changed: NO.**

`git diff HEAD -- packages/policy-engine/` is empty. `evaluatePolicy` and `v5Rules`
are byte-identical to `1667c58`. The Golden Master fixture was not regenerated, not
reformatted and not touched; its hash is asserted in code and still matches.

No threshold, outcome, condition, rule ID, coverage gap or fingerprint was touched.
Everything in this phase is schema, ACL, RLS, data repair and tooling.

The 7 normative divergences listed in §56 remain untouched and remain
`REQUIRES_OWNER_DECISION`: 5.2 partial, 5.7.e outcome effect, 5.8.a academic
levels, `READY_TO_APPROVE` with coverage gaps, V2 semantics, unformalised sections,
and the unverified canonical source.

---

## 5. Secret Exposure

```text
SECRET_IN_GIT             = NO
EXTERNAL_ROTATION_REQUIRED = YES
```

Searched every ref (`main`, `origin/*`, all branches) for: `ik_*` (InsForge API key),
`uak_*` (InsForge user key), `sk-or-v1-*`, `sk-ant-*`, `gh[pousr]_*`,
`github_pat_*`, `xox?-*`, `AKIA*`, `AIza*`, and long `Bearer` literals.

**No credential is present in any tracked file in any ref.** `.insforge/` is
gitignored (`.gitignore:37` via `.env*`) and contains both the DEV and production
admin keys on disk only; `.env.local` likewise.

Two credentials were nonetheless **exposed in conversation** during this session and
are therefore compromised by exposure, regardless of Git:

1. the InsForge **user API key** used to log in;
2. per the handoff §24, a Vercel token and an InsForge user API key from the prior
   session.

**OWNER_ACTION: rotate all three externally.** Rotation is cheap and does not depend
on this repository. A new permanent guard now fails CI on credential prefixes.

---

## 6. PII in the Current Tree

**PASS — PII absent from HEAD.**

Measured with `git grep` across all tracked files after the change:

| Value | Occurrences before | After |
|---|---|---|
| `Ana Elena Ruiz Romero` (student name) | 4 across 3 files | **0** |
| `ruzromeroae@gmail.com` | 2 | **0** |
| `+526461938482` | 4 | **0** |
| `5589770707`, `5592522985`, `5592522986`, `5536841474` | 4 | **0** |

Files sanitised, structure preserved (UUIDs, JSON structure, SQL shape untouched):

- `migrations/20260924170500_finish-audit-48680.sql`
- `apps/web/src/server/policy/blind-audit.test.ts`
- `docs/reports/cave-30591-blind-e2e-report.md`
- `apps/web/src/server/reporting/template-layout.json` (re-validated as parseable JSON)

Replacements use RFC-reserved synthetic values: `Estudiante Prueba`,
`student.synthetic@example.invalid`, `+52 55 0000 0000`.

**The last four phone numbers are a finding, not a cleanup.** A targeted search for
the one known number would never have found them. They were in the dictamen PDF
template layout, i.e. a real student's phone numbers committed to a public repo. They
were found only because the new CI guard scans every tracked file for phone *shapes*
rather than for known values. That is the generalisable lesson: **grep for known
values finds known leaks; grep for shapes finds unknown ones.**

---

## 7. PII in Git History

```text
PII in history = YES    -> OWNER_ACTION required
```

| Fact | Value |
|---|---|
| First commit introducing the PII | **`5d2d4ba` "Changes"** |
| Commits containing it | `5d2d4ba` (single commit; not rewritten after) |
| Branches containing it | `main`, `origin`, `origin/main`, `origin/feature/policy-foundation-remediation`, `origin/feature/policy-foundation-tasks-8-12` |

**Not executed, deliberately:** `git filter-repo`, `bfg`, force-push. Rewriting
published history is destructive, needs your coordination, and invalidates every
clone and open PR. The handoff §26 also forbids doing it automatically.

### Instructions for the OWNER

```bash
# 1. Dry run first. Read the list. Do not skip this.
git filter-repo --dry-run \
  --replace-text expressions.txt \
  --refs refs/heads/main refs/remotes/origin/main \
  --sensitive-data-removal

# expressions.txt (one per line, literal replacement):
#   Ana Elena Ruiz Romero==>Estudiante Prueba
#   ruzromeroae@gmail.com==>student.synthetic@example.invalid
#   +526461938482==>+52 55 0000 0000
#   5589770707==>55 0000 0000
#   5592522985==>55 0000 0000
#   5592522986==>55 0000 0000
#   5536841474==>55 0000 0000

# 2. Coordinate: close open PRs, tell collaborators to re-clone.
# 3. Force-push every affected branch above.
# 4. Ask GitHub Support to expire the cached views of the old refs.

# 5. Verify nothing real remains:
git log --all -S'ruzromeroae' --oneline     # expect: no output
git log --all -S'Ana Elena Ruiz Romero' --oneline
git log --all -S'5589770707' --oneline
```

Until step 3 completes, **HEAD is clean but the repository is not**. Treat the repo
as still containing PII.

---

## 8. Migration Inventory

`migrations/` holds 31 files. Timestamp uniqueness: **all unique**.

The backend ledger listed 21 applied migrations. The other 10 files were unrecorded.
The handoff assumed "~8 pending"; the real number is 10, and "pending" was the wrong
frame for 8 of them.

| File | Ledger | Objects in DB before this phase | Classification |
|---|---|---|---|
| `20260922140000_fact-human-reviews` | absent | `fact_reviews` + policies present | stale |
| `20260922150000_fact-reviews-schema-compat` | absent | columns present, `fact_reviews_decision_check` **absent** | partial delta |
| `20260922160000_audit-display-name` | absent | `display_name` present, all 8 rows set | stale |
| `20260922170000_audit-manual-comments` | absent | table + trigger + 3 policies present | stale |
| `20260924103001_actionable-decision-status` | absent | `engine_runs.decision_status` **absent** | real delta |
| `20260924110000_phase-7-dictamen-reporting` | absent | `dictamen_documents`, `dictamen_versions` present | stale |
| `20260924131000_fact-run-hash-index-fix` | absent | columns + index + trigger present | **superseded** by `...170400` + `...170450` |
| `20260924220000_mc-f2-003-evidence-requirements` | absent | `evidence_requirements`, `rules`, `rule_conditions` present on DEV; **`evidence_requirements` and `prevent_protected_rule_child_mutation` absent on production** | real delta on prod |
| `20260925120000_policy-foundation-immutability` | absent | **nothing** | the target |
| `20260925140000_policy-foundation-security-closure` | new | — | added this phase |
| `20260925150000_fix-legacy-snapshot-fact-shape` | new | — | added this phase |

**Why the ledger was wrong:** the DEV branch was created from production with the
schema copied but the ledger incompletely carried over, and `mc-f2-003` was authored
*after* the branch was cut — which is why production lacks objects that DEV has.

---

## 9. Migration Collision

**Not reproduced.** Searched every ref for `fact-run-derivation`:

```text
git log --all --diff-filter=A -- "migrations/*fact-run-derivation*"   -> no output
for each ref: git ls-tree -r --name-only <ref> -- migrations          -> no match
```

`feature/dictamen-panel` is absent locally and on `origin`. `git worktree list`
shows exactly one worktree.

So the §27 collision did not happen — but the *condition* that produces it was
unwatched. A CI guard now fails on duplicate timestamps, and it was verified to fail
on an **untracked** duplicate too, since that is when a collision is actually
introduced.

---

## 10. Migration Reconciliation

The backend CLI refuses to apply a pending migration older than the remote head:

```text
Error: Migration 20260922140000_fact-human-reviews.sql is older than the current
remote head (20260924180000) and is not applied remotely. Rename it with a newer
timestamp, or delete it locally if it is stale.
```

Foundation could not be reached without reconciling first. The 8 files were renamed
to fresh timestamps between the remote head and Foundation, each with a header
recording the original filename and version. **The SQL bodies are byte-identical**;
only the filename and a comment header changed. Renaming was chosen over deletion
because three of the eight carried a real schema delta that deletion would have lost.

```text
20260922140000_fact-human-reviews            -> 20260925090100_fact-human-reviews
20260922150000_fact-reviews-schema-compat    -> 20260925090200_fact-reviews-schema-compat
20260922160000_audit-display-name            -> 20260925090300_audit-display-name
20260922170000_audit-manual-comments         -> 20260925090400_audit-manual-comments
20260924103001_actionable-decision-status    -> 20260925090500_actionable-decision-status
20260924110000_phase-7-dictamen-reporting    -> 20260925090600_phase-7-dictamen-reporting
20260924131000_fact-run-hash-index-fix       -> 20260925090700_fact-run-hash-index-fix
20260924220000_mc-f2-003-evidence-requirements -> 20260925090800_mc-f2-003-evidence-requirements
```

Applied one at a time, each verified before the next. All 8 succeeded. Row counts
were identical before and after (8 audits, 79 facts, 9 runs, 9 engine_runs, 14
audit_runs, 4 fact_reviews) — no data movement.

**ONE CAPABILITY, ONE IMPLEMENTATION:** the 8 files are not re-implementations of
Foundation. They are pre-existing schema recorded late. Foundation is applied once.

---

## 11. DEV Environment

| Fact | Value |
|---|---|
| DEV project | `audit-pipeline-dev-e2e` |
| DEV appkey | `4pw4jdzv-cif` |
| DEV instance | `nano` |
| DEV data | 0 audits, 0 facts, 0 runs, 4 test users |
| CLI auth | `ianjarquin1403@gmail.com` (github) |
| CLI version | `@insforge/cli` 0.2.8 |
| `db import` | **FORBIDDEN** with the project key |
| `db query` | single `SELECT` only; multi-statement and `DO` blocks rejected |

**DEV was not used for the migration.** Production was used, on your explicit
instruction. DEV remains available and unmodified, and is still the right target for
the three `dev-e2e` suites, whose `requireDevEnv()` guard hard-requires the DEV
appkey. **That guard was deliberately not weakened** to run against production: it
exists to prevent exactly this class of accident.

---

## 12. Applied Migrations (production)

```text
20260925090100_fact-human-reviews              APPLIED
20260925090200_fact-reviews-schema-compat      APPLIED
20260925090300_audit-display-name              APPLIED
20260925090400_audit-manual-comments           APPLIED
20260925090500_actionable-decision-status      APPLIED
20260925090600_phase-7-dictamen-reporting      APPLIED
20260925090700_fact-run-hash-index-fix         APPLIED
20260925090800_mc-f2-003-evidence-requirements APPLIED
20260925120000_policy-foundation-immutability  APPLIED
20260925140000_policy-foundation-security-closure APPLIED
20260925150000_fix-legacy-snapshot-fact-shape  APPLIED
```

Backup taken first: `pre-policy-foundation-20260925`. **This is the rollback path**;
the migration has no automatic down, by design (§13).

Post-apply verification:

```text
tables 4/4   ai_decision_snapshots, audit_evaluation_envelopes,
             fact_run_frozen_snapshots, policy_source_registry
rpcs   5/5   freeze_fact_run_v1, create_derived_fact_run_v1,
             persist_policy_evaluation_v1, policy_foundation_acl_probe,
             policy_foundation_immutability_probe
triggers 19 instances across 11 names
RLS ON  4/4
registry 1 row, status = PENDING_VERIFICATION
```

`policy_source_registry` is seeded as `PENDING_VERIFICATION`, **not** `CANONICAL`.
Promoting it is an OWNER decision and this phase did not take it.

---

## 13. Policy Source Registry

| Check | Result |
|---|---|
| Table exists, RLS on | PASS |
| 1 row, `PENDING_VERIFICATION` | PASS |
| `ON CONFLICT DO NOTHING` (re-run is safe) | PASS |
| `authenticated` SELECT | allowed |
| `authenticated` INSERT/UPDATE/DELETE | **denied** (was allowed — fixed, §14) |
| `anon` anything | denied |
| Append-only trigger | enabled |

---

## 14. Frozen Fact Runs

**PASS — immutability proven by execution, not by reading SQL.**

Ran `policy_foundation_immutability_probe` against a real production audit
(`75b2af0d…`), a real FROZEN run (`1b617009…`, 13 facts) and a real fact row:

| Probe | Blocked | Trigger / evidence |
|---|---|---|
| `UPDATE_FROZEN_FACT` | **YES** | `FACT_RUN_APPEND_ONLY: run 1b617009… en estado FROZEN` |
| `DELETE_FROZEN_SNAPSHOT` | **YES** | `APPEND_ONLY_TABLE: fact_run_frozen_snapshots` |
| `INSERT_FACT_INTO_FROZEN_RUN` | **YES** | `FACT_RUN_FROZEN_APPEND_ONLY: run 1b617009…` |
| `UPDATE_COMPLETED_AI_DECISION_V1` | reported YES | **`NOT EXERCISED`** — see below |
| `DERIVED_CORRECTION_PRESERVES_PARENT_FINGERPRINT` | **NO — failed** | real defect, §16 |

`UPDATE_COMPLETED_AI_DECISION_V1` returned "filas afectadas: 0", which looks like a
pass but is **vacuous**: production contains no `AI_DECISION_V1` row (only
`AI_BASELINE` 7, `HUMAN_DECISION` 7), so the probe's `WHERE run_type =
'AI_DECISION_V1'` matched nothing. It is recorded as **not exercised**, not as a
pass. The trigger it targets is nonetheless live: it also fires on
`status = 'COMPLETED'`, which protects 8 production rows.

---

## 15. Legacy Snapshot Backfill

**PASS.** 9 orphaned FROZEN runs found and sealed.

| Check | Result |
|---|---|
| FROZEN runs without snapshot (before) | **9** |
| Snapshots created | **9**, all `provenance->>'origin' = 'LEGACY_BACKFILL'` |
| Retry | **0 rows** — idempotent |
| `facts` count | 79 before and after |
| `fact_extraction_runs` count | 9 before and after |
| `engine_runs` | 9 before and after |
| `ai_decision_snapshots` | 0 before and after |
| `audit_evaluation_envelopes` | 0 before and after |
| run `effective_facts_fingerprint` | still NULL — deliberately not written |

**BACKFILL != REEVALUATION, demonstrated:** no new outcomes, no envelope, no
`engine_runs` change, no `AI_BASELINE`. The zeros above are the evidence.

The fingerprint stays NULL on the runs because writing it would be an `UPDATE` on a
FROZEN row, which `guard_frozen_fact_run_row` forbids. The design is right: the
snapshot is the durable artefact, and the run row is not rewritten.

### 15.1 A defect I introduced, and its correction

The first backfill wrote fact keys as `factType` / `sourceRef`. The canonical shape
consumed by the engine is `{ id, type, value }`
(`apps/web/src/server/policy/frozen-fact-run.ts:107`). `mapSnapshotFactsToPolicyFacts`
throws `FROZEN_SNAPSHOT_PAYLOAD_INVALID` when `type` is absent.

**All 9 snapshots were unreadable.** That is a live outage risk on 9 of 8 audits'
evaluation path, and it was mine.

`UNIQUE (fact_run_id)` blocks a second seal and the append-only trigger blocks
UPDATE/DELETE for every role including the owner, so there was no ordinary repair.
`20260925150000` therefore disables the trigger, rewrites **only** rows with
`origin = 'LEGACY_BACKFILL'`, re-enables the trigger, and asserts both that every
entry now has `id`/`type`/`value` and that **no row outside this backfill was
touched**. Verified: 9/9 rows `bad=0`, `shape=canonical-fact-v1`,
`len(facts) == fact_count`, trigger `ENABLED` afterwards.

No backdoor: no GUC, no flag, no runtime escape. The bypass exists only inside that
one migration file, is in the ledger, and the invariant is restored before the
statement ends.

---

## 16. Human Correction Idempotency

**BROKEN — confirmed by measurement, not fixed.**

The probe returned a real error:

```text
value in column "fact_type" of relation "facts" violates not-null constraint
```

Root cause: `create_derived_fact_run_v1` reads facts as
`f->>'fact_type'` / `f->>'source_ref'` / `f->>'confidence'`, but
`deriveFactRunFromReviews` sends `p_facts: derivedFacts` where `DerivedFact` is
`{ id, factType, classification, value, sourceRef, confidence }`
(`apps/web/src/server/facts/human-correction.ts:40`). Neither spelling matches the
other, and neither matches the canonical `type`.

Consequence: **every RPC human correction fails with NOT NULL.** The error is not a
"foundation object missing" shape, so `isFoundationObjectMissing` returns false and
the app throws `DERIVED_FACT_RUN_FAILED`. The route answers 201 with
`derivation.status: 'FAILED'` — the review is saved, the derived run is not.

**Why it was not fixed here.** `create_derived_fact_run_v1` returns 5 columns
(`out_derived_fact_run_id`, `out_derived_snapshot_id`, `out_parent_fact_run_id`,
`out_parent_fingerprint_before`, `out_parent_fingerprint_after`) and
`CREATE OR REPLACE` cannot change a return type. A correct fix needs
`DROP` + `CREATE`, which means reproducing that function's body — including the
parent-fingerprint before/after logic that is the whole point of the check.
Rewriting it blind, in production, with no DEV, would be a worse outcome than a
precise bug report. The first attempt at exactly that failed loudly and rolled back
cleanly, which is the evidence for not pushing further.

**RECOMMENDED FIX (for a reviewed change):** on the application side, since
`DerivedFact` is a transport DTO — map it to the keys the server reads before
calling the RPC. That is a small, testable change and leaves the SQL alone. The
handoff §37/§38 (identity by correction event, not by `+human-correction` suffix)
remains unimplemented for the same reason and is still open.

---

## 17. AI_DECISION_V1

| Check | Result |
|---|---|
| Table exists, RLS on | PASS |
| `REVOKE UPDATE, DELETE` from `anon`, `authenticated` | PASS |
| `GRANT SELECT, INSERT` to `authenticated` | PASS |
| `ai_decision_snapshots_append_only` trigger | PASS (enabled) |
| `ai_decision_snapshots_identity` unique index | PASS |
| `UPDATE` rejected | enforced by trigger + ACL; **not executed** (no row exists, and `db query` cannot INSERT) |
| `DELETE` rejected | enforced by trigger + ACL; **not executed** |
| Retry same identity -> `AI_DECISION_V1_ALREADY_EXISTS` | code path + 36 unit tests; **not executed against a real DB** |

Production has **0** rows in `ai_decision_snapshots` and **0**
`AI_DECISION_V1` `audit_runs`, because the feature is not connected to a caller yet
(`appendAiDecisionV1` has no production caller — documented in the remediation
report). The table is armed; the path is unexercised. Stated as such rather than as a
pass.

---

## 18. Evaluation Persistence

| Check | Result |
|---|---|
| `persist_policy_evaluation_v1` exists | PASS |
| Executed against a real FROZEN run | **NO — not exercised** |
| `engine_run` + `engine_rule_results` + envelope + `AI_BASELINE` persisted | **NO** |
| `audit_evaluation_envelopes` rows | 0 (as before the phase) |
| `engine_runs_guard_completed` trigger present | PASS |

`persist_policy_evaluation_v1` requires a session (`auth.uid()`); the probe's
no-session check returns `AUTH_REQUIRED`, which was exercised. The success path
needs an authenticated end-to-end run, which is the next phase's job. **Not a pass.**

---

## 19. Audit Lifecycle

```text
delete_audit : NOT EXECUTED. Analysis only.
```

`public.delete_audit` is `SECURITY DEFINER` (verified `prosecdef = true`), deletes
from `audits` and lets FK `CASCADE` do the rest. With the append-only triggers in
place, the cascade aborts. Order of failure:

```text
fact_run_frozen_snapshots_append_only
  -> ai_decision_snapshots_append_only
  -> audit_evaluation_envelopes_append_only
  -> facts_guard_frozen_run_mutation
```

All 8 production audits now have a frozen snapshot, so **`delete_audit` will fail for
every one of them**, and the surface error is an unexpected 500. Not acceptable, and
not fixable by me: whether a machine-decided audit may ever be hard-deleted is
product policy, and the domain has no `ARCHIVED` / `VOID` / `CANCELLED` audit state
to fall back on.

**REQUIRES_OWNER_DECISION: `AUDIT_ARCHIVAL_STATE`.** Until it exists, the product has
no way to remove an audit created in error — which is the entire reason
`delete_audit` exists. `purge_audit` (OWNER-only, mandatory reason, `audit_log`
entry, object inventory) remains the correct long-term design and is **not**
implemented.

---

## 20. RLS

| Identity | Operation | Result |
|---|---|---|
| `anon` | SELECT on 15 sampled tables | **blocked at gateway, HTTP 401 `AUTH_UNAUTHORIZED`** — see below |
| `anon` | grants on 30 public tables | measured (§20.1) |
| `anon` | policies granting access | **0 of 105 policies** |
| `authenticated` owner | — | **NOT MEASURED** |
| `authenticated` foreign user | — | **NOT MEASURED** |
| `OWNER` profile | — | **NOT MEASURED**; production has **no OWNER profile** (only 1 AUDITOR), so every `current_app_role() = 'OWNER'` gate is currently unreachable |

The `anon` client could not be exercised: the `ANON_KEY` secret this environment
holds is rejected by the InsForge gateway with `401 Invalid token`, so the probe
never reached Postgres. **I am not claiming the anon path is proven.** What the
catalog does prove is stated next.

### 20.1 anon exposure, measured

```text
anon holds SELECT, INSERT, UPDATE, DELETE on 30 public tables
28 of those 30 have RLS ENABLED   -> anon denied: no policy is TO anon, so RLS
                                     defaults to deny
 2 had RLS DISABLED                -> audit_jobs, audit_job_evidences
```

The two RLS-off tables were the real exposure: with RLS off, the GRANT is the only
control, and the GRANT was full DML for an unauthenticated role on the job queue.
**Fixed** in `20260925140000` (RLS enabled with `TO authenticated` policies, anon
revoked). `enqueue_job` is `SECURITY DEFINER`, so the queue path is unaffected.

---

## 21. ACL

Two defects found by reading `has_table_privilege` after the migration, and fixed:

| Role | Object | Before | After | Why |
|---|---|---|---|---|
| `authenticated` | `policy_source_registry` | sel/ins/**upd/del** = T | sel=T, rest **F** | Foundation's own comment says read-only for the client role; the `REVOKE` was never written for `authenticated` |
| `anon` | `audit_runs` | sel/ins/**upd/del** = T | all **F** | decisions are not an anon surface; RLS already covered it, the grant did not need to exist |
| `anon` | `audit_jobs` | ins/sel/upd/del = T | all **F**, RLS ON | RLS was off |
| `anon` | `audit_job_evidences` | ins/sel/upd/del = T | all **F**, RLS ON | RLS was off |

`authenticated` on `policy_source_registry` now matches exactly what the repo's own
E2E asserts (`out_can_insert: false, out_can_update: false, out_can_delete: false`),
which it would **not** have passed before this fix.

Note the shape of the first defect: RLS and the append-only trigger already blocked
the writes, so the live risk was 0. It was still fixed, because two mechanisms
defending a privilege that should not exist is one careless trigger edit away from a
real breach.

---

## 22. RPC

| RPC | Exists | `anon` EXECUTE | `authenticated` EXECUTE | Exercised |
|---|---|---|---|---|
| `freeze_fact_run_v1` | yes | revoked | granted | no-session path -> `AUTH_REQUIRED` |
| `create_derived_fact_run_v1` | yes | revoked | granted | **fails on camelCase facts, §16** |
| `persist_policy_evaluation_v1` | yes | revoked | granted | no-session path -> `AUTH_REQUIRED` |
| `policy_foundation_acl_probe` | yes | revoked | granted | yes, 8 rows read |
| `policy_foundation_immutability_probe` | yes | revoked | granted | yes, 5 probes |
| `backfill_legacy_frozen_snapshots_v1` | yes (new) | revoked | granted | yes, 9 rows + idempotent retry |

---

## 23. E2E

| Suite | Result |
|---|---|
| `policy_foundation_immutability_probe` (real DB, production) | 3 proven, 1 vacuous, 1 failed -> §14, §16 |
| `backfill_legacy_frozen_snapshots_v1` (real DB) | PASS + idempotent |
| `policy_foundation_acl_probe` (real DB) | PASS, 2 defects found and fixed |
| `fact-run-snapshot.dev-e2e.test.ts` | **NOT RUN** — guard requires DEV appkey; not weakened |
| `audit-pipeline.dev-e2e`, `rule-governance.dev-e2e` | **NOT RUN** — same |

The three repo E2E suites remain unrun. They are written against DEV, and DEV has
no business data to prove anything with. They remain the right gate for the next
phase.

---

## 24. Golden Master

```text
Tests  : 14 / 14 PASS
Hash   : 38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76  MATCH
Fixture: untouched (0 bytes changed)
```

---

## 25. Regression Matrix

| # | Check | Before | After | Verdict |
|---|---|---|---|---|
| 1 | `pnpm typecheck` | PASS | PASS | PASS |
| 2 | `pnpm lint` | PASS | PASS | PASS |
| 3 | `pnpm test` | 328 | **328** | PASS |
| 4 | `pnpm build` | PASS | PASS | PASS |
| 5 | Golden Master | 14/14 | 14/14 | PASS |
| 6 | Fixture hash | match | match | PASS |
| 7 | `pnpm guard:ci` | n/a | PASS | PASS (new) |
| 8 | `evaluatePolicy` source | — | byte-identical | PASS |
| 9 | Template JSON parses | — | parses | PASS |
| 10 | PII in HEAD | 3 files | 0 | PASS |
| 11 | Secrets in Git | 0 | 0 | PASS |

**Regressions: 0.**

Nothing in the comparison list of §55 moved: `suggestedOutcome`, `outcomeStatus`,
`decisionStatus`, rule IDs, rule status, conditions, missing facts, missing
evidence, coverage gaps, next actions, trace, facts fingerprint, rules fingerprint.
The engine was not executed differently; it was not executed differently *because it
was not touched*.

---

## 26. Production State

```text
URL      : https://cancelaciones-ai-main.vercel.app
Deploy   : 1667c58 (this phase is NOT deployed)
Database : Cancelaciones / 4pw4jdzv — migrations applied, backup taken
```

The app is **not deployed**; these changes are local and uncommitted. The new
migrations revoke privileges and enable RLS, which is safe for the current code
paths (verified: the app's only server client is `createServerClient` + session, so
it runs as `authenticated`; no code reads `audit_jobs`; `enqueue_job` is
`SECURITY DEFINER`). But deploying is a separate decision and was not made.

Two production facts that matter for planning:

- **No `OWNER` profile exists.** Every `current_app_role() = 'OWNER'` gate is
  unreachable, so `policy_source_registry` promotion and rule authoring are closed
  in practice.
- **`ai_decision_snapshots` and `audit_evaluation_envelopes` are empty**, and the
  feature that fills them has no production caller.

---

## 27. Production Migration Plan

Written before applying: `docs/reports/POLICY-FOUNDATION-MIGRATION-PLAN.md`.

It contains the 5-signal identity gate, the 29-row inventory, preconditions, expected
grants per role, rollback strategy and the post-validation checklist. It is accurate
for the 8 reconciliation migrations, Foundation and the closure migration; §2 and §10
of this report supersede its original treatment of the ledger as merely "incomplete",
since the reconciliation turned out to be a rename rather than a skip.

---

## 28. Remaining Risks

| # | Risk | Severity | Status |
|---|---|---|---|
| 1 | Git history still holds student PII | **HIGH** | OWNER_ACTION (§7) |
| 2 | `create_derived_fact_run_v1` cannot accept the app's fact payload | **HIGH** | open, §16 |
| 3 | `delete_audit` fails for all 8 audits, no archive path | **HIGH** | OWNER_DECISION (§19) |
| 4 | Credentials exposed in conversation | **HIGH** | OWNER_ACTION (§5) |
| 5 | Human correction #2 still collides (`+human-correction` suffix) | MEDIUM | open, §37 unimplemented |
| 6 | `anon` RLS matrix unmeasured (gateway 401) | MEDIUM | open, §20 |
| 7 | No `OWNER` profile in production | MEDIUM | open |
| 8 | `evaluatePolicy` inputs unwritten (insufficient coverage) | MEDIUM | open, not in scope |
| 9 | `freeRun` / `synthetic-case` do direct UPDATEs, now revoked | MEDIUM | open, pre-existing |
| 10 | 7 normative divergences | — | OWNER_DECISION, untouched |

On #9, the correction from the previous report is confirmed and still stands:
`createFactRepository.freezeRun` does a direct `UPDATE` on `fact_extraction_runs`,
which is now revoked for `authenticated` (`42501`), and
`apps/web/src/app/api/dev/synthetic-case/route.ts` also inserts directly into
`engine_runs`, also revoked. Neither was touched: both are outside this phase and
both are dev-only paths.

---

## 29. OWNER Decisions

| # | Decision | Why it cannot be decided by code |
|---|---|---|
| 1 | `AUDIT_ARCHIVAL_STATE` | Product policy: may a machine-decided audit ever be hard-deleted, and what replaces deletion? |
| 2 | `HUMAN_CORRECTION_PARENT_SEMANTICS` | Does correction #2 derive from the original parent or the latest derived run? |
| 3 | Rotate the exposed credentials | Only the OWNER can rotate externally. |
| 4 | Rewrite published Git history | Destructive, needs coordination. |
| 5 | Promote `policy_source_registry` to `CANONICAL` | Requires the signed source. `POLICY_IS_IMMUTABLE`. |
| 6 | The 7 normative divergences | `REQUIRES_OWNER_DECISION`, untouched. |
| 7 | Approve deploying this phase | Not requested. |

---

## 30. Final Readiness

| Capability | Status | Evidence |
|---|---|---|
| Secrets absent from Git | **PASS** | all refs scanned, 0 hits |
| Token rotation | **OWNER_ACTION** | 3 credentials exposed in conversation |
| PII absent HEAD | **PASS** | 4 values, 0 remaining; 4 extra phones found by shape scan |
| PII absent history | **OWNER_ACTION** | `5d2d4ba` on 5 refs |
| Migration timestamps unique | **PASS** | guard fails on untracked duplicates too |
| Migration conflict resolved | **PASS** | no `feature/dictamen-panel`; ledger reconciled |
| DEV environment verified | **PASS** | `audit-pipeline-dev-e2e` / `4pw4jdzv-cif` |
| Foundation migration applied | **PASS** | production, 4 tables / 5 RPC / 19 triggers |
| RLS tested | **PARTIAL** | anon grants measured and fixed; session matrix unmeasured |
| FROZEN immutable | **PASS** | 3 mutations refused by named triggers |
| Legacy backfill | **PASS** | 9 sealed, idempotent, 0 new decisions |
| Human correction #2 | **FAIL** | RPC fact-key defect, §16 |
| Retry idempotency | **BLOCKED** | depends on the line above |
| AI_DECISION_V1 immutable | **PARTIAL** | armed; no row exists to test against |
| Atomic evaluation persistence | **NOT EXERCISED** | RPC exists; success path untested |
| Audit lifecycle | **OWNER_DECISION** | `AUDIT_ARCHIVAL_STATE` |
| Golden Master | **PASS** | 14/14, hash match |
| Tests | **PASS** | 328 |
| Typecheck | **PASS** | exit 0 |
| Lint | **PASS** | exit 0 |
| Build | **PASS** | exit 0 |
| Normative engine unchanged | **PASS** | byte-identical |
| **Policy Foundation complete** | **NO** | DB invariants proven; 2 blockers open |
| Declarative shadow ready | **NO** | depends on the above |

### Criteria for COMPLETE, item by item

| Criterion | Met |
|---|---|
| migration conflict resolved | yes |
| DEV verified | yes |
| migrations applied | yes (production, on OWNER instruction) |
| RLS tested | **partly** — anon grants fixed; session matrix unmeasured |
| DB immutability tested | yes |
| AI_DECISION_V1 tested | **partly** — no row exists |
| legacy backfill works | yes |
| human correction #2 works | **no** |
| retry idempotency works | **no** |
| Golden Master unchanged | yes |
| tests / typecheck / lint / build pass | yes |
| normative behaviour unchanged | yes |

7 of 12 met, 3 partial, 2 failed. **Verdict: PARTIAL, not COMPLETE**, and the
distinction is not cosmetic: the two failures are a live defect in a user-facing
path (§16) and an undecided deletion policy (§19).

### Next phase

`EXTRACTION TOOLS + DECLARATIVE SHADOW ENGINE` is **not** ready. Its entry
conditions were never about code, and they are still not met. Before it:

1. Fix the `create_derived_fact_run_v1` fact-key contract (§16).
2. Decide `AUDIT_ARCHIVAL_STATE` (§19).
3. Measure the authenticated RLS matrix — needs a working anon/user key pair (§20).
4. Rewrite history and rotate credentials (§5, §7).
