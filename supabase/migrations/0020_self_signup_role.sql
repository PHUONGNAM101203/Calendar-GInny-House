-- Lets a new user pick their real front-line role at signup instead of
-- everyone silently defaulting to 'teacher' (profiles.role's column
-- default) and waiting on a manager to notice and fix it.
--
-- Security boundary: raw_user_meta_data is fully client-controlled — a
-- forged signup request could set role to anything. This function is the
-- actual whitelist enforcement (mirrors lib/roles.ts SELF_SIGNUP_ROLES),
-- not the client-side Zod schema or dropdown. Anything outside the
-- whitelist (including every management/approver role: ceo, coo,
-- training_director, hr, technical) silently falls back to 'teacher'
-- rather than erroring, so a malformed/missing value never blocks signup.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.staff_role;
begin
  begin
    v_role := nullif(new.raw_user_meta_data ->> 'role', '')::public.staff_role;
  exception when invalid_text_representation then
    v_role := null;
  end;

  if v_role is null or v_role not in (
    'teacher', 'operations_staff', 'student_affairs', 'teaching_assistant', 'collaborator', 'customer_care'
  ) then
    v_role := 'teacher';
  end if;

  insert into public.profiles (id, full_name, branch_id, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'branch_id', '')::uuid,
    v_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
