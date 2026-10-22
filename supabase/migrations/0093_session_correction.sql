-- Giải trình công cho phiên chấm công TỰ DO (trợ giảng, không gắn ca).
--
-- Trợ giảng chấm công tự do: phiên của họ không có shift_id. Luồng giải trình
-- trước nay bắt đầu từ CA — form tìm ca theo ngày, mọi RPC nhận p_shift_id, và
-- attendance_corrections.shift_id là NOT NULL — nên phiên không có ca thì không
-- có chỗ nào để đứng. Form chỉ trả "Bạn không có ca làm việc vào ngày này".
--
-- Hậu quả thật, đo trên production: 153 phiên tự do, trong đó 3 phiên dài tới
-- 26,1h / 24,2h / 15,2h — dấu hiệu quên chấm ra — mà người trong cuộc không có
-- đường nào tự khai lại. Và bản clock_in ở 0088 còn chủ động gửi họ tới đó:
-- "hãy chấm công ra hoặc gửi giải trình giờ ra trước", trong khi đường ấy chưa
-- tồn tại.
--
-- Làm một RPC riêng neo theo attendance_id chứ không kéo giãn
-- request_attendance_correction_checkout: nhánh "shiftless fallback" của nó vẫn
-- đòi người gọi sở hữu một ca trong ngày, vô dụng với người chỉ chấm tự do.

-- 1. Đơn không ca.
alter table public.attendance_corrections alter column shift_id drop not null;

-- 2. Chống đơn trùng. Index sẵn có (shift_id, kind) coi các NULL là khác nhau,
--    nên với shift_id null nó cho phép vô hạn đơn chờ trùng nhau.
create unique index if not exists attendance_corrections_one_pending_per_session
  on public.attendance_corrections (attendance_id, kind)
  where status = 'pending' and shift_id is null;

-- Cố ý KHÔNG thêm CHECK "shift_id is not null or attendance_id is not null".
-- attendance_id là ON DELETE SET NULL: xoá một phiên (nút thùng rác của quản lý)
-- sẽ vi phạm CHECK đó và việc xoá thất bại. Bất biến được giữ ở RPC bên dưới;
-- còn người đọc phải chịu được đơn mất cả hai.

-- 3. RPC mới.
create or replace function public.request_attendance_correction_session(
  p_attendance_id uuid,
  p_requested_check_out_at timestamptz,
  p_reason text
) returns public.attendance_corrections
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_att public.attendance%rowtype;
  v_row public.attendance_corrections%rowtype;
  v_issue public.attendance_correction_issue;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'Vui lòng nhập lý do giải trình' using errcode = '23514';
  end if;
  if p_requested_check_out_at is null then
    raise exception 'Vui lòng chọn giờ ra ca' using errcode = '23514';
  end if;

  select * into v_att from public.attendance where id = p_attendance_id;
  if v_att is null or v_att.profile_id <> v_uid then
    raise exception 'Không tìm thấy phiên chấm công này';
  end if;

  -- Phiên gắn ca thì đi đường giải trình theo ca, nơi có các chốt neo theo giờ
  -- ca. Mở cửa này cho phiên có ca sẽ lách qua toàn bộ các chốt đó.
  if v_att.shift_id is not null then
    raise exception 'Phiên này thuộc một ca — hãy giải trình theo ca' using errcode = '23514';
  end if;

  -- Hạn 1 tuần tính từ NGÀY VÀO của phiên, theo giờ Việt Nam — giống đường giải
  -- trình theo ca tính từ ngày của ca.
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date
       - (v_att.check_in_at at time zone 'Asia/Ho_Chi_Minh')::date > 7 then
    raise exception 'Đã quá hạn 1 tuần để giải trình phiên này';
  end if;

  if p_requested_check_out_at <= v_att.check_in_at then
    raise exception 'Giờ ra phải sau giờ vào' using errcode = '23514';
  end if;
  if p_requested_check_out_at > now() then
    raise exception 'Giờ ra không được ở tương lai' using errcode = '23514';
  end if;

  -- Phiên tự do không có giờ ca nào để neo, nên cần một trần cứng đặt ở CHÍNH
  -- database chứ không chỉ ở app: không thì ai gọi thẳng RPC cũng khai được một
  -- phiên dài vô lý. 16 tiếng bằng trần đang dùng ở phía app cho nhánh này.
  if p_requested_check_out_at - v_att.check_in_at > interval '16 hours' then
    raise exception 'Phiên chấm công tự do không thể dài quá 16 giờ' using errcode = '23514';
  end if;

  if v_att.check_out_at is not distinct from p_requested_check_out_at then
    raise exception 'Giờ ra đề nghị trùng với giờ đang ghi nhận' using errcode = '23514';
  end if;

  v_issue := case
    when v_att.check_out_at is null then 'missed_check_out'
    else 'adjust_check_out'
  end;

  insert into public.attendance_corrections
    (profile_id, shift_id, attendance_id, issue_type,
     actual_check_out_at, requested_check_out_at, reason)
  values
    (v_uid, null, v_att.id, v_issue,
     v_att.check_out_at, p_requested_check_out_at, p_reason)
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Phiên này đã có đơn giải trình giờ ra đang chờ duyệt';
end;
$$;

revoke all on function public.request_attendance_correction_session(uuid, timestamptz, text) from public;
grant execute on function public.request_attendance_correction_session(uuid, timestamptz, text)
  to authenticated, service_role;

-- 4. Khôi phục: chốt "đã có đơn khác đang chờ" phải biết cả đơn không ca.
--    Bản cũ so `shift_id = v_row.shift_id`; với shift_id null phép so trả null nên
--    chốt lặng lẽ không chạy, và khôi phục sẽ đụng thẳng index duy nhất ở trên
--    thành một lỗi thô không ai dịch.
create or replace function public.revert_attendance_correction(p_id uuid)
returns public.attendance_corrections
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.attendance_corrections%rowtype;
  v_att public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if (select role from public.profiles where id = v_uid) <> 'technical' then
    raise exception 'Chỉ Kỹ thuật mới có thể khôi phục đơn';
  end if;

  select * into v_row from public.attendance_corrections where id = p_id for update;
  if not found or v_row.status = 'pending' then
    raise exception 'Đơn không hợp lệ hoặc đang chờ duyệt';
  end if;

  if exists (
    select 1 from public.attendance_corrections
    where id <> p_id and kind = v_row.kind and status = 'pending'
      and (
        shift_id = v_row.shift_id
        or (v_row.shift_id is null and shift_id is null and attendance_id = v_row.attendance_id)
      )
  ) then
    raise exception 'Ca này đã có đơn giải trình khác đang chờ duyệt — không thể khôi phục tự động' using errcode = '23514';
  end if;

  if v_row.status = 'approved' then
    if v_row.attendance_id is null then
      raise exception 'Đơn duyệt trước khi có tính năng khôi phục — không thể khôi phục tự động' using errcode = '23514';
    end if;

    select * into v_att from public.attendance where id = v_row.attendance_id;
    if not found then
      raise exception 'Không tìm thấy bản ghi chấm công liên quan — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if v_row.kind = 'check_in' and v_att.check_out_at is not null then
      raise exception 'Bản ghi chấm công đã có giờ ra — không thể khôi phục tự động' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.attendance_corrections
      where attendance_id = v_row.attendance_id and kind = v_row.kind and id <> p_id and status = 'approved'
    ) then
      raise exception 'Bản ghi chấm công đã bị sửa bởi đơn giải trình khác — không thể khôi phục tự động' using errcode = '23514';
    end if;

    if v_row.kind = 'check_out' then
      -- Guards against silently discarding a manual fix made after
      -- approval: if check_out_at no longer matches what this correction
      -- wrote, someone else has touched the row since, and overwriting it
      -- would clobber that edit.
      if v_att.check_out_at is distinct from v_row.requested_check_out_at then
        raise exception 'Bản ghi chấm công đã bị sửa sau khi duyệt — không thể khôi phục tự động' using errcode = '23514';
      end if;

      -- Reverting a missed_check_out correction restores actual_check_out_at,
      -- which is NULL — reopening the session. attendance_one_open_per_profile
      -- (0046) is a partial unique index on (profile_id) where check_out_at
      -- is null, so this must be checked explicitly or a raw unique-violation
      -- would reach the user unmapped.
      if v_row.actual_check_out_at is null and exists (
        select 1 from public.attendance
        where profile_id = v_row.profile_id
          and check_out_at is null
          and id <> v_row.attendance_id
      ) then
        raise exception 'Nhân viên đang có ca chưa chấm công ra — không thể khôi phục tự động' using errcode = '23514';
      end if;

      -- Restores the previous check-out, or reopens the session when the
      -- correction had supplied a missing one (actual_check_out_at is NULL).
      update public.attendance set check_out_at = v_row.actual_check_out_at where id = v_row.attendance_id;
    elsif v_row.issue_type = 'missed_check_in' then
      delete from public.attendance where id = v_row.attendance_id;
    else
      update public.attendance set check_in_at = v_row.actual_check_in_at where id = v_row.attendance_id;
    end if;
  end if;

  update public.attendance_corrections
  set status = 'pending', responder_id = null, resolved_at = null
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;
