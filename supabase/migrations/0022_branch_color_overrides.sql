-- Personal display color for a "Cơ sở" row in the calendar sidebar filter
-- (CS1/CS2/CS3 + the synthetic "remote" key) — same "your own preference,
-- not a shared attribute" model as calendar_follows.color for people.
-- branch_key is not FK'd to branches(id): it also needs to hold the
-- literal 'remote' pseudo-key, which isn't a real branch row.

create table if not exists public.branch_color_overrides (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  branch_key text not null,
  color text not null,
  primary key (profile_id, branch_key)
);

alter table public.branch_color_overrides enable row level security;

create policy branch_color_overrides_own on public.branch_color_overrides
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
