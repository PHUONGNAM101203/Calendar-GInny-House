-- New front-line role: Nhân viên vận hành (operations staff). Grouped
-- alongside HR and CSKH under "vận hành" for the COO's group-scoped view —
-- see lib/roles.ts OPERATIONS_GROUP_ROLES. Front-line tier, same reach as
-- hr/customer_care: scoped to their own records + their branch's shared
-- schedule, not part of is_manager().
alter type public.staff_role add value if not exists 'operations_staff';
