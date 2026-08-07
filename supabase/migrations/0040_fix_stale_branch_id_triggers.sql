-- Two more triggers still referenced the profiles.branch_id column dropped
-- by 0036_drop_legacy_branch_column.sql — found by inspecting every
-- function that predates that drop, after respond_to_swap_request() turned
-- out not to be the only one (see 0039). DROP COLUMN doesn't check plpgsql
-- function bodies for references, only RLS policies (which is why the
-- bulk of the 0033 rewrite was caught, but these two trigger bodies
-- weren't), so both only ever surfaced at runtime.
--
-- protect_profile_privileges() — BEFORE UPDATE trigger on public.profiles,
-- blocks a non-manager from changing their own role/branch. Unconditionally
-- assigned `new.branch_id := old.branch_id` on every non-manager profile
-- update, which crashes with "record has no field branch_id" now that the
-- column is gone — this is what broke editing a profiles row directly
-- (Supabase Studio runs as postgres, but is_manager()/auth.role() still
-- evaluate the same trigger body). Branch membership is no longer a
-- protected profiles column at all — set_profile_branches() (its own
-- is_manager()-gated RPC) is the only way to change it — so this line is
-- simply removed, not replaced.
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.is_manager() then return new; end if;
  new.role := old.role;
  return new;
end;
$$;

-- sync_shift_branch() — BEFORE INSERT/UPDATE trigger on public.shifts,
-- fallback-only per 0023 (every app code path already supplies branch_id
-- explicitly). Its fallback tried to derive branch_id from the assignee's
-- own profiles.branch_id, which doesn't exist post-multi-branch (a person
-- can belong to several branches now, so there's no single one to derive).
-- Keeps the friendly error for the "still no branch_id" case instead of
-- crashing on the dropped column.
create or replace function public.sync_shift_branch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is not null then
    return new;
  end if;
  raise exception 'Nhân viên chưa được gán cơ sở' using errcode = '23514';
end;
$$;
