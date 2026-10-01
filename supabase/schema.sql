-- Kargo Hiring — database schema
-- Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- rubric_criteria — the scoring standard. The model reads it; it never writes it.
-- ---------------------------------------------------------------------------
create table if not exists public.rubric_criteria (
  id              uuid primary key default gen_random_uuid(),
  role            text not null check (role in ('pm', 'spm')),
  key             text not null,
  criterion_name  text not null,
  short_label     text not null,
  description     text not null,
  weight          numeric(5,2) not null check (weight > 0 and weight <= 100),
  score_anchors   jsonb not null,
  position        int not null default 0,
  rubric_version  text not null default 'v1',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (role, key, rubric_version)
);
create index if not exists rubric_criteria_role_active_idx on public.rubric_criteria (role, active, position);
drop trigger if exists rubric_criteria_updated_at on public.rubric_criteria;
create trigger rubric_criteria_updated_at before update on public.rubric_criteria
  for each row execute function public.set_updated_at();

-- Active weights per role; the app refuses to score unless each total is exactly 100.
create or replace view public.rubric_weight_totals as
  select role, rubric_version, sum(weight) as total_weight, count(*) as criteria
  from public.rubric_criteria where active
  group by role, rubric_version;

-- ---------------------------------------------------------------------------
-- candidates — holds PII. Only anonymised_cv_text is ever sent to a model.
-- ---------------------------------------------------------------------------
create table if not exists public.candidates (
  id                  uuid primary key default gen_random_uuid(),
  candidate_name      text,
  candidate_email     text,
  candidate_phone     text,
  candidate_location  text,
  name_source         text check (name_source in ('cv', 'filename')),
  role_applied        text not null check (role_applied in ('pm', 'spm')),
  original_file_url   text,           -- private storage path, served only via short-lived signed URL
  original_filename   text,
  file_kind           text check (file_kind in ('pdf', 'docx')),
  anonymised_cv_text  text,
  processing_status   text not null default 'uploaded' check (processing_status in (
    'uploaded','extracting','extracted','anonymising','scoring','generating_brief','generating_email',
    'ready_for_review','sending','sent',
    'extraction_failed','scoring_failed','generation_failed','send_failed')),
  processing_error    text,
  decision            text not null default 'review'
                      check (decision in ('review','shortlisted','hold','not_shortlisted')),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists candidates_role_idx on public.candidates (role_applied);
create index if not exists candidates_status_idx on public.candidates (processing_status);
create index if not exists candidates_decision_idx on public.candidates (decision);
create index if not exists candidates_created_idx on public.candidates (created_at desc);
drop trigger if exists candidates_updated_at on public.candidates;
create trigger candidates_updated_at before update on public.candidates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- candidate_scores — one row per candidate × criterion × role. The audit trail.
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_scores (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references public.candidates (id) on delete cascade,
  role               text not null check (role in ('pm', 'spm')),
  criterion_id       uuid not null references public.rubric_criteria (id) on delete restrict,
  score              int not null check (score between 0 and 5),
  evidence           text not null default '',
  evidence_verified  boolean not null default true,
  reason             text not null default '',
  weight             numeric(5,2) not null,            -- snapshot of the weight used
  weighted_score     numeric(6,2) not null,            -- (score / 5) * weight, computed server-side
  created_at         timestamptz not null default now(),
  unique (candidate_id, criterion_id)
);
create index if not exists candidate_scores_candidate_idx on public.candidate_scores (candidate_id, role);
create index if not exists candidate_scores_criterion_idx on public.candidate_scores (criterion_id);

-- ---------------------------------------------------------------------------
-- candidate_results — totals, eligibility, brief, email and send state.
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_results (
  id                     uuid primary key default gen_random_uuid(),
  candidate_id           uuid not null unique references public.candidates (id) on delete cascade,
  pm_score               numeric(5,2),
  spm_score              numeric(5,2),
  eligibility_status     jsonb,        -- { location_status, location_basis, role_match, role_match_basis }
  top_strength           text,
  main_concern           text,
  interview_brief        text,
  interview_brief_parts  jsonb,        -- { why, strongest_evidence, probe }
  email_type             text check (email_type in ('interview', 'rejection')),
  email_subject          text,
  email_body             text,
  email_drafts           jsonb,        -- { interview: {subject, body}, rejection: {subject, body} } as generated
  email_ready            boolean not null default false,
  email_sent             boolean not null default false,
  sent_at                timestamptz,
  sent_to                text,
  resend_message_id      text,
  send_lock_at           timestamptz,  -- claim taken before calling Resend; blocks duplicate sends
  last_send_error        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists candidate_results_pm_idx on public.candidate_results (pm_score desc nulls last);
create index if not exists candidate_results_spm_idx on public.candidate_results (spm_score desc nulls last);
drop trigger if exists candidate_results_updated_at on public.candidate_results;
create trigger candidate_results_updated_at before update on public.candidate_results
  for each row execute function public.set_updated_at();

-- A sent email can never be un-sent by a stray update.
create or replace function public.guard_sent() returns trigger
language plpgsql as $$
begin
  if old.email_sent and not new.email_sent then
    raise exception 'email_sent cannot be reset once true';
  end if;
  return new;
end $$;
drop trigger if exists candidate_results_guard_sent on public.candidate_results;
create trigger candidate_results_guard_sent before update on public.candidate_results
  for each row execute function public.guard_sent();

-- ---------------------------------------------------------------------------
-- Row Level Security: on, with no policies. Only the server (service role) can read or write.
-- The anon key sees nothing, so candidate PII cannot leak through it.
-- ---------------------------------------------------------------------------
alter table public.rubric_criteria  enable row level security;
alter table public.candidates        enable row level security;
alter table public.candidate_scores  enable row level security;
alter table public.candidate_results enable row level security;

-- ---------------------------------------------------------------------------
-- Private bucket for original CV files.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 5242880,
        array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
