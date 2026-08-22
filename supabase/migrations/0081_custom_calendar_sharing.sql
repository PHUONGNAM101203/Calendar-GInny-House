-- "Lịch khác" → "+" → "Duyệt lịch có sẵn trong công ty": an owner may mark
-- one of their personal custom calendars (0015) as shared with the company;
-- anyone can then browse the shared ones and subscribe to paint a colleague's
-- calendar onto their own grid.
--
-- 0015 gave both custom_calendars and custom_events a single `for all`
-- owner-only policy. `for all` bundles SELECT with INSERT/UPDATE/DELETE, so
-- widening reads there would have widened writes too. This migration splits
-- each table's single policy into one `for select` policy (owner OR shared)
-- plus separate owner-only write policies, so a subscriber can read a shared
-- calendar and its events but can never add, edit or delete an event on it,
-- nor delete the calendar itself.
--
-- Ordering note: every new policy is created BEFORE the old one is dropped,
-- and `supabase db push` runs the file inside a transaction — so the tables
-- are never momentarily left with zero policies (which, with RLS enabled,
-- would deny everything).
--
-- Additive only: no column is dropped, no row is rewritten, and is_shared
-- defaults to false so every existing calendar stays exactly as private as it
-- was before this ran.

-- ---------------------------------------------------------------------------
-- 1. The shared flag
-- ---------------------------------------------------------------------------
alter table public.custom_calendars
  add column if not exists is_shared boolean not null default false;

create index if not exists custom_calendars_shared_idx
  on public.custom_calendars (is_shared)
  where is_shared;

-- ---------------------------------------------------------------------------
-- 2. Subscriptions — modelled on calendar_follows (0008): a composite-PK join
--    table scoped entirely to the acting user.
-- ---------------------------------------------------------------------------
create table if not exists public.custom_calendar_subscriptions (
  subscriber_id uuid not null references public.profiles(id) on delete cascade,
  calendar_id   uuid not null references public.custom_calendars(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (subscriber_id, calendar_id)
);

create index if not exists custom_calendar_subscriptions_calendar_idx
  on public.custom_calendar_subscriptions (calendar_id);

alter table public.custom_calendar_subscriptions enable row level security;

-- Deliberately NOT `for all`: INSERT additionally requires the target
-- calendar to actually be shared and to belong to someone else, while
-- SELECT/DELETE must keep working even after the owner un-shares it (else a
-- subscriber could never unsubscribe from a calendar that went private).
drop policy if exists custom_calendar_subscriptions_select on public.custom_calendar_subscriptions;
create policy custom_calendar_subscriptions_select on public.custom_calendar_subscriptions
  for select to authenticated
  using (subscriber_id = auth.uid());

drop policy if exists custom_calendar_subscriptions_insert on public.custom_calendar_subscriptions;
create policy custom_calendar_subscriptions_insert on public.custom_calendar_subscriptions
  for insert to authenticated
  with check (
    subscriber_id = auth.uid()
    and exists (
      select 1 from public.custom_calendars c
      where c.id = calendar_id
        and c.is_shared
        and c.owner_id <> auth.uid()
    )
  );

drop policy if exists custom_calendar_subscriptions_delete on public.custom_calendar_subscriptions;
create policy custom_calendar_subscriptions_delete on public.custom_calendar_subscriptions
  for delete to authenticated
  using (subscriber_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. custom_calendars: split read from write
-- ---------------------------------------------------------------------------
drop policy if exists custom_calendars_select on public.custom_calendars;
create policy custom_calendars_select on public.custom_calendars
  for select to authenticated
  using (owner_id = auth.uid() or is_shared);

drop policy if exists custom_calendars_insert on public.custom_calendars;
create policy custom_calendars_insert on public.custom_calendars
  for insert to authenticated
  with check (owner_id = auth.uid());

-- `using` gates which rows may be updated, `with check` the post-update row —
-- both owner-only, so a subscriber can neither rename nor re-colour someone
-- else's calendar, and an owner cannot hand theirs to another owner_id.
drop policy if exists custom_calendars_update on public.custom_calendars;
create policy custom_calendars_update on public.custom_calendars
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists custom_calendars_delete on public.custom_calendars;
create policy custom_calendars_delete on public.custom_calendars
  for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists custom_calendars_owner on public.custom_calendars;

-- ---------------------------------------------------------------------------
-- 4. custom_events: split read from write too.
--    Widening only custom_calendars would have let a colleague see the
--    calendar row and zero events — a feature that looks broken rather than a
--    permission error. Writes stay joined through the parent's owner_id
--    exactly as 0015 had them.
-- ---------------------------------------------------------------------------
drop policy if exists custom_events_select on public.custom_events;
create policy custom_events_select on public.custom_events
  for select to authenticated
  using (exists (
    select 1 from public.custom_calendars c
    where c.id = calendar_id
      and (c.owner_id = auth.uid() or c.is_shared)
  ));

drop policy if exists custom_events_insert on public.custom_events;
create policy custom_events_insert on public.custom_events
  for insert to authenticated
  with check (exists (
    select 1 from public.custom_calendars c
    where c.id = calendar_id and c.owner_id = auth.uid()
  ));

drop policy if exists custom_events_update on public.custom_events;
create policy custom_events_update on public.custom_events
  for update to authenticated
  using (exists (
    select 1 from public.custom_calendars c
    where c.id = calendar_id and c.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.custom_calendars c
    where c.id = calendar_id and c.owner_id = auth.uid()
  ));

drop policy if exists custom_events_delete on public.custom_events;
create policy custom_events_delete on public.custom_events
  for delete to authenticated
  using (exists (
    select 1 from public.custom_calendars c
    where c.id = calendar_id and c.owner_id = auth.uid()
  ));

drop policy if exists custom_events_owner on public.custom_events;

-- ---------------------------------------------------------------------------
-- 5. Browse list.
--    profiles_select_branch (0069) is visibility-scoped, so a plain embedded
--    join to profiles would blank out the owner's name for anyone the viewer
--    cannot otherwise see — the browse dialog would list nameless calendars.
--    A SECURITY DEFINER function sidesteps that while exposing nothing beyond
--    the name/colour/owner-name of calendars that were explicitly shared.
-- ---------------------------------------------------------------------------
create or replace function public.list_shared_custom_calendars()
returns table (
  id uuid,
  owner_id uuid,
  owner_name text,
  name text,
  color text,
  created_at timestamptz,
  is_subscribed boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.owner_id,
    p.full_name,
    c.name,
    c.color,
    c.created_at,
    exists (
      select 1 from public.custom_calendar_subscriptions s
      where s.calendar_id = c.id and s.subscriber_id = auth.uid()
    )
  from public.custom_calendars c
  join public.profiles p on p.id = c.owner_id
  where c.is_shared
  order by p.full_name, c.name;
$$;

revoke all on function public.list_shared_custom_calendars() from public;
grant execute on function public.list_shared_custom_calendars() to authenticated;
