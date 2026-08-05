-- Replace the binary employee/manager role with the real organizational
-- hierarchy. "Manager" was always a stand-in for "whoever can run shift
-- operations" — now that there are 8 real job titles, that permission
-- needs to be a set of titles, not a single flag.

do $$ begin
  create type public.staff_role as enum (
    'ceo',               -- Tổng Giám Đốc
    'coo',               -- Giám Đốc Vận Hành
    'training_director', -- Giám Đốc Đào Tạo
    'hr',                -- HR
    'technical',         -- Kỹ thuật
    'teacher',           -- Giáo viên
    'collaborator',      -- CTV
    'customer_care'      -- CSKH
  );
exception when duplicate_object then null;
end $$;

-- one-time column swap from the old 2-value enum to the new 8-value one;
-- guarded so re-running this migration after it already succeeded is a
-- no-op instead of an error
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
      and udt_name = 'user_role'
  ) then
    alter table public.profiles rename column role to role_old;
    alter table public.profiles add column role public.staff_role;

    -- profiles_protect_privileges fires on every UPDATE and calls
    -- is_manager(), which at this point still has its OLD body (`role =
    -- 'manager'`) — but the role column is now `staff_role`, so that
    -- comparison itself throws (invalid input value for enum staff_role:
    -- "manager"). It would also strip our own write back to NULL even if
    -- it didn't error, since new.role has no old.role to fall back to on
    -- a freshly-added column. Disable it for just this internal data fixup.
    alter table public.profiles disable trigger profiles_protect_privileges;

    -- best-effort mapping of existing data: former managers become Giám
    -- Đốc Vận Hành (the closest "runs day-to-day operations" title),
    -- former employees become Giáo viên (the most common front-line role
    -- at an English center) — reassign individually afterwards as needed.
    update public.profiles set role = case
      when role_old = 'manager' then 'coo'::public.staff_role
      else 'teacher'::public.staff_role
    end;

    alter table public.profiles enable trigger profiles_protect_privileges;

    alter table public.profiles alter column role set not null;
    alter table public.profiles drop column role_old;
    drop type public.user_role;
  end if;
end $$;

alter table public.profiles alter column role set default 'teacher';

-- the set of titles with full manager-tier access (shifts, swaps, leave
-- approval, staff/branch assignment, dashboard) — everyone else is
-- front-line staff scoped to their own records + their branch's shared
-- schedule, same as before
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('ceo', 'coo', 'training_director', 'technical')
     from public.profiles where id = auth.uid()),
    false
  );
$$;
