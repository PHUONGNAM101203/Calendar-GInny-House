-- Data-driven replacement for lib/roles.ts's OPERATIONS_GROUP_ROLES/
-- TRAINING_GROUP_ROLES/HR_GROUP_ROLES + the 6 SQL functions that hardcode
-- them (can_manage_shift_for, can_approve_shift_request,
-- can_approve_swap_request, can_view_profile, can_view_profile_calendar,
-- can_manage_attendance_for). technical edits this from the dashboard
-- instead of needing a code change + migration + deploy every time a
-- manager's group authority changes. See
-- docs/superpowers/specs/2026-08-09-dynamic-group-permissions-design.md.
create table public.group_permissions (
  manager_role public.staff_role not null,
  target_role  public.staff_role not null,
  permission   text not null,
  created_at   timestamptz not null default now(),
  constraint group_permissions_permission_valid check (permission in (
    'create_shift', 'approve_shift_request', 'approve_swap',
    'approve_leave', 'manage_attendance', 'view_calendar'
  )),
  -- Only the 3 roles that already have a "group" concept can be a row's
  -- manager — ceo/technical stay unconditionally unrestricted in every
  -- predicate function and never consult this table.
  constraint group_permissions_manager_valid check (
    manager_role in ('coo', 'training_director', 'hr')
  ),
  -- Never allow a manager-tier role (ceo/coo/training_director/technical)
  -- as a target — closes the privilege-escalation path of one group
  -- manager being granted authority over another. hr IS a valid target
  -- (coo's operations group includes hr today) despite hr also being an
  -- editable manager row — a role can be both a group's subject and
  -- another group's approver, same precedent as HR_GROUP_ROLES's comment
  -- in lib/roles.ts.
  constraint group_permissions_target_valid check (
    target_role in ('teacher', 'collaborator', 'student_affairs',
      'teaching_assistant', 'operations_staff', 'customer_care', 'hr')
  ),
  primary key (manager_role, target_role, permission)
);

alter table public.group_permissions enable row level security;

create policy group_permissions_select_technical on public.group_permissions
  for select to authenticated
  using ((select role from public.profiles where id = auth.uid()) = 'technical');

create policy group_permissions_write_technical on public.group_permissions
  for all to authenticated
  using ((select role from public.profiles where id = auth.uid()) = 'technical')
  with check ((select role from public.profiles where id = auth.uid()) = 'technical');

-- Seed: exactly reproduce today's hardcoded OPERATIONS_GROUP_ROLES/
-- TRAINING_GROUP_ROLES/HR_GROUP_ROLES for all 6 permission types, EXCEPT
-- view_calendar's training_director row, which is wider today (adds
-- teaching_assistant — see can_view_profile_calendar in 0029). Day-1
-- behavior is unchanged; only the storage moves from code to data.
insert into public.group_permissions (manager_role, target_role, permission)
select m.manager_role::public.staff_role, m.target_role::public.staff_role, p.permission
from (values
  ('coo', 'hr'), ('coo', 'customer_care'), ('coo', 'operations_staff'),
  ('training_director', 'teacher'), ('training_director', 'collaborator'),
  ('hr', 'student_affairs'), ('hr', 'teaching_assistant')
) as m(manager_role, target_role)
cross join (values
  ('create_shift'), ('approve_shift_request'), ('approve_swap'),
  ('approve_leave'), ('manage_attendance')
) as p(permission);

insert into public.group_permissions (manager_role, target_role, permission)
values
  ('coo', 'hr', 'view_calendar'), ('coo', 'customer_care', 'view_calendar'), ('coo', 'operations_staff', 'view_calendar'),
  ('training_director', 'teacher', 'view_calendar'), ('training_director', 'collaborator', 'view_calendar'),
  ('training_director', 'teaching_assistant', 'view_calendar'),
  ('hr', 'student_affairs', 'view_calendar'), ('hr', 'teaching_assistant', 'view_calendar');
