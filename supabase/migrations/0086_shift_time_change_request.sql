-- Đổi giờ ca của chính mình.
--
-- Một đơn xin đổi giờ ca chính là "một khung ca đề xuất đang chờ duyệt", tức
-- đúng nghĩa một dòng shift_requests. Nên thay vì dựng bảng và đường ống
-- duyệt thứ hai, đơn đổi giờ dùng lại chính bảng này và chỉ khác nhau ở
-- replaces_shift_id: NULL = đăng ký ca mới, NOT NULL = đổi giờ ca đó. Nhờ vậy
-- nó thừa hưởng nguyên người duyệt (can_approve_shift_request), RLS, danh
-- sách chờ duyệt bên quản lý, bóng mờ trên lịch, thông báo, huỷ, xoá và
-- khôi phục — không phần nào phải viết lại.
alter table public.shift_requests
  add column if not exists replaces_shift_id uuid
    references public.shifts(id) on delete cascade,
  -- Khung giờ trước khi duyệt, chỉ ghi lúc duyệt đơn đổi giờ. Không có ba cột
  -- này thì revert_shift_request không biết trả ca về đâu: với đơn đăng ký
  -- mới nó chỉ cần xoá ca đã tạo, còn đơn đổi giờ thì ca vẫn phải tồn tại.
  add column if not exists prev_start_at timestamptz,
  add column if not exists prev_end_at timestamptz,
  add column if not exists prev_branch_id uuid references public.branches(id);

comment on column public.shift_requests.replaces_shift_id is
  'NULL = đăng ký ca mới. NOT NULL = đơn xin đổi khung giờ của ca này.';

-- Một ca chỉ được có một đơn đổi giờ đang chờ. Thiếu ràng buộc này thì duyệt
-- hai đơn liên tiếp sẽ dời ca hai lần và prev_* của đơn sau ghi đè prev_* của
-- đơn trước, khiến khôi phục trả ca về sai khung giờ.
create unique index if not exists shift_requests_one_pending_change
  on public.shift_requests (replaces_shift_id)
  where replaces_shift_id is not null and status = 'pending';

create index if not exists shift_requests_replaces_idx
  on public.shift_requests (replaces_shift_id)
  where replaces_shift_id is not null;

create or replace function public.request_shift_change(
  p_shift_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_branch_id uuid,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.assignee_id <> v_uid then
    raise exception 'Bạn chỉ có thể đổi giờ ca của chính mình';
  end if;
  if v_shift.start_at <= now() then
    raise exception 'Không thể đổi giờ ca đã bắt đầu';
  end if;
  if p_end_at <= p_start_at then
    raise exception 'Giờ kết thúc phải sau giờ bắt đầu';
  end if;
  if p_start_at <= now() then
    raise exception 'Khung giờ mới phải ở tương lai';
  end if;
  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở';
  end if;
  if not public.is_branch_member(v_uid, p_branch_id)
     and not public.is_remote_branch(p_branch_id) then
    raise exception 'Bạn không thuộc cơ sở này';
  end if;
  if exists (select 1 from public.attendance where shift_id = p_shift_id) then
    raise exception 'Ca đã có chấm công — không thể đổi giờ';
  end if;
  if exists (select 1 from public.shift_requests
             where replaces_shift_id = p_shift_id and status = 'pending') then
    raise exception 'Ca này đã có yêu cầu đổi giờ đang chờ';
  end if;
  -- Hai luồng cùng tranh một ca: nếu ca đang chờ đổi cho người khác mà lại
  -- dời giờ, người nhận sẽ nhận một khung giờ khác với lúc họ đồng ý.
  if exists (select 1 from public.shift_swap_requests
             where (requester_shift_id = p_shift_id or target_shift_id = p_shift_id)
               and status = 'pending') then
    raise exception 'Ca này đang có yêu cầu đổi ca chờ duyệt';
  end if;

  -- shift_type và covering_role kế thừa từ chính ca gốc: form này chỉ đổi
  -- khung giờ, đổi vai trò ca là quyết định khác vì nó động tới luật
  -- một-suất-quản-sinh.
  insert into public.shift_requests
    (profile_id, branch_id, start_at, end_at, note, shift_type,
     covering_role, replaces_shift_id)
  values
    (v_uid, p_branch_id, p_start_at, p_end_at, nullif(p_note, ''),
     v_shift.shift_type, v_shift.covering_role, p_shift_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.request_shift_change(uuid, timestamptz, timestamptz, uuid, text) from public;
grant execute on function public.request_shift_change(uuid, timestamptz, timestamptz, uuid, text) to authenticated;

-- Duyệt: đơn đăng ký mới vẫn INSERT như cũ; đơn đổi giờ thì UPDATE ca đã nêu.
create or replace function public.respond_to_shift_request(p_id uuid, p_approve boolean)
returns public.shift_requests
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_requests%rowtype;
  v_shift public.shifts%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  select * into v_req from public.shift_requests where id = p_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'Đơn đăng ký không còn hiệu lực';
  end if;

  if not public.can_approve_shift_request(v_req.profile_id) then
    raise exception 'Bạn không có quyền duyệt đăng ký ca này';
  end if;

  if p_approve then
    if v_req.replaces_shift_id is null then
      insert into public.shifts (assignee_id, start_at, end_at, note, created_by, shift_type, branch_id, shift_request_id)
      values (v_req.profile_id, v_req.start_at, v_req.end_at, v_req.note, v_uid, v_req.shift_type, v_req.branch_id, p_id);
    else
      select * into v_shift from public.shifts
        where id = v_req.replaces_shift_id for update;
      if not found then
        raise exception 'Ca gốc không còn tồn tại — đơn không còn hiệu lực';
      end if;
      if v_shift.assignee_id <> v_req.profile_id then
        raise exception 'Ca gốc đã đổi sang người khác — đơn không còn hiệu lực';
      end if;
      if v_shift.start_at <= now() then
        raise exception 'Ca gốc đã bắt đầu — không thể đổi giờ';
      end if;
      if exists (select 1 from public.attendance where shift_id = v_shift.id) then
        raise exception 'Ca đã có chấm công — không thể đổi giờ';
      end if;

      -- Ghi khung giờ cũ TRƯỚC khi dời, để khôi phục còn đường về.
      update public.shift_requests
      set prev_start_at = v_shift.start_at,
          prev_end_at = v_shift.end_at,
          prev_branch_id = v_shift.branch_id
      where id = p_id;

      -- shifts_no_overlap, trg_student_affairs_single_slot và
      -- shifts_reception_assignee đều chạy trên UPDATE, nên luật trùng giờ và
      -- luật một-suất-quản-sinh tự giữ ở đây, không cần chép lại.
      update public.shifts
      set start_at = v_req.start_at,
          end_at = v_req.end_at,
          branch_id = v_req.branch_id
      where id = v_shift.id;
    end if;
  end if;

  update public.shift_requests
  set status = (case when p_approve then 'approved' else 'rejected' end)::public.shift_request_status,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id
  returning * into v_req;

  return v_req;
end;
$$;

-- Khôi phục: đơn đăng ký mới thì xoá ca đã tạo (như cũ); đơn đổi giờ thì trả
-- khung giờ cũ về chứ không xoá ca — ca ấy có từ trước đơn này.
create or replace function public.revert_shift_request(p_id uuid)
returns public.shift_requests
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.shift_requests%rowtype;
  v_shift public.shifts%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  select * into v_req from public.shift_requests where id = p_id for update;
  if not found or v_req.status = 'pending' then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  if v_req.status = 'approved' and v_req.replaces_shift_id is not null then
    if v_req.prev_start_at is null then
      raise exception 'Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động' using errcode = '23514';
    end if;
    select * into v_shift from public.shifts where id = v_req.replaces_shift_id;
    if not found then
      raise exception 'Ca gốc đã bị xoá — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if v_shift.assignee_id <> v_req.profile_id then
      raise exception 'Ca đã bị đổi cho người khác — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (select 1 from public.attendance where shift_id = v_shift.id) then
      raise exception 'Ca đã có chấm công — không thể khôi phục tự động' using errcode = '23514';
    end if;

    update public.shifts
    set start_at = v_req.prev_start_at,
        end_at = v_req.prev_end_at,
        branch_id = coalesce(v_req.prev_branch_id, branch_id)
    where id = v_shift.id;

  elsif v_req.status = 'approved' then
    select * into v_shift from public.shifts where shift_request_id = p_id;
    if not found then
      raise exception 'Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_shift.assignee_id <> v_req.profile_id then
      raise exception 'Ca đã bị đổi cho người khác — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (select 1 from public.attendance where shift_id = v_shift.id) then
      raise exception 'Ca đã có chấm công — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (select 1 from public.shift_swap_requests
               where requester_shift_id = v_shift.id or target_shift_id = v_shift.id) then
      raise exception 'Ca đã liên quan đến yêu cầu đổi ca — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (select 1 from public.attendance_corrections where shift_id = v_shift.id) then
      raise exception 'Ca đã liên quan đến giải trình công — không thể khôi phục tự động' using errcode = '23514';
    end if;

    delete from public.shifts where id = v_shift.id;
  end if;

  update public.shift_requests
  set status = 'pending', responder_id = null, resolved_at = null,
      prev_start_at = null, prev_end_at = null, prev_branch_id = null
  where id = p_id
  returning * into v_req;

  return v_req;
end;
$$;
