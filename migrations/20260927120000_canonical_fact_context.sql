create table if not exists public.audit_temporal_context (
  audit_id uuid primary key references public.audits(id) on delete cascade,
  ciclo_fecha_inicio date,
  fecha_solicitud date,
  fecha_ingreso date,
  inicio_primer_ciclo date,
  avance_curricular_percent integer check (avance_curricular_percent is null or (avance_curricular_percent between 0 and 100)),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.canonical_fact_runs (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  fact_run_id uuid references public.fact_extraction_runs(id) on delete set null,
  policy_code text not null,
  policy_version text not null,
  extractor_version text not null,
  context_fingerprint text not null,
  temporal_context jsonb not null,
  state text not null default 'DRAFT' check (state in ('DRAFT','FROZEN','FAILED')),
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (audit_id, context_fingerprint)
);

create table if not exists public.canonical_fact_candidates (
  id uuid primary key default gen_random_uuid(),
  canonical_run_id uuid not null references public.canonical_fact_runs(id) on delete cascade,
  audit_id uuid not null references public.audits(id) on delete cascade,
  fact_id text not null,
  proposed_state text not null check (proposed_state in ('KNOWN','UNKNOWN','NOT_APPLICABLE','CONTRADICTED')),
  value jsonb,
  evidence_ref jsonb not null,
  source_location jsonb not null default '{}'::jsonb,
  extraction_method text not null check (extraction_method in ('DETERMINISTIC','LLM','HUMAN','IMPORTED','DERIVED')),
  extraction_confidence numeric check (extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 1)),
  raw_support jsonb,
  provenance jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.canonical_facts (
  id uuid primary key default gen_random_uuid(),
  canonical_run_id uuid not null references public.canonical_fact_runs(id) on delete cascade,
  audit_id uuid not null references public.audits(id) on delete cascade,
  fact_id text not null,
  state text not null check (state in ('KNOWN','UNKNOWN','NOT_APPLICABLE','CONTRADICTED')),
  value jsonb,
  evidence_refs jsonb not null default '[]'::jsonb,
  provenance jsonb not null,
  extraction_method text not null check (extraction_method in ('DETERMINISTIC','LLM','HUMAN','IMPORTED','DERIVED')),
  relevant_timestamp date,
  unknown_reason text,
  notes text,
  created_at timestamptz not null default now(),
  unique (canonical_run_id, fact_id)
);

create index if not exists idx_audit_temporal_context_audit_id on public.audit_temporal_context(audit_id);
create index if not exists idx_canonical_fact_runs_audit_id on public.canonical_fact_runs(audit_id);
create index if not exists idx_canonical_fact_candidates_run_id on public.canonical_fact_candidates(canonical_run_id);
create index if not exists idx_canonical_fact_candidates_fact_id on public.canonical_fact_candidates(fact_id);
create index if not exists idx_canonical_facts_run_id on public.canonical_facts(canonical_run_id);
create index if not exists idx_canonical_facts_fact_id on public.canonical_facts(fact_id);

alter table public.audit_temporal_context enable row level security;
alter table public.canonical_fact_runs enable row level security;
alter table public.canonical_fact_candidates enable row level security;
alter table public.canonical_facts enable row level security;

grant select, insert, update on public.audit_temporal_context to authenticated;
grant select, insert, update on public.canonical_fact_runs to authenticated;
grant select, insert on public.canonical_fact_candidates to authenticated;
grant select, insert on public.canonical_facts to authenticated;
