-- Tự đóng phiên chấm công bị bỏ quên.
--
-- 0087 bịt đường để lại phiên mở qua đơn giải trình, nhưng vẫn còn một đường
-- nữa: chấm vào bình thường rồi quên chấm ra. find_stale_checkout_sessions
-- (0063) có nhắc, nhưng không ai đóng — và báo cáo tuần/tháng tính
-- effectiveEnd = check_out_at ?? now(), nên một phiên bỏ quên cứ lớn dần cho
-- tới khi quản lý sửa tay.
--
-- Chỉ đóng phiên CÓ GẮN CA, và đóng tại đúng giờ kết thúc ca. Đó là giờ duy
-- nhất hệ thống có cơ sở để khẳng định, và cũng đúng là giờ quản lý vẫn gõ
-- tay: 12/12 đơn đã duyệt trên production có check_out_at bằng shift.end_at,
-- lệch 0 phút.
--
-- Phiên KHÔNG gắn ca (trợ giảng chấm tự do) cố ý không đụng tới: không có
-- giờ nào để neo, nên mọi con số đều là bịa ra trên dữ liệu lương. Chúng
-- được chặn ở phía báo cáo bằng trần 12 tiếng thay vì bị đoán bừa.
alter table public.attendance
  add column if not exists auto_closed_at timestamptz;

comment on column public.attendance.auto_closed_at is
  'Khác null = giờ ra do hệ thống tự điền tại giờ kết thúc ca, không phải giờ đo được. Nhân viên giải trình lại nếu thực tế khác.';

create or replace function public.close_abandoned_attendance()
returns table (
  attendance_id uuid,
  profile_id uuid,
  full_name text,
  shift_id uuid,
  check_in_at timestamptz,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  with closed as (
    update public.attendance a
    set check_out_at = s.end_at,
        auto_closed_at = now()
    from public.shifts s
    where s.id = a.shift_id
      and a.check_out_at is null
      -- Đợi hết 6 tiếng sau giờ tan ca mới đóng, đúng bằng khoảng nới mà
      -- request_attendance_correction_checkout cho phép. Đóng sớm hơn là
      -- giẫm lên một lần chấm ra muộn hoàn toàn hợp lệ.
      and s.end_at < now() - interval '6 hours'
      -- Chấm vào sau khi ca đã tan thì giờ kết thúc ca không dùng làm giờ ra
      -- được — nó sẽ vi phạm ràng buộc check_out_at > check_in_at. Để nguyên
      -- cho người ta tự giải trình.
      and s.end_at > a.check_in_at
    returning a.id, a.profile_id, a.shift_id, a.check_in_at, a.check_out_at
  )
  select c.id, c.profile_id, p.full_name, c.shift_id, c.check_in_at, c.check_out_at
  from closed c
  join public.profiles p on p.id = c.profile_id;
end;
$$;

-- Chỉ cron (service_role) được gọi. Đây là hàm ghi thẳng vào dữ liệu công của
-- người khác, không có lý do nào để một phiên đăng nhập thường chạm tới.
revoke all on function public.close_abandoned_attendance() from public;
grant execute on function public.close_abandoned_attendance() to service_role;

-- Vòng lặp thật sự đẩy người ta đi giải trình 4-5 lần.
--
-- attendance_one_open_per_profile là unique(profile_id) where check_out_at is
-- null: mỗi người chỉ được một phiên mở. Nên ai quên chấm ra thì KHÔNG chấm
-- vào được ca kế tiếp — clock_in ném thẳng 'Bạn đã chấm công vào rồi'. Ca ở
-- đây trung bình 2,9 tiếng và người ta hay làm ca sáng lẫn ca chiều, nên
-- quên chấm ra lúc 12h là chặn luôn ca 14h. Ca đó thành "quên chấm công",
-- lại phải giải trình — và đó là đơn thứ hai, thứ ba.
--
-- Cron ở trên chờ 6 tiếng sau giờ tan ca để không giẫm lên một lần chấm ra
-- muộn hợp lệ. Ở đây không cần chờ: người ta đang đứng chấm vào một ca khác,
-- tức ca cũ chắc chắn đã kết thúc.
create or replace function public.clock_in(p_branch_id uuid default null)
returns public.attendance
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_role public.staff_role;
  v_secondary public.staff_role;
  v_row public.attendance%rowtype;
  v_open public.attendance%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;

  -- Đóng phiên bỏ quên của chính người này TRƯỚC khi chặn.
  update public.attendance a
  set check_out_at = s.end_at,
      auto_closed_at = now()
  from public.shifts s
  where a.profile_id = v_uid
    and a.check_out_at is null
    and s.id = a.shift_id
    and s.end_at < now()
    -- Chấm vào sau khi ca đã tan thì giờ tan ca không dùng làm giờ ra được.
    and s.end_at > a.check_in_at;

  -- Còn sót phiên mở thì gần như luôn là phiên chấm tự do (không gắn ca), thứ
  -- không có giờ nào để neo nên hệ thống không được phép tự đoán. Nói rõ nó
  -- bắt đầu lúc nào và phải làm gì, thay vì câu 'Bạn đã chấm công vào rồi'
  -- chẳng gợi ý được gì.
  select * into v_open from public.attendance
  where profile_id = v_uid and check_out_at is null
  limit 1;
  if found then
    raise exception 'Bạn còn một lần chấm công chưa chấm ra từ % — hãy chấm công ra hoặc gửi giải trình giờ ra trước.',
      to_char(v_open.check_in_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')
      using errcode = '23514';
  end if;

  select * into v_shift from public.shifts s
  where s.assignee_id = v_uid
    and now() >= s.start_at - interval '1 hour'
    and now() <= s.end_at
    and not exists (select 1 from public.attendance a where a.shift_id = s.id)
  order by s.start_at asc
  limit 1;

  if v_shift.id is not null then
    insert into public.attendance (profile_id, branch_id, shift_id)
    values (v_uid, v_shift.branch_id, v_shift.id)
    returning * into v_row;
    return v_row;
  end if;

  select role, secondary_role into v_role, v_secondary from public.profiles where id = v_uid;

  -- `is distinct from`, not `<>`/`not in` — the same NULL trap fixed in
  -- 0053: for a single-role profile v_secondary is NULL, and NULL <> x is
  -- NULL (falsy-but-not-false), which would silently let this branch fall
  -- straight to the "no shift" rejection for a pure teaching_assistant
  -- profile too if written the naive way.
  if v_role <> 'teaching_assistant' and v_secondary is distinct from 'teaching_assistant' then
    raise exception 'Bạn không có ca làm việc nào trong khung giờ này' using errcode = '23514';
  end if;

  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;
  if not public.is_branch_member(v_uid, p_branch_id) then
    raise exception 'Bạn không thuộc cơ sở này' using errcode = '23514';
  end if;

  insert into public.attendance (profile_id, branch_id, shift_id)
  values (v_uid, p_branch_id, null)
  returning * into v_row;

  return v_row;
end;
$$;
