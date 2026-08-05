insert into public.branches (code, name, address, color_token, sort_order) values
  ('CS1', 'Cơ sở 1', null, 'chart-1', 1),
  ('CS2', 'Cơ sở 2', null, 'chart-2', 2),
  ('CS3', 'Cơ sở 3', null, 'chart-3', 3)
on conflict (code) do nothing;
