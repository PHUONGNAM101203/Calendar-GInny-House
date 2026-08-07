-- Completes the cutover started in 0024: replaces every remaining
-- branch_id = current_branch_id() check with is_branch_member(auth.uid(),
-- branch_id) — a person now sees rows for EVERY branch they belong to, not
-- just one. Purely additive/widening: after 0032's backfill, anyone who
-- could see a row via their old single branch still can (their branch_id
-- became their sole profile_branches row), and now they also see rows at
-- any additional branch. can_view_profile_calendar()/is_visible_via_roster()
-- OR-clauses are untouched.

drop policy if exists attendance_select_branch on public.attendance;
create policy attendance_select_branch on public.attendance
  for select to authenticated
  using (public.is_branch_member(auth.uid(), branch_id) or public.can_view_profile_calendar(profile_id));

drop policy if exists profiles_select_branch on public.profiles;
create policy profiles_select_branch on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_branch_member(auth.uid(), branch_id)
    or public.can_view_profile_calendar(id)
    or public.is_visible_via_roster(id)
  );

drop policy if exists swaps_select_branch on public.shift_swap_requests;
create policy swaps_select_branch on public.shift_swap_requests
  for select to authenticated
  using (
    public.is_branch_member(auth.uid(), branch_id)
    or public.can_view_profile_calendar(requester_id)
    or public.can_view_profile_calendar(target_id)
  );

drop policy if exists shifts_select_branch on public.shifts;
create policy shifts_select_branch on public.shifts
  for select to authenticated
  using (public.is_branch_member(auth.uid(), branch_id) or public.can_view_profile_calendar(assignee_id));

create or replace function public.is_visible_via_roster(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shifts s
    where s.assignee_id = p_target_id
      and public.is_branch_member(auth.uid(), s.branch_id)
  ) or exists (
    select 1 from public.attendance a
    where a.profile_id = p_target_id
      and public.is_branch_member(auth.uid(), a.branch_id)
  ) or exists (
    select 1 from public.shift_swap_requests w
    where (w.requester_id = p_target_id or w.target_id = p_target_id)
      and public.is_branch_member(auth.uid(), w.branch_id)
  );
$$;

-- request_shift(): today accepts any non-null branch with zero membership
-- check. A front-line requester must now belong to the branch they're
-- requesting a shift at; manager-tier (is_manager()) is exempt, matching
-- the "all branches" convention everywhere else.
create or replace function public.request_shift(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_branch_id uuid,
  p_note text default null,
  p_shift_type public.shift_type default 'morning'
) returns public.shift_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.shift_requests%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_end_at <= p_start_at then
    raise exception 'Giờ kết thúc phải sau giờ bắt đầu' using errcode = '23514';
  end if;
  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;
  if not public.is_manager() and not public.is_branch_member(v_uid, p_branch_id) then
    raise exception 'Bạn không thuộc cơ sở này' using errcode = '23514';
  end if;

  insert into public.shift_requests (profile_id, branch_id, start_at, end_at, note, shift_type)
  values (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''), p_shift_type)
  returning * into v_row;

  return v_row;
end;
$$;
