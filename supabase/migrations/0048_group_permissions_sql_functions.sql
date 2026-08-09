-- The 6 predicate functions collapse their coo/training_director/hr case
-- branches into one shared shape — a lookup against group_permissions
-- keyed by the caller's own role, the target's role, and this function's
-- fixed permission-type literal. ceo/technical's unconditional-true branch
-- (and self-visibility bypass, where present) is unchanged.
create or replace function public.can_manage_shift_for(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'create_shift'
    )
  end;
$$;

create or replace function public.can_approve_shift_request(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'approve_shift_request'
    )
  end;
$$;

create or replace function public.can_approve_swap_request(p_requester_id uuid, p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_ceo() then true
    else
      exists (
        select 1 from public.group_permissions gp
        where gp.manager_role = (select role from public.profiles where id = auth.uid())
          and gp.target_role = (select role from public.profiles where id = p_requester_id)
          and gp.permission = 'approve_swap'
      )
      and exists (
        select 1 from public.group_permissions gp
        where gp.manager_role = (select role from public.profiles where id = auth.uid())
          and gp.target_role = (select role from public.profiles where id = p_target_id)
          and gp.permission = 'approve_swap'
      )
  end;
$$;

-- Governs BOTH respond_to_leave_request() and respond_to_attendance_correction()
-- — both already shared this function before this migration; that coupling
-- is preserved on purpose (see plan's Key Design Facts §1).
create or replace function public.can_view_profile(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = p_target_id then true
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'approve_leave'
    )
  end;
$$;

create or replace function public.can_view_profile_calendar(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = p_target_id then true
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'view_calendar'
    )
  end;
$$;

create or replace function public.can_manage_attendance_for(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (select role from public.profiles where id = auth.uid()) in ('ceo', 'technical') then true
    else exists (
      select 1 from public.group_permissions gp
      where gp.manager_role = (select role from public.profiles where id = auth.uid())
        and gp.target_role = (select role from public.profiles where id = p_target_id)
        and gp.permission = 'manage_attendance'
    )
  end;
$$;
