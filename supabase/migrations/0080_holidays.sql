-- Vietnam public holidays move from a hardcoded TypeScript array
-- (lib/holidays.ts, deleted by this change) into an editable table.
--
-- Why: the array only ran to 2027-09-02, after which the calendar's holiday
-- overlay silently went empty, and every correction needed a code change +
-- deploy. The owner's actual ask was a *range* with a note — "lễ quốc khánh
-- là sẽ được nghỉ từ 29/08-hết 02/09" — which the old one-row-per-day shape
-- could not express at all.
--
-- Holidays stay DISPLAY-ONLY. Nothing in leave validation, shift creation,
-- attendance/late detection, or either cron route reads this table; it feeds
-- the calendar's "Ngày lễ ở Việt Nam" banner overlay and nothing else. Keep
-- it that way — making a holiday suppress reminders or block shift creation
-- is a separate, much riskier decision.
create table if not exists public.holidays (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Inclusive on BOTH ends: a holiday running 29/08 through the end of 02/09
  -- is start_date = 2025-08-29, end_date = 2025-09-02. The calendar layer is
  -- what converts this to react-big-calendar's exclusive end (see
  -- toHolidayEvents in lib/calendar.ts) — the database stores what a human
  -- would say out loud.
  start_date  date not null,
  end_date    date not null,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint holidays_name_not_blank check (length(btrim(name)) > 0),
  constraint holidays_dates_valid check (end_date >= start_date)
);

-- The overlay query is an unfiltered "all holidays" read (the table is ~34
-- rows), but the editor lists them chronologically and any future
-- range-overlap query wants this too.
create index if not exists holidays_start_date_idx on public.holidays (start_date);

drop trigger if exists holidays_set_updated_at on public.holidays;
create trigger holidays_set_updated_at before update on public.holidays
  for each row execute function public.set_updated_at();

alter table public.holidays enable row level security;

-- Everyone authenticated reads them — the calendar overlay is shown to all
-- ~17 staff regardless of role.
drop policy if exists holidays_select_authenticated on public.holidays;
create policy holidays_select_authenticated on public.holidays
  for select to authenticated
  using (true);

-- Writes are ceo + technical only. Modelled on group_permissions_write_technical
-- in 0047_group_permissions.sql, widened to include ceo per the owner's
-- decision. This policy is the actual enforcement boundary; the matching
-- check in actions/holidays.ts is only there for a friendly Vietnamese error.
drop policy if exists holidays_write_ceo_technical on public.holidays;
create policy holidays_write_ceo_technical on public.holidays
  for all to authenticated
  using ((select role from public.profiles where id = auth.uid()) in ('ceo', 'technical'))
  with check ((select role from public.profiles where id = auth.uid()) in ('ceo', 'technical'));

-- Seed: the 36 dates that lib/holidays.ts hardcoded, with runs of
-- CONSECUTIVE SAME-NAME dates collapsed into one range row -> 34 rows.
--
-- Only one run actually collapses (Nghỉ Tết Nguyên Đán 2025-01-25..27),
-- because the old array gave each Tết day its own distinct name ("Giao
-- thừa...", "Mùng 1...", "Mùng 2..."). Merging those by adjacency alone
-- would have thrown those names away, so they are kept as separate rows —
-- ceo/technical can now merge them in the editor if they'd rather see one
-- banner.
--
-- Guarded by `not exists`: re-running this migration against an already
-- seeded table inserts nothing, so it can never duplicate rows.
insert into public.holidays (name, start_date, end_date)
select v.name, v.start_date, v.end_date
from (values
  ('Tết Dương lịch', '2025-01-01'::date, '2025-01-01'::date),
  ('Nghỉ Tết Nguyên Đán', '2025-01-25'::date, '2025-01-27'::date),
  ('Giao thừa Tết Ất Tỵ', '2025-01-28'::date, '2025-01-28'::date),
  ('Mùng 1 Tết Ất Tỵ', '2025-01-29'::date, '2025-01-29'::date),
  ('Mùng 2 Tết Ất Tỵ', '2025-01-30'::date, '2025-01-30'::date),
  ('Mùng 3 Tết Ất Tỵ', '2025-01-31'::date, '2025-01-31'::date),
  ('Nghỉ Tết Nguyên Đán', '2025-02-01'::date, '2025-02-01'::date),
  ('Giỗ Tổ Hùng Vương', '2025-04-06'::date, '2025-04-06'::date),
  ('Ngày Giải phóng miền Nam', '2025-04-30'::date, '2025-04-30'::date),
  ('Ngày Quốc tế Lao động', '2025-05-01'::date, '2025-05-01'::date),
  ('Nghỉ Quốc khánh', '2025-09-01'::date, '2025-09-01'::date),
  ('Ngày Quốc khánh', '2025-09-02'::date, '2025-09-02'::date),
  ('Tết Dương lịch', '2026-01-01'::date, '2026-01-01'::date),
  ('Nghỉ Tết Nguyên Đán', '2026-02-15'::date, '2026-02-15'::date),
  ('Giao thừa Tết Bính Ngọ', '2026-02-16'::date, '2026-02-16'::date),
  ('Mùng 1 Tết Bính Ngọ', '2026-02-17'::date, '2026-02-17'::date),
  ('Mùng 2 Tết Bính Ngọ', '2026-02-18'::date, '2026-02-18'::date),
  ('Mùng 3 Tết Bính Ngọ', '2026-02-19'::date, '2026-02-19'::date),
  ('Nghỉ Tết Nguyên Đán', '2026-02-20'::date, '2026-02-20'::date),
  ('Giỗ Tổ Hùng Vương', '2026-04-25'::date, '2026-04-25'::date),
  ('Ngày Giải phóng miền Nam', '2026-04-30'::date, '2026-04-30'::date),
  ('Ngày Quốc tế Lao động', '2026-05-01'::date, '2026-05-01'::date),
  ('Nghỉ Quốc khánh', '2026-09-01'::date, '2026-09-01'::date),
  ('Ngày Quốc khánh', '2026-09-02'::date, '2026-09-02'::date),
  ('Tết Dương lịch', '2027-01-01'::date, '2027-01-01'::date),
  ('Giao thừa Tết Đinh Mùi', '2027-02-05'::date, '2027-02-05'::date),
  ('Mùng 1 Tết Đinh Mùi', '2027-02-06'::date, '2027-02-06'::date),
  ('Mùng 2 Tết Đinh Mùi', '2027-02-07'::date, '2027-02-07'::date),
  ('Mùng 3 Tết Đinh Mùi', '2027-02-08'::date, '2027-02-08'::date),
  ('Giỗ Tổ Hùng Vương', '2027-04-15'::date, '2027-04-15'::date),
  ('Ngày Giải phóng miền Nam', '2027-04-30'::date, '2027-04-30'::date),
  ('Ngày Quốc tế Lao động', '2027-05-01'::date, '2027-05-01'::date),
  ('Nghỉ Quốc khánh', '2027-09-01'::date, '2027-09-01'::date),
  ('Ngày Quốc khánh', '2027-09-02'::date, '2027-09-02'::date)
) as v(name, start_date, end_date)
where not exists (select 1 from public.holidays);
