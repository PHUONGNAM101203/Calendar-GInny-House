-- Indexes for the hot dashboard/calendar predicates that had none.
--
-- Every one of these was a sequential scan on each page load: the existing
-- composite indexes all lead with profile_id/branch_id, so none of them can
-- serve a query that filters only on a date or a status. The tables are small
-- today (~77 attendance rows, ~500 shifts), so this is about the shape of the
-- plan as the data grows, not about a crisis now — and it is why plain
-- `create index` is fine here (`concurrently` is illegal inside a migration
-- transaction, and the momentary lock on tables this size is not observable).
--
-- Each index names the query it exists for, so a future migration can tell
-- whether removing it is safe.

-- app/(app)/manager/page.tsx + app/(app)/calendar/page.tsx:
--   attendance.gte("check_in_at", ...).lte("check_in_at", ...)
-- A bare range on check_in_at, no profile/branch predicate to lead with.
create index if not exists attendance_check_in_at_idx on attendance (check_in_at desc);

-- app/(app)/manager/page.tsx: the "Ca làm việc" feed —
--   shifts.order("start_at", desc).limit(500), globally, no branch/assignee
--   filter. Without this it is a full scan plus a top-N sort.
create index if not exists shifts_start_at_idx on shifts (start_at desc);

-- app/(app)/calendar/page.tsx: leave rows overlapping the visible range —
--   .in("status", ['pending','approved']).lte("start_date", X).gte("end_date", Y)
-- Partial on those two statuses because resolved/cancelled rows accumulate
-- forever and are never part of this query.
create index if not exists leave_requests_date_range_idx
  on leave_requests (start_date, end_date)
  where status in ('pending', 'approved');

-- app/(app)/calendar/page.tsx: custom_events overlapping the visible range —
--   .lte("start_at", end).gte("end_at", start), no owner predicate (RLS scopes
--   it instead), so the date pair has to carry the lookup.
create index if not exists custom_events_range_idx on custom_events (start_at, end_at);

-- app/(app)/calendar/page.tsx: .eq("status", 'pending') with no branch filter.
-- The existing index leads with branch_id and so cannot be used here.
create index if not exists shift_swap_requests_status_created_idx
  on shift_swap_requests (status, created_at desc);

-- app/(app)/manager/page.tsx + calendar/page.tsx: .eq("status", 'pending').
-- Only (profile_id, created_at) existed, which a status-only filter cannot use.
create index if not exists attendance_corrections_status_created_idx
  on attendance_corrections (status, created_at desc);

-- Dead index: profiles.branch_id was dropped in
-- 0036_drop_legacy_branch_column.sql (membership lives in profile_branches
-- now). Postgres drops an index with its column, so this is normally already
-- gone — `if exists` makes it a no-op on databases where it is.
drop index if exists profiles_branch_idx;
