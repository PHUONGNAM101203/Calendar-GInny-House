-- Flags the one dedicated read-only account used by the daily production
-- audit routine (docs/superpowers/specs/2026-08-12-daily-audit-routine-design.md)
-- so it can be excluded from staff-facing listings/aggregates without
-- touching RLS or the approval RPCs — the account never submits anything,
-- so those layers never see it regardless.
alter table public.profiles
  add column if not exists is_monitoring_account boolean not null default false;
