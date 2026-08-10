-- "Kiêm nhiệm" (secondary job role) — exactly 2 allowed pairs, nothing
-- general (deliberate YAGNI: not a multi-role join table). Approval/
-- permission authority stays keyed to profiles.role (primary) only — see
-- lib/roles.ts's canApprove*For/canCreateShiftFor/canManageAttendanceFor
-- and 0048_group_permissions_sql_functions.sql, none of which read this
-- column. Purely a display/labeling/grouping concern — mirrors
-- lib/roles.ts's SECONDARY_ROLE_ELIGIBLE_ROLES/getRoleLabel() — keep in
-- sync.
alter table public.profiles add column secondary_role public.staff_role;

alter table public.profiles add constraint profiles_secondary_role_valid_pair check (
  secondary_role is null
  or (role = 'teacher' and secondary_role = 'teaching_assistant')
  or (role = 'student_affairs' and secondary_role = 'teaching_assistant')
);

-- protect_profile_privileges() (0001_init.sql, current body in
-- 0040_fix_stale_branch_id_triggers.sql) already strips `role` back to its
-- old value for non-manager updates — profiles_update_self is row-scoped
-- only (`id = auth.uid()`), not column-restricted, so without this a plain
-- staff member could set their own secondary_role via the anon client.
-- Extends the same protection to secondary_role. For manager-driven
-- writes, auto-clears an incompatible secondary_role instead of letting
-- the CHECK constraint above reject the whole UPDATE — e.g. changing role
-- from teacher to hr while secondary_role is still 'teaching_assistant'
-- from before now silently clears it rather than failing the statement.
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.is_manager() then
    if new.secondary_role is not null and not (
      (new.role = 'teacher' and new.secondary_role = 'teaching_assistant') or
      (new.role = 'student_affairs' and new.secondary_role = 'teaching_assistant')
    ) then
      new.secondary_role := null;
    end if;
    return new;
  end if;
  new.role := old.role;
  new.secondary_role := old.secondary_role;
  return new;
end;
$$;
