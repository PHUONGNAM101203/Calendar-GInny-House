-- "Lịch khác" → "+" → "Tạo lịch mới": a personal custom calendar (name +
-- color) a viewer can create for themself and add their own events to —
-- e.g. "Lịch thi thử", "Lịch test". Personal, not org-wide (like Google
-- Calendar's own "other calendars" section is per-account), so RLS is
-- owner-only for both tables. "Nhập từ URL/file" and "Duyệt lịch có sẵn"
-- (seen in the sidebar's "+" menu) are deliberately not built yet — this
-- migration only covers the "Tạo lịch mới" path.
create table if not exists public.custom_calendars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  color text not null,
  created_at timestamptz not null default now()
);

alter table public.custom_calendars drop constraint if exists custom_calendars_color_valid;
alter table public.custom_calendars add constraint custom_calendars_color_valid
  check (
    color in (
      '--chart-1', '--chart-3', '--chart-4', '--chart-5', '--chart-6',
      '--gold', '--success',
      '--palette-rose', '--palette-violet', '--palette-basil',
      '--palette-indigo', '--palette-flamingo', '--palette-graphite'
    )
    or color ~ '^#[0-9a-fA-F]{6}$'
  );

alter table public.custom_calendars enable row level security;
drop policy if exists custom_calendars_owner on public.custom_calendars;
create policy custom_calendars_owner on public.custom_calendars
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create table if not exists public.custom_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.custom_calendars(id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  created_at timestamptz not null default now(),
  constraint custom_events_range_valid check (end_at >= start_at)
);

create index if not exists custom_events_calendar_id_idx on public.custom_events (calendar_id);

alter table public.custom_events enable row level security;
drop policy if exists custom_events_owner on public.custom_events;
create policy custom_events_owner on public.custom_events
  for all to authenticated
  using (exists (
    select 1 from public.custom_calendars c
    where c.id = calendar_id and c.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.custom_calendars c
    where c.id = calendar_id and c.owner_id = auth.uid()
  ));
