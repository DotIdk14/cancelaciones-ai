-- Deterministic technical seed for Baseline V2.
-- No real user/customer data. The seeded user exists only for local bootstrap/smoke.

INSERT INTO auth.users(id, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'baseline-owner@example.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles(id, role, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'OWNER', 'Baseline Owner')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

INSERT INTO public.policy_source_registry(
  policy_code, policy_version, document_id, sha256, status, effective_from, verified_by, verified_at, notes
) VALUES (
  'GDM_GAM_PRD_MLG_003',
  'BASELINE_V2_PLACEHOLDER',
  'GDM_GAM_PRD_MLG_003:BASELINE_V2_PLACEHOLDER',
  '0000000000000000000000000000000000000000000000000000000000000000',
  'CANONICAL',
  DATE '2026-09-26',
  '00000000-0000-0000-0000-000000000001',
  now(),
  'Technical seed only: identifies the policy source key required by fact sealing. It is not normative content.'
) ON CONFLICT (document_id) DO NOTHING;
