-- Lets each person pick their own calendar color (Tài khoản → Màu lịch)
-- instead of always taking whatever the id-hash auto-assigns. NULL means
-- "keep the automatic color" — see lib/calendar.ts getPersonColorVar().
alter table public.profiles add column if not exists color text;

-- Only the fixed swatch set is allowed — arbitrary values would let someone
-- pick a var name that doesn't exist in app/globals.css and silently render
-- with no background color at all.
alter table public.profiles drop constraint if exists profiles_color_valid;
alter table public.profiles add constraint profiles_color_valid
  check (color is null or color in ('--chart-3', '--chart-4', '--chart-5', '--chart-6', '--gold', '--success'));
