-- Adds two new front-line roles under the training group, same tier as
-- teacher/collaborator: "Quản sinh" (student affairs) and "Trợ giảng"
-- (teaching assistant). Both fall under training_director's approval/
-- visibility scope, same as teacher/collaborator today.
-- Mirrors lib/roles.ts TRAINING_GROUP_ROLES/ROLE_HIERARCHY/ROLE_LABELS —
-- keep both in sync.

alter type public.staff_role add value if not exists 'student_affairs';
alter type public.staff_role add value if not exists 'teaching_assistant';
