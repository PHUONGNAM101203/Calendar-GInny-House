-- Đợt 4 của "ca cố định": sửa theo phạm vi, đối xứng với xoá theo phạm vi.
--
-- Đây là đợt đầu tiên SỬA và XOÁ dữ liệu đang có — ba đợt trước chỉ thêm vào.
-- Vì vậy hai luật dưới đây là bất di bất dịch:
--
--   1. BUỔI ĐÃ CÓ CHẤM CÔNG KHÔNG BAO GIỜ BỊ SỬA HAY XOÁ, ở mọi phạm vi.
--      Giờ của một buổi đã chấm công là bằng chứng gắn với lần vào/ra thật;
--      đổi nó đi là làm sai bảng công một cách âm thầm. Hàm giữ nguyên và đếm
--      riêng để quản lý tự quyết định.
--   2. QUÁ KHỨ KHÔNG BỊ VIẾT LẠI. Phạm vi 'all' chỉ rải lại từ HÔM NAY trở đi.
--      Sửa luật là đổi kế hoạch sắp tới, không phải sửa lịch sử.
--
-- Vì sao 'range' KHÔNG đổi luật của series: "thứ trong tuần" và "cách mấy
-- tuần" là thuộc tính của cả cái luật, không của một quãng. Không có cách nào
-- có nghĩa để biến một buổi Thứ 2 thành "Thứ 3 và Thứ 5" chỉ trong hai tuần.
-- Nên 'range' sửa thẳng các buổi trong quãng đó (giờ, cơ sở, người, loại ca,
-- ghi chú) và để nguyên cái luật; 'all' mới đổi luật rồi rải lại tương lai.

create or replace function public.update_shift_series_occurrences(
  p_series_id      uuid,
  p_scope          text,
  p_shift_type     public.shift_type,
  p_start_time     time,
  p_end_time       time,
  p_branch_id      uuid default null,
  p_assignee_id    uuid default null,
  p_weekdays       smallint[] default null,
  p_interval_weeks smallint default null,
  p_ends_on        date default null,
  p_note           text default null,
  p_from           date default null,
  p_to             date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_zone      constant text := 'Asia/Ho_Chi_Minh';
  v_uid       uuid := auth.uid();
  v_series    public.shift_series%rowtype;
  v_today     date := (now() at time zone v_zone)::date;
  v_days      smallint[];
  v_target    date;
  v_row       record;
  v_start     timestamptz;
  v_end       timestamptz;
  v_end_date  date;
  v_updated   int := 0;
  v_kept      int := 0;
  v_conflict  int := 0;
  v_deleted   int := 0;
  v_result    jsonb;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập'; end if;
  if p_scope not in ('all', 'range') then
    raise exception 'Phạm vi sửa không hợp lệ' using errcode = '23514';
  end if;

  select * into v_series from public.shift_series where id = p_series_id;
  if not found then
    raise exception 'Không tìm thấy ca cố định này' using errcode = '23514';
  end if;

  -- Quyền trên CẢ người cũ lẫn người mới: chuyển một chuỗi ca sang người mà
  -- mình không được xếp lịch cũng chính là xếp lịch cho người đó.
  if v_series.assignee_id is null then
    if not public.can_manage_shift_slots() then
      raise exception 'Bạn không có quyền sửa ca cố định này';
    end if;
  elsif not public.can_manage_shift_for(v_series.assignee_id) then
    raise exception 'Bạn không có quyền sửa ca của nhân viên này';
  end if;
  if p_assignee_id is not null and p_assignee_id is distinct from v_series.assignee_id
     and not public.can_manage_shift_for(p_assignee_id) then
    raise exception 'Bạn không có quyền xếp ca cho nhân viên này';
  end if;

  if p_start_time = p_end_time then
    raise exception 'Giờ kết thúc phải khác giờ bắt đầu' using errcode = '23514';
  end if;
  if p_branch_id is null then
    raise exception 'Vui lòng chọn cơ sở' using errcode = '23514';
  end if;

  -- -------------------------------------------------------------------------
  -- Phạm vi 'range': sửa thẳng từng buổi, luật giữ nguyên
  -- -------------------------------------------------------------------------
  if p_scope = 'range' then
    if p_from is null or p_to is null then
      raise exception 'Vui lòng chọn khoảng ngày' using errcode = '23514';
    end if;
    if p_to < p_from then
      raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
    end if;

    for v_row in
      select s.id, s.assignee_id, (s.start_at at time zone v_zone)::date as on_date,
             exists (select 1 from public.attendance a where a.shift_id = s.id) as has_attendance
      from public.shifts s
      where s.series_id = p_series_id
        and (s.start_at at time zone v_zone)::date between p_from and p_to
      order by s.start_at
    loop
      if v_row.has_attendance then
        v_kept := v_kept + 1;
        continue;
      end if;

      v_start := (v_row.on_date + p_start_time) at time zone v_zone;
      v_end_date := case when p_end_time <= p_start_time then v_row.on_date + 1 else v_row.on_date end;
      v_end := (v_end_date + p_end_time) at time zone v_zone;

      -- Dò trùng TRƯỚC khi update, không bắt lỗi sau: shifts_no_overlap là
      -- DEFERRABLE INITIALLY DEFERRED, nên nó nổ ở COMMIT như một lỗi duy nhất
      -- không quy được về buổi nào. Loại chính nó ra khỏi phép dò.
      if exists (
        select 1 from public.shifts other
        where other.assignee_id = coalesce(p_assignee_id, v_row.assignee_id)
          and other.id <> v_row.id
          and tstzrange(other.start_at, other.end_at) && tstzrange(v_start, v_end)
      ) then
        v_conflict := v_conflict + 1;
        continue;
      end if;

      begin
        update public.shifts
        set assignee_id = coalesce(p_assignee_id, assignee_id),
            branch_id   = p_branch_id,
            shift_type  = p_shift_type,
            note        = nullif(p_note, ''),
            start_at    = v_start,
            end_at      = v_end
        where id = v_row.id;
        v_updated := v_updated + 1;
      exception when others then
        -- student_affairs_slot_taken và bạn bè: bỏ buổi đó, giữ phần còn lại.
        v_conflict := v_conflict + 1;
      end;
    end loop;

    -- Ô trống trong quãng: chưa có ai nên không thể có chấm công, sửa thẳng.
    update public.shift_slots
    set branch_id  = p_branch_id,
        shift_type = p_shift_type,
        note       = nullif(p_note, ''),
        start_at   = ((start_at at time zone v_zone)::date + p_start_time) at time zone v_zone,
        end_at     = ((
          case when p_end_time <= p_start_time
            then (start_at at time zone v_zone)::date + 1
            else (start_at at time zone v_zone)::date
          end) + p_end_time) at time zone v_zone
    where series_id = p_series_id
      and (start_at at time zone v_zone)::date between p_from and p_to;

    return jsonb_build_object(
      'scope', 'range',
      'updated', v_updated,
      'kept', v_kept,
      'conflicts', v_conflict,
      'deleted', 0,
      'skipped', '[]'::jsonb,
      'assignee_id', coalesce(p_assignee_id, v_series.assignee_id)
    );
  end if;

  -- -------------------------------------------------------------------------
  -- Phạm vi 'all': đổi luật rồi rải lại tương lai
  -- -------------------------------------------------------------------------
  select array_agg(distinct d order by d) into v_days
  from unnest(coalesce(p_weekdays, v_series.weekdays)) as d where d between 0 and 6;
  if v_days is null or array_length(v_days, 1) = 0 then
    raise exception 'Vui lòng chọn ít nhất một ngày trong tuần' using errcode = '23514';
  end if;
  if p_ends_on is not null and p_ends_on < v_series.starts_on then
    raise exception 'Ngày kết thúc phải sau ngày bắt đầu' using errcode = '23514';
  end if;

  -- starts_on KHÔNG đổi được: nó là mốc đếm tuần của cả luật (xem
  -- materialise_shift_series trong 0083), nên đổi nó sẽ đổi pha mọi buổi
  -- tương lai theo cách không ai đoán được từ giao diện.
  update public.shift_series
  set shift_type     = p_shift_type,
      branch_id      = p_branch_id,
      assignee_id    = coalesce(p_assignee_id, assignee_id),
      weekdays       = v_days,
      interval_weeks = greatest(coalesce(p_interval_weeks, interval_weeks), 1::smallint),
      start_time     = p_start_time,
      end_time       = p_end_time,
      ends_on        = p_ends_on,
      note           = nullif(p_note, '')
  where id = p_series_id
  returning * into v_series;

  -- Dọn tương lai trước khi rải lại. Buổi đã chấm công được giữ nguyên và đếm
  -- riêng — chúng sẽ tự làm cái mốc trùng giờ ở bước rải lại bên dưới và bị
  -- báo là conflict, đúng như mong đợi.
  with target as (
    select s.id, exists (select 1 from public.attendance a where a.shift_id = s.id) as has_attendance
    from public.shifts s
    where s.series_id = p_series_id
      and (s.start_at at time zone v_zone)::date >= v_today
  ), removed as (
    delete from public.shifts
    where id in (select id from target where not has_attendance)
    returning 1
  )
  select (select count(*) from removed), (select count(*) from target where has_attendance)
  into v_deleted, v_kept;

  delete from public.shift_slots
  where series_id = p_series_id
    and (start_at at time zone v_zone)::date >= v_today;

  v_target := coalesce(p_ends_on, v_today + public.shift_series_horizon());
  v_result := public.materialise_shift_series(p_series_id, v_today, v_target);

  update public.shift_series set materialised_through = v_target where id = p_series_id;

  return jsonb_build_object(
    'scope', 'all',
    'updated', coalesce((v_result->>'created')::int, 0),
    'kept', v_kept,
    'conflicts', jsonb_array_length(coalesce(v_result->'skipped', '[]'::jsonb)),
    'skipped', coalesce(v_result->'skipped', '[]'::jsonb),
    'deleted', v_deleted,
    'assignee_id', v_series.assignee_id
  );
end;
$$;

grant execute on function public.update_shift_series_occurrences(
  uuid, text, public.shift_type, time, time, uuid, uuid, smallint[], smallint, date, text, date, date
) to authenticated;
