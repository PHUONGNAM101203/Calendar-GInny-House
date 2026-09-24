-- Nhiệm vụ của ca lấy từ vai trò của chính người được xếp.
--
-- 0090 cho chọn nhiệm vụ từ một danh sách cố định bảy vai trò, kể cả khi ca
-- chưa có ai. Người xếp lịch phản hồi hai điểm: nhiệm vụ phải lấy theo vai trò
-- ĐƯỢC PHÂN của người được chọn, và chỉ hiện ô đó khi đã chọn người — lên lịch
-- trống thì chưa có nhiệm vụ nào để nói.
--
-- Giữ nguyên mô hình đã chốt ở 0055/0056: một ca LUÔN là vai trò chính của
-- người giữ nó, không có bộ chọn nhiệm vụ chung; phần việc trợ giảng của người
-- hai vai trò ghi bằng một lần chấm công tự do không gắn ca. 0085 mở đúng một
-- ngoại lệ là lễ tân, qua shifts.covering_role. Nên "vai trò của người này"
-- trong thực tế là: vai trò chính, cộng Lễ tân nếu có kiêm — và
-- shifts_covering_role_valid giữ nguyên, không nới.
--
-- Hệ quả: ô trống không mang nhiệm vụ, nên cột thêm ở 0090 thành vô dụng.
alter table public.shift_slots drop column if exists duty_role;

-- Xếp người vào ô trống: nhận nhiệm vụ từ người gọi, vì đến lúc này mới biết
-- người là ai, tức mới biết họ có kiêm lễ tân hay không. Trước đó 0090 đọc
-- nhiệm vụ từ chính ô trống — cột vừa bị bỏ ở trên.
drop function if exists public.assign_shift_slot(uuid, uuid);

create or replace function public.assign_shift_slot(
  p_slot_id uuid,
  p_assignee_id uuid,
  p_covering_role public.staff_role default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_slot  public.shift_slots%rowtype;
  v_shift public.shifts%rowtype;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_assignee_id is null then
    raise exception 'Vui lòng chọn nhân viên' using errcode = '23514';
  end if;
  if not public.can_manage_shift_for(p_assignee_id) then
    raise exception 'Bạn không có quyền xếp ca cho nhân viên này';
  end if;

  -- for update: hai quản lý cùng gán một ô trống thì người thứ hai phải thấy
  -- nó đã biến mất, chứ không tạo ra ca thứ hai từ cùng một kế hoạch.
  select * into v_slot from public.shift_slots where id = p_slot_id for update;
  if not found then
    raise exception 'Ô ca này không còn nữa' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.shifts s
    where s.assignee_id = p_assignee_id
      and tstzrange(s.start_at, s.end_at) && tstzrange(v_slot.start_at, v_slot.end_at)
  ) then
    raise exception 'Nhân viên này đã có ca trùng giờ' using errcode = '23505';
  end if;

  -- Trigger enforce_reception_shift_assignee từ chối giao ca lễ tân cho người
  -- không kiêm lễ tân, nên ở đây không kiểm lại.
  insert into public.shifts (
    assignee_id, branch_id, start_at, end_at, shift_type, note, created_by, series_id, covering_role
  ) values (
    p_assignee_id, v_slot.branch_id, v_slot.start_at, v_slot.end_at,
    v_slot.shift_type, v_slot.note, v_uid, v_slot.series_id, p_covering_role
  ) returning * into v_shift;

  delete from public.shift_slots where id = p_slot_id;

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'assignee_id', p_assignee_id,
    'start_at', v_shift.start_at,
    'end_at', v_shift.end_at
  );
end;
$$;

revoke all on function public.assign_shift_slot(uuid, uuid, public.staff_role) from public;
grant execute on function public.assign_shift_slot(uuid, uuid, public.staff_role) to authenticated, service_role;

-- Bỏ phần ghi nhiệm vụ xuống ô trống (cột đã bị xoá ở trên). Phần đổ nhiệm vụ
-- lễ tân xuống ca thật khi ca cố định đã có người thì giữ nguyên như 0090.
create or replace function public.materialise_shift_series(p_series_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_zone     constant text := 'Asia/Ho_Chi_Minh';
  v_series   public.shift_series%rowtype;
  v_anchor   date;
  v_date     date;
  v_dow      smallint;
  v_end_date date;
  v_start    timestamptz;
  v_end      timestamptz;
  v_created  int := 0;
  v_skipped  jsonb := '[]'::jsonb;
  v_covering public.staff_role;
begin
  select * into v_series from public.shift_series where id = p_series_id;
  if not found then
    raise exception 'Không tìm thấy ca cố định' using errcode = '23514';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    return jsonb_build_object('created', 0, 'skipped', v_skipped);
  end if;

  -- Chỉ nhiệm vụ lễ tân đổ được xuống shifts.covering_role — ràng buộc
  -- shifts_covering_role_valid chỉ nhận null hoặc 'receptionist', và đó là
  -- ngoại lệ duy nhất mô hình 0056 chừa lại.
  v_covering := case when v_series.duty_role = 'receptionist' then 'receptionist'::public.staff_role end;

  v_anchor := v_series.starts_on - extract(dow from v_series.starts_on)::int;

  v_date := p_from;
  while v_date <= p_to loop
    v_dow := extract(dow from v_date)::smallint;
    if v_dow = any(v_series.weekdays)
       and (((v_date - v_dow::int) - v_anchor) / 7) % v_series.interval_weeks = 0 then

      -- (date + time) ra timestamp không múi giờ; at time zone gán nó là giờ
      -- Việt Nam rồi đổi sang timestamptz. Không dùng now() hay Date của tiến
      -- trình app — tiến trình đó không đặt TZ.
      v_start := (v_date + v_series.start_time) at time zone v_zone;
      v_end_date := case
        when v_series.end_time <= v_series.start_time then v_date + 1
        else v_date
      end;
      v_end := (v_end_date + v_series.end_time) at time zone v_zone;

      if v_series.assignee_id is null then
        -- Hai ô trống trùng giờ là vô hại (chưa có ai để đụng lịch), nhưng
        -- cron chạy lại trong cùng một ngày thì không được đẻ ra ô thứ hai.
        if not exists (
          select 1 from public.shift_slots sl
          where sl.series_id = v_series.id and sl.start_at = v_start
        ) then
          insert into public.shift_slots (
            branch_id, series_id, shift_type, note, start_at, end_at, created_by
          ) values (
            v_series.branch_id, v_series.id, v_series.shift_type, v_series.note,
            v_start, v_end, v_series.created_by
          );
          v_created := v_created + 1;
        end if;
      elsif exists (
        select 1 from public.shifts s
        where s.assignee_id = v_series.assignee_id
          and tstzrange(s.start_at, s.end_at) && tstzrange(v_start, v_end)
      ) then
        v_skipped := v_skipped || jsonb_build_object('date', v_date, 'reason', 'Đã có ca trùng giờ');
      else
        begin
          insert into public.shifts (
            assignee_id, branch_id, start_at, end_at, shift_type, note, created_by, series_id, covering_role
          ) values (
            v_series.assignee_id, v_series.branch_id, v_start, v_end,
            v_series.shift_type, v_series.note, v_series.created_by, v_series.id, v_covering
          );
          v_created := v_created + 1;
        exception when others then
          -- student_affairs_slot_taken và bạn bè: bỏ buổi đó, giữ phần còn lại.
          v_skipped := v_skipped || jsonb_build_object('date', v_date, 'reason', SQLERRM);
        end;
      end if;
    end if;
    v_date := v_date + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;
