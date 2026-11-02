-- Giải trình công phiên tự do: khai được cả GIỜ VÀO.
--
-- 0093 mở đường giải trình cho phiên chấm công tự do của trợ giảng, nhưng chỉ
-- cho sửa GIỜ RA. Dữ liệu thật cho thấy chỗ hở nằm ở đầu kia: người ta quên
-- bấm vào, chấm vào muộn, rồi chỉ khai lại được giờ ra.
--
--   Anh Thư 20/10: lý do ghi "Ca này của e bắt đầu từ 19:30 đến 21:00", nhưng
--   phiên thật là 21:17 -> 21:18. Đơn "giờ ra" được duyệt và kết quả vẫn là 0,0
--   giờ công — vì giờ vào 21:17 không có cách nào sửa.
--   Thùy Dung 25/10: "em quên chấm công vào nên bị chấm công muộn", đơn đề
--   nghị giờ ra đúng bằng giờ ra cũ.
--
-- Cả hai đều phải nhờ quản lý sửa tay. Nên đơn giờ vào cho phiên tự do phải
-- mang được cả hai đầu.
--
-- Dùng lại issue_type 'late_check_in' (kind sinh ra là check_in) cùng cột
-- requested_check_out_at sẵn có từ 0071; nhánh duyệt của
-- respond_to_attendance_correction đã ghi cả hai đầu với coalesce từ 0087, nên
-- không cần sửa hàm duyệt.
--
-- KHÔNG tạo phiên từ con số không (quên chấm vào HẲN, không có phiên nào): đó là
-- khai số giờ chưa từng có bằng chứng chấm công, tức một quyết định chính sách
-- về lương chứ không phải một bản sửa lỗi. Quản lý vẫn tạo tay được.
drop function if exists public.request_attendance_correction_session(uuid, timestamptz, text);

create or replace function public.request_attendance_correction_session(
  p_attendance_id uuid,
  p_requested_check_out_at timestamptz,
  p_reason text,
  p_requested_check_in_at timestamptz default null
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
  v_in timestamptz;
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

  -- Hạn 1 tuần tính từ NGÀY VÀO ĐANG GHI NHẬN, theo giờ Việt Nam.
  if (now() at time zone 'Asia/Ho_Chi_Minh')::date
       - (v_att.check_in_at at time zone 'Asia/Ho_Chi_Minh')::date > 7 then
    raise exception 'Đã quá hạn 1 tuần để giải trình phiên này';
  end if;

  -- Giờ vào đề nghị chỉ được SỚM hơn giờ đang ghi nhận: đây là đường cho người
  -- chấm vào muộn khai lại. Dời giờ vào về phía sau chỉ làm giảm giờ công của
  -- chính họ và không có tình huống nào cần tới.
  if p_requested_check_in_at is not null then
    if p_requested_check_in_at >= v_att.check_in_at then
      raise exception 'Giờ vào đề nghị phải sớm hơn giờ đang ghi nhận' using errcode = '23514';
    end if;
    v_in := p_requested_check_in_at;
  else
    v_in := v_att.check_in_at;
  end if;

  if p_requested_check_out_at <= v_in then
    raise exception 'Giờ ra phải sau giờ vào' using errcode = '23514';
  end if;
  if p_requested_check_out_at > now() then
    raise exception 'Giờ ra không được ở tương lai' using errcode = '23514';
  end if;

  -- Trần 16 giờ tính trên giờ vào SAU KHI sửa: kéo giờ vào sớm hơn không được
  -- phép lách trần bằng cách khai một phiên dài hơn.
  if p_requested_check_out_at - v_in > interval '16 hours' then
    raise exception 'Phiên chấm công tự do không thể dài quá 16 giờ' using errcode = '23514';
  end if;

  -- Không có gì để sửa: không đổi giờ vào và giờ ra đề nghị trùng giờ ra hiện có.
  if p_requested_check_in_at is null
     and v_att.check_out_at is not distinct from p_requested_check_out_at then
    raise exception 'Giờ ra đề nghị trùng với giờ đang ghi nhận' using errcode = '23514';
  end if;

  -- Kéo giờ vào sớm lên có thể đè lên lần chấm công liền trước của chính người
  -- này. Phiên chưa đóng tính là kéo dài vô hạn.
  if exists (
    select 1 from public.attendance o
    where o.profile_id = v_uid
      and o.id <> v_att.id
      and tstzrange(o.check_in_at, coalesce(o.check_out_at, 'infinity'::timestamptz))
          && tstzrange(v_in, p_requested_check_out_at)
  ) then
    raise exception 'Khung giờ đề nghị trùng với một lần chấm công khác của bạn' using errcode = '23514';
  end if;

  -- Một phiên một đơn chờ, bất kể loại. Hai index duy nhất chỉ chặn trùng CÙNG
  -- loại; đơn giờ vào (mang cả giờ ra) và đơn giờ ra chờ song song sẽ cùng ghi
  -- vào một giờ ra và duyệt cái nào trước thì cái kia thành vô nghĩa.
  if exists (
    select 1 from public.attendance_corrections
    where attendance_id = v_att.id and shift_id is null and status = 'pending'
  ) then
    raise exception 'Phiên này đã có đơn giải trình đang chờ duyệt';
  end if;

  v_issue := case
    when p_requested_check_in_at is not null then 'late_check_in'
    when v_att.check_out_at is null then 'missed_check_out'
    else 'adjust_check_out'
  end;

  insert into public.attendance_corrections
    (profile_id, shift_id, attendance_id, issue_type,
     actual_check_in_at, requested_check_in_at,
     actual_check_out_at, requested_check_out_at, reason)
  values
    (v_uid, null, v_att.id, v_issue,
     case when v_issue = 'late_check_in' then v_att.check_in_at end,
     p_requested_check_in_at,
     v_att.check_out_at, p_requested_check_out_at, p_reason)
  returning * into v_row;

  return v_row;
exception
  when unique_violation then
    raise exception 'Phiên này đã có đơn giải trình đang chờ duyệt';
end;
$$;

revoke all on function public.request_attendance_correction_session(uuid, timestamptz, text, timestamptz) from public;
grant execute on function public.request_attendance_correction_session(uuid, timestamptz, text, timestamptz)
  to authenticated, service_role;
