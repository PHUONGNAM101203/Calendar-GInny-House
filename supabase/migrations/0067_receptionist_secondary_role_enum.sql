-- Enum value only — Postgres requires ALTER TYPE ... ADD VALUE to commit
-- before the new value can be referenced (used in 0068's CHECK constraint
-- and trigger), so it's split into its own migration. Same pattern as
-- 0017_student_affairs_teaching_assistant_roles.sql.
alter type public.staff_role add value if not exists 'receptionist';
