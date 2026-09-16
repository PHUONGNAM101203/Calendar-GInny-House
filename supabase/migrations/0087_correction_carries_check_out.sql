-- Đơn giải trình giờ vào mang luôn giờ ra.
--
-- Trước đây một đơn chỉ sửa được MỘT đầu của phiên chấm công, và hậu quả dồn
-- hết vào đầu còn lại:
--
--   * Duyệt một đơn 'missed_check_in' chèn dòng attendance chỉ có check_in_at,
--     check_out_at để NULL. Phiên mở vô thời hạn — báo cáo tuần/tháng tính
--     effectiveEnd = check_out_at ?? now(), nên số giờ cứ lớn dần, đúng hiện
--     tượng "chấm công xuyên ngày này sang ngày khác".
--   * Muốn đóng nó phải gửi đơn THỨ HAI loại check_out, mà
--     request_attendance_correction_checkout lại từ chối khi chưa có giờ vào
--     ("vui lòng giải trình giờ vào trước"). Tức thứ tự bị ép cứng: gửi đơn
--     vào → chờ duyệt → gửi đơn ra → chờ duyệt. Hai form, hai lượt duyệt.
--   * Người quên chấm giờ vào gần như luôn quên cả giờ ra, nên lượt hai gần
--     như luôn cần tới.
--
-- Bằng chứng: 12/12 đơn đã duyệt trên production có check_out_at đúng bằng
-- shift.end_at, lệch 0 phút — dấu vết của việc quản lý gõ tay từng cái, chứ
-- không hệ thống nào ghi được chính xác như vậy.
--
-- Cột requested_check_out_at/actual_check_out_at đã có sẵn trên cùng dòng đơn
-- (0074), và khoá duy nhất là (shift_id, kind) nên một đơn kind='check_in'
-- mang thêm giờ ra không đụng gì. Không cần đổi hình bảng.
create or replace function public.request_attendance_correction(
  p_shift_id uuid,
  p_reason text,
  p_requested_check_out_at timestamptz default null
)
returns public.attendance_corrections
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_shift_date date;
  v_attendance public.attendance%rowtype;
  v_issue public.attendance_correction_issue;
  v_row public.attendance_corrections%rowtype;
  v_needs_check_out boolean;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'Vui lòng nhập lý do giải trình' using errcode = '23514';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift is null or v_shift.assignee_id <> v_uid then
    raise exception 'Không tìm thấy ca làm việc này';
  end if;

  v_shift_date := (v_shift.start_at at time zone 'Asia/Ho_Chi_Minh')::date;
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date - v_shift_date > 7 then
    raise exception 'Đã quá hạn 1 tuần để giải trình ca này';
  end if;

  -- Resolve by shift, never by date: this is the row clock_in(p_shift_id)
  -- created for THIS shift. See the header comment for why there is
  -- deliberately no shiftless fallback on the check-in path.
  select * into v_attendance from public.attendance
  where profile_id = v_uid and shift_id = p_shift_id
  order by check_in_at desc
  limit 1;

  if v_attendance is null then
    v_issue := 'missed_check_in';
  elsif v_attendance.check_in_at > v_shift.start_at then
    v_issue := 'late_check_in';
  else
    raise exception 'Ca này không có sai lệch cần giải trình';
  end if;

  -- Bắt buộc khai giờ ra khi phiên chưa có giờ ra, vì đó chính là lỗ hổng cũ:
  -- duyệt xong sẽ để lại một phiên mở không ai đóng. Khi phiên đã có giờ ra
  -- thì để tuỳ chọn — bỏ trống nghĩa là giữ nguyên giờ ra đang có.
  v_needs_check_out := v_attendance is null or v_attendance.check_out_at is null;
  if v_needs_check_out and p_requested_check_out_at is null then
    raise exception 'Vui lòng chọn giờ ra ca' using errcode = '23514';
  end if;

  if p_requested_check_out_at is not null then
    -- So với giờ vào SẼ ĐƯỢC GHI (start_at của ca), không phải giờ vào hiện
    -- có: đơn này dời giờ vào về đúng đầu ca, nên ràng buộc
    -- check_out_at > check_in_at phải được kiểm trên giá trị sau khi dời.
    if p_requested_check_out_at <= v_shift.start_at then
      raise exception 'Giờ ra phải sau giờ vào' using errcode = '23514';
    end if;
    if p_requested_check_out_at > now() then
      raise exception 'Giờ ra không được ở tương lai' using errcode = '23514';
    end if;
    -- Cùng khoảng nới 6 tiếng như request_attendance_correction_checkout, để
    -- một đơn gửi muộn trong hạn 7 ngày không gán được giờ ra vô lý cho ca.
    if p_requested_check_out_at > v_shift.end_at + interval '6 hours' then
      raise exception 'Giờ ra không khớp với ca làm việc này' using errcode = '23514';
    end if;
  end if;

  insert into public.attendance_corrections
    (profile_id, shift_id, attendance_id, issue_type,
     actual_check_in_at, requested_check_in_at,
     actual_check_out_at, requested_check_out_at, reason)
  values (
    v_uid, p_shift_id,
    case when v_issue = 'late_check_in' then v_attendance.id else null end,
    v_issue,
    case when v_issue = 'late_check_in' then v_attendance.check_in_at else null end,
    v_shift.start_at,
    case when v_issue = 'late_check_in' then v_attendance.check_out_at else null end,
    p_requested_check_out_at,
    p_reason
  )
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Ca này đã có đơn giải trình đang chờ duyệt';
end;
$$;

-- Bản cũ hai tham số phải biến mất, nếu không PostgREST sẽ thấy hai overload
-- và một lời gọi thiếu p_requested_check_out_at lại rơi vào đúng nhánh cũ để
-- lại phiên mở — tức lỗi vẫn còn nguyên một đường đi.
drop function if exists public.request_attendance_correction(uuid, text);

revoke all on function public.request_attendance_correction(uuid, text, timestamptz) from public;
grant execute on function public.request_attendance_correction(uuid, text, timestamptz) to authenticated;

-- Duyệt: ghi cả hai đầu trong cùng một lần, không để lại phiên mở nữa.
create or replace function public.respond_to_attendance_correction(p_id uuid, p_approve boolean)
returns public.attendance_corrections
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_existing_attendance_id uuid;
  v_new_attendance_id uuid;
  v_att public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if not public.is_leave_approver() then
    raise exception 'Chỉ quản lý mới được duyệt đơn giải trình công';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id;
  if v_row is null or not public.can_view_profile(v_row.profile_id) then
    raise exception 'Bạn không có quyền duyệt đơn của nhân viên này';
  end if;

  update public.attendance_corrections
  set status = (case when p_approve then 'approved' else 'rejected' end)::attendance_correction_status,
      responder_id = v_uid,
      resolved_at = now()
  where id = p_id and status = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'Đơn giải trình công không hợp lệ hoặc đã được xử lý';
  end if;

  if p_approve then
    if v_row.kind = 'check_out' then
      -- attendance_id is ON DELETE SET NULL; if a sibling check-in
      -- correction for this shift was reverted (deleting a missed_check_in
      -- row) since this correction was filed, attendance_id is now NULL and
      -- the update below would silently match nothing.
      -- `for update` locks the row across the re-validation and the write
      -- below, closing the TOCTOU window where a concurrently approved
      -- check-in correction could move check_in_at between the select and
      -- the update and let the raw constraint violation through.
      select * into v_att from public.attendance where id = v_row.attendance_id for update;
      if not found then
        raise exception 'Không tìm thấy bản ghi chấm công liên quan — vui lòng gửi lại đơn';
      end if;

      -- check_in_at may have moved forward since this correction was filed
      -- (via a separately approved check-in correction on the same row);
      -- without re-checking, the update below could violate attendance's
      -- `check_out_at > check_in_at` constraint and surface a raw error.
      if v_row.requested_check_out_at <= v_att.check_in_at then
        raise exception 'Giờ ra không còn hợp lệ so với giờ vào đã được sửa — vui lòng gửi lại đơn';
      end if;

      update public.attendance
      set check_out_at = v_row.requested_check_out_at
      where id = v_row.attendance_id;
    elsif v_row.issue_type = 'missed_check_in' then
      select id into v_existing_attendance_id
      from public.attendance
      where profile_id = v_row.profile_id and shift_id = v_row.shift_id
      order by check_in_at desc
      limit 1;

      if v_existing_attendance_id is not null then
        update public.attendance
        set check_in_at = v_row.requested_check_in_at,
            -- coalesce: đơn cũ (trước 0087) không mang giờ ra, giữ nguyên
            -- giờ ra đang có thay vì xoá mất nó.
            check_out_at = coalesce(v_row.requested_check_out_at, check_out_at)
        where id = v_existing_attendance_id;
        v_new_attendance_id := v_existing_attendance_id;
      else
        -- Chèn cả check_out_at ngay tại đây. Đây chính là chỗ cũ để lại phiên
        -- mở vô thời hạn.
        insert into public.attendance (profile_id, branch_id, shift_id, check_in_at, check_out_at)
        select v_row.profile_id, s.branch_id, s.id,
               v_row.requested_check_in_at, v_row.requested_check_out_at
        from public.shifts s where s.id = v_row.shift_id
        returning id into v_new_attendance_id;
      end if;

      update public.attendance_corrections
      set attendance_id = v_new_attendance_id
      where id = p_id;
      v_row.attendance_id := v_new_attendance_id;
    else
      update public.attendance
      set check_in_at = v_row.requested_check_in_at,
          check_out_at = coalesce(v_row.requested_check_out_at, check_out_at)
      where id = v_row.attendance_id;
    end if;
  end if;

  return v_row;
end;
$$;
