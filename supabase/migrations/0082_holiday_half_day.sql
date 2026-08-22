-- Holidays gain a full-day / half-day distinction.
--
-- Why: the owner's ask was "nửa ngày hay nguyên ngày ... nửa ngày phải chọn
-- là bắt đầu từ mấy giờ để có thể tô màu từ lúc giờ đó". The calendar now
-- paints a holiday as a pale block filling the day column (see
-- toHolidayBackgroundEvents in lib/calendar.ts) instead of the old thin
-- all-day banner, so it needs to know where in the day the shading starts.
--
-- Additive and backwards-compatible: every existing row keeps behaving
-- exactly as before (half_day = false, start_time = null => the block spans
-- the full CALENDAR_MIN_HOUR..CALENDAR_MAX_HOUR window). No data migration,
-- no backfill, no rewrite — `not null default false` on a boolean is a
-- metadata-only change in Postgres 11+.
--
-- Holidays stay DISPLAY-ONLY, as 0080 established. start_time is a shading
-- boundary on the calendar and nothing else; it does not shorten a shift,
-- excuse a late check-in, or create a leave request.
alter table public.holidays
  add column if not exists half_day boolean not null default false;

-- Local wall-clock time in Asia/Ho_Chi_Minh, same convention as
-- leave_requests.start_time — `time` without a zone, because the app is
-- single-timezone and the value is read back as "HH:MM:SS" and re-applied to
-- whichever calendar day is being painted.
alter table public.holidays
  add column if not exists start_time time;

-- The two columns are one decision, so they can never disagree: a half-day
-- holiday must say when it starts, and a full-day one must not carry a
-- stray time left over from being edited back and forth. Mirrored by the
-- .refine() pair in lib/validations/holiday.ts for the instant form error;
-- this constraint is the actual boundary.
alter table public.holidays
  drop constraint if exists holidays_half_day_time_valid;
alter table public.holidays
  add constraint holidays_half_day_time_valid check (
    (half_day and start_time is not null) or (not half_day and start_time is null)
  );
