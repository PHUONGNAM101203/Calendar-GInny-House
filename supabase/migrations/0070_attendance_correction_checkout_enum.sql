-- Adds the two check-out issue types, deliberately ALONE in their own
-- migration. PostgreSQL will not let a value added by ALTER TYPE be *used*
-- in the same transaction that added it, and Supabase runs each migration
-- file inside one transaction — so 0071, which inserts and compares these
-- values, must be a separate file that runs after this one commits.
alter type public.attendance_correction_issue add value if not exists 'missed_check_out';
alter type public.attendance_correction_issue add value if not exists 'adjust_check_out';
